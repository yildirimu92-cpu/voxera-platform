const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const WEBHOOK_SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET || '';
const MAKE_MAIL_WEBHOOK = process.env.MAKE_MAIL_WEBHOOK || '';

// Zeitfenster für den Stub-Match (caller_phone + called_number + recency).
const FALLBACK_MATCH_WINDOW_MINUTES = 120;

// Toleranz für die HMAC-Timestamp-Prüfung (Replay-Schutz).
const SIGNATURE_TOLERANCE_SECONDS = 30 * 60;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, ElevenLabs-Signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function toStr(v) { return v == null ? '' : String(v).trim(); }

function toBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v == null ? '' : v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function toInt(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

// ─── HMAC Signature Verification (Stripe-Style) ─────────────────────────────
// ElevenLabs sendet Header `ElevenLabs-Signature` mit Format:
//   t=<unix_seconds>,v0=<hex_sha256_hmac>
// Signiertes Payload: `<timestamp>.<raw_body>`
function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return { ok: false, reason: 'missing_input' };

  const parts = signatureHeader.split(',').reduce((acc, p) => {
    const idx = p.indexOf('=');
    if (idx > 0) {
      const k = p.slice(0, idx).trim();
      const v = p.slice(idx + 1).trim();
      acc[k] = v;
    }
    return acc;
  }, {});

  const ts = parseInt(parts.t, 10);
  const sig = parts.v0;
  if (!ts || !sig) return { ok: false, reason: 'malformed_header' };

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp_outside_tolerance', diff: nowSec - ts };
  }

  const signedPayload = `${ts}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  if (sig.length !== expected.length) return { ok: false, reason: 'signature_length_mismatch' };

  try {
    const ok = crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    return ok ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
  } catch (e) {
    return { ok: false, reason: 'comparison_error' };
  }
}

// Holt den Wert aus einem data_collection_results-Eintrag.
// Format: { value: "...", rationale: "..." } oder direkt ein Primitiv.
function pickDC(dcResults, key) {
  if (!dcResults || typeof dcResults !== 'object') return null;
  const entry = dcResults[key];
  if (entry == null) return null;
  if (typeof entry === 'object' && 'value' in entry) return entry.value;
  return entry;
}

// Sucht in mehreren möglichen Stellen nach Telefonnummern und Twilio-CallSid.
// ElevenLabs-Schema variiert je nach Telefonie-Provider und Datum.
function extractPhoneInfo(data) {
  const meta = data.metadata || {};
  const phone = meta.phone_call || {};

  return {
    callerPhone:
      toStr(phone.external_number) ||
      toStr(phone.from_number) ||
      toStr(meta.external_number) ||
      '',
    calledNumber:
      toStr(phone.agent_number) ||
      toStr(phone.to_number) ||
      toStr(meta.called_number) ||
      '',
    twilioCallSid: toStr(phone.call_sid) || ''
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return response(405, { error: 'Method not allowed' });
  }

  // Body kann base64-encoded sein (Netlify-Eigenheit für Binary-Bodies).
  let rawBody = event.body || '';
  if (event.isBase64Encoded) {
    rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
  }

  // ─── HMAC Signature Validation ─────────────────────────────────────────
  if (!WEBHOOK_SECRET) {
    console.error('[elevenlabs-post-call] ELEVENLABS_WEBHOOK_SECRET env not set');
    return response(500, { error: 'Server config error' });
  }

  // Netlify normalisiert Header zu Lowercase
  const sigHeader =
    (event.headers &&
      (event.headers['elevenlabs-signature'] ||
        event.headers['ElevenLabs-Signature'])) ||
    '';

  const sigCheck = verifySignature(rawBody, sigHeader, WEBHOOK_SECRET);
  if (!sigCheck.ok) {
    console.warn('[elevenlabs-post-call] signature verification failed', {
      reason: sigCheck.reason
    });
    return response(401, { error: 'Invalid signature' });
  }

  // ─── Parse body ─────────────────────────────────────────────────────────
  let body = {};
  try {
    body = JSON.parse(rawBody || '{}');
  } catch (e) {
    return response(400, { error: 'Invalid JSON' });
  }

  // ─── Event-Type filtern ──────────────────────────────────────────────────
  // Wir verarbeiten nur post_call_transcription. Andere Events
  // (post_call_audio, call_initiation_failure) werden quittiert und ignoriert.
  if (body.type !== 'post_call_transcription') {
    console.log('[elevenlabs-post-call] ignored event type', { type: body.type });
    return response(200, { success: true, ignored: true, type: body.type });
  }

  const data = body.data || {};
  const meta = data.metadata || {};
  const analysis = data.analysis || {};
  const dc = analysis.data_collection_results || {};

  const elevenLabsConvId = toStr(data.conversation_id);
  const { callerPhone, calledNumber, twilioCallSid } = extractPhoneInfo(data);

  if (!elevenLabsConvId) {
    console.warn('[elevenlabs-post-call] no conversation_id in payload');
    return response(400, { error: 'conversation_id required' });
  }

  console.log('[elevenlabs-post-call] received', {
    elevenLabsConvId,
    callerPhone: callerPhone || null,
    calledNumber: calledNumber || null,
    twilioCallSid: twilioCallSid || null,
    duration: meta.call_duration_secs
  });

  // ─── Supabase init ──────────────────────────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return response(500, { error: 'Supabase env missing' });
  }
  const sbAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // ─── Update-Payload aus Analyse extrahieren ─────────────────────────────
  const updatePayload = {};

  const callerName = toStr(pickDC(dc, 'caller_name'));
  if (callerName) updatePayload.caller_name = callerName;

  const callSummary =
    toStr(pickDC(dc, 'call_summary')) || toStr(analysis.transcript_summary);
  if (callSummary) updatePayload.call_summary = callSummary;

  const callSummaryShort = toStr(pickDC(dc, 'call_summary_short'));
  if (callSummaryShort) updatePayload.call_summary_short = callSummaryShort;

  const duration = toInt(meta.call_duration_secs);
  if (duration !== null) updatePayload.duration_seconds = duration;

  const callbackRequestedRaw = pickDC(dc, 'callback_requested');
  if (
    callbackRequestedRaw !== null &&
    callbackRequestedRaw !== undefined &&
    callbackRequestedRaw !== ''
  ) {
    updatePayload.callback_requested = toBool(callbackRequestedRaw);
  }

  const leadQuality = toStr(pickDC(dc, 'lead_quality'));
  if (leadQuality) updatePayload.lead_quality = leadQuality;

  const category = toStr(pickDC(dc, 'category'));
  if (category && category.toLowerCase() !== 'inbound') updatePayload.category = category;

  const nextAction = toStr(pickDC(dc, 'next_action'));
  if (nextAction) updatePayload.next_action = nextAction;

  const priority = toStr(pickDC(dc, 'priority'));
  if (priority) updatePayload.priority = priority;

  const intent = toStr(pickDC(dc, 'intent'));
  if (intent) updatePayload.intent = intent;

  const urgency = toStr(pickDC(dc, 'urgency'));
  if (urgency) updatePayload.urgency = urgency;

  const companyName = toStr(pickDC(dc, 'company_name'));
  if (companyName) updatePayload.company_name = companyName;

  updatePayload.elevenlabs_conversation_id = elevenLabsConvId;
  updatePayload.dashboard_status = 'new';
  updatePayload.updated_at = new Date().toISOString();

  // ─── Match-Strategie (4-stufig) ─────────────────────────────────────────
  // 1) elevenlabs_conversation_id (idempotent — schützt gegen Webhook-Retries)
  // 2) Twilio CallSid direkt (präziseste Stub-Erkennung wenn ElevenLabs sie liefert)
  // 3) Twilio-Stub via caller_phone + called_number + recency
  // 4) Fallback INSERT
  let matchedRecordId = null;
  let matchStrategy = null;

  // Strategy 1
  {
    const { data: existing, error } = await sbAdmin
      .from('calls')
      .select('id')
      .eq('elevenlabs_conversation_id', elevenLabsConvId)
      .maybeSingle();
    if (error) {
      console.error('[elevenlabs-post-call] match by conv_id failed', {
        elevenLabsConvId,
        error: error.message
      });
    }
    if (existing?.id) {
      matchedRecordId = existing.id;
      matchStrategy = 'elevenlabs_conversation_id';
    }
  }

  // Strategy 2: Twilio CallSid direkt
  if (!matchedRecordId && twilioCallSid) {
    const { data: existing, error } = await sbAdmin
      .from('calls')
      .select('id')
      .eq('call_id', twilioCallSid)
      .is('elevenlabs_conversation_id', null)
      .maybeSingle();
    if (error) {
      console.error('[elevenlabs-post-call] match by twilio call_sid failed', {
        twilioCallSid,
        error: error.message
      });
    }
    if (existing?.id) {
      matchedRecordId = existing.id;
      matchStrategy = 'twilio_call_sid';
    }
  }

  // Strategy 3: Stub-Match via caller_phone + called_number + Recency
  if (!matchedRecordId && callerPhone && calledNumber) {
    const cutoffIso = new Date(
      Date.now() - FALLBACK_MATCH_WINDOW_MINUTES * 60 * 1000
    ).toISOString();
    const { data: candidates, error } = await sbAdmin
      .from('calls')
      .select('id, created_at')
      .eq('caller_phone', callerPhone)
      .eq('called_number', calledNumber)
      .is('elevenlabs_conversation_id', null)
      .gte('created_at', cutoffIso)
      .order('created_at', { ascending: false })
      .limit(2);

    if (error) {
      console.error('[elevenlabs-post-call] stub-match query failed', {
        error: error.message
      });
    } else if (candidates && candidates.length === 1) {
      matchedRecordId = candidates[0].id;
      matchStrategy = 'twilio_stub';
    } else if (candidates && candidates.length > 1) {
      matchedRecordId = candidates[0].id;
      matchStrategy = 'twilio_stub_ambiguous_picked_latest';
      console.warn('[elevenlabs-post-call] multiple stub candidates, picked latest', {
        elevenLabsConvId,
        callerPhone,
        calledNumber,
        candidateCount: candidates.length
      });
    }
  }

  // ─── UPDATE bei Match ────────────────────────────────────────────────────
  let updated = false;
  if (matchedRecordId) {
    // Bei Strategy 2 (Twilio CallSid Match) call_id NICHT überschreiben
    // — der Stub hat ihn bereits korrekt
    const { error: updateError } = await sbAdmin
      .from('calls')
      .update(updatePayload)
      .eq('id', matchedRecordId);
    if (updateError) {
      console.error('[elevenlabs-post-call] update failed', {
        elevenLabsConvId,
        matchedRecordId,
        strategy: matchStrategy,
        error: updateError.message
      });
    } else {
      console.log('[elevenlabs-post-call] call updated', {
        elevenLabsConvId,
        id: matchedRecordId,
        strategy: matchStrategy
      });
      updated = true;
    }
  }

  // ─── Strategy 4: Fallback INSERT ────────────────────────────────────────
  if (!updated) {
    console.warn('[elevenlabs-post-call] no record matched, inserting fresh', {
      elevenLabsConvId,
      callerPhone,
      calledNumber
    });

    let customerId = null;
    if (calledNumber) {
      const { data: customer } = await sbAdmin
        .from('customers')
        .select('id, voxera_number')
        .eq('voxera_number', calledNumber)
        .maybeSingle();
      customerId = customer?.id || null;
    }

    const insertPayload = {
      call_id: twilioCallSid || null,
      elevenlabs_conversation_id: elevenLabsConvId,
      customer_id: customerId,
      caller_phone: callerPhone || null,
      called_number: calledNumber || null,
      voxera_number: calledNumber || null,
      direction: 'inbound',
      created_at: new Date().toISOString(),
      ...updatePayload
    };

    const { error: insertError } = await sbAdmin
      .from('calls')
      .insert(insertPayload);
    if (insertError) {
      console.error('[elevenlabs-post-call] fallback insert failed', {
        elevenLabsConvId,
        error: insertError.message
      });
      return response(500, { error: 'Call konnte nicht gespeichert werden' });
    }
    console.log('[elevenlabs-post-call] fallback insert success', { elevenLabsConvId });
    matchStrategy = 'fallback_insert';
    updated = true;
  }

  // ─── Trigger Mail via Make.com ──────────────────────────────────────────
  if (updated && MAKE_MAIL_WEBHOOK) {
    try {
      await fetch(MAKE_MAIL_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elevenlabs_conversation_id: elevenLabsConvId,
          called_number: calledNumber,
          caller_name: callerName,
          caller_phone: callerPhone,
          call_summary: callSummary,
          call_summary_short: callSummaryShort,
          callback_requested: callbackRequestedRaw != null ? toBool(callbackRequestedRaw) : false,
          category: category,
          lead_quality: leadQuality,
          next_action: nextAction,
          priority: priority,
          duration_seconds: duration
        })
      });
      console.log('[elevenlabs-post-call] mail webhook triggered', { elevenLabsConvId });
    } catch (e) {
      console.warn('[elevenlabs-post-call] mail webhook failed', { error: e.message });
      // Non-fatal — Call ist bereits gespeichert
    }
  }

  return response(200, {
    success: true,
    updated,
    matchStrategy: matchStrategy || 'none'
  });
};
