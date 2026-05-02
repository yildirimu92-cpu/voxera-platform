const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const WEBHOOK_SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET || '';
const MAKE_MAIL_WEBHOOK = process.env.MAKE_MAIL_WEBHOOK || '';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';

// Zeitfenster für den Stub-Match (caller_phone + called_number + recency).
const FALLBACK_MATCH_WINDOW_MINUTES = 120;

// Toleranz für die HMAC-Timestamp-Prüfung (Replay-Schutz).
const SIGNATURE_TOLERANCE_SECONDS = 30 * 60;

// Polling-Konfiguration für die Nach-Analyse von ElevenLabs.
// Beim Webhook-Empfang sind die Data-Collection-Felder oft noch leer.
// Wir warten und fragen die API nach, bis sie vollständig sind.
// Netlify Pro Plan Timeout: 26s — wir bleiben sicher darunter.
const POLL_MAX_ATTEMPTS = 4;
const POLL_INTERVAL_MS = 5000;          // 5 Sekunden zwischen Versuchen
const POLL_INITIAL_DELAY_MS = 3000;     // 3 Sekunden Wartezeit vor erstem API-Call

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── HMAC Signature Verification (Stripe-Style) ─────────────────────────────
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
function pickDC(dcResults, key) {
  if (!dcResults || typeof dcResults !== 'object') return null;
  const entry = dcResults[key];
  if (entry == null) return null;
  if (typeof entry === 'object' && 'value' in entry) return entry.value;
  return entry;
}

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

// Baut das Update-Payload aus einem ElevenLabs `data` Objekt
// (gleiches Schema im Webhook-Payload und in der GET-Conversation API-Response).
function buildUpdatePayloadFromData(data, elevenLabsConvId) {
  const meta = data.metadata || {};
  const analysis = data.analysis || {};
  const dc = analysis.data_collection_results || {};

  const updatePayload = {};

  const callerName = toStr(pickDC(dc, 'caller_name'));
  if (callerName) updatePayload.caller_name = callerName;

  // Nur das Data-Collection-Feld verwenden, NICHT analysis.transcript_summary
  // (letzteres wird von ElevenLabs auf Englisch generiert)
  const callSummary = toStr(pickDC(dc, 'call_summary'));
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

  return updatePayload;
}

// Ruft die ElevenLabs Conversation API ab.
async function fetchConversation(conversationId) {
  if (!ELEVENLABS_API_KEY) return { ok: false, reason: 'no_api_key' };

  const url = `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`;
  try {
    const resp = await fetch(url, {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
    if (!resp.ok) {
      return { ok: false, status: resp.status, reason: 'http_error' };
    }
    const json = await resp.json();
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, reason: 'fetch_error', error: e.message };
  }
}

// Heuristik: Sind die "späten" Analyse-Felder gefüllt?
// Diese Felder kommen erfahrungsgemäss zuletzt aus der Analyse.
function isAnalysisComplete(payload) {
  return (
    payload.lead_quality !== undefined &&
    payload.priority !== undefined &&
    payload.call_summary !== undefined
  );
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return response(405, { error: 'Method not allowed' });
  }

  // Body kann base64-encoded sein
  let rawBody = event.body || '';
  if (event.isBase64Encoded) {
    rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
  }

  // ─── HMAC Signature Validation ─────────────────────────────────────────
  if (!WEBHOOK_SECRET) {
    console.error('[elevenlabs-post-call] ELEVENLABS_WEBHOOK_SECRET env not set');
    return response(500, { error: 'Server config error' });
  }

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

  if (body.type !== 'post_call_transcription') {
    console.log('[elevenlabs-post-call] ignored event type', { type: body.type });
    return response(200, { success: true, ignored: true, type: body.type });
  }

  const data = body.data || {};
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
    duration: (data.metadata || {}).call_duration_secs
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

  // ─── Initiales Update aus Webhook-Daten ─────────────────────────────────
  let updatePayload = buildUpdatePayloadFromData(data, elevenLabsConvId);

  // ─── Match-Strategie (4-stufig) ─────────────────────────────────────────
  let matchedRecordId = null;
  let matchStrategy = null;

  // Strategy 1: existing elevenlabs_conversation_id (idempotent retry)
  {
    const { data: existing, error } = await sbAdmin
      .from('calls')
      .select('id')
      .eq('elevenlabs_conversation_id', elevenLabsConvId)
      .maybeSingle();
    if (error) {
      console.error('[elevenlabs-post-call] match by conv_id failed', {
        elevenLabsConvId, error: error.message
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
        twilioCallSid, error: error.message
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
      console.error('[elevenlabs-post-call] stub-match query failed', { error: error.message });
    } else if (candidates && candidates.length === 1) {
      matchedRecordId = candidates[0].id;
      matchStrategy = 'twilio_stub';
    } else if (candidates && candidates.length > 1) {
      matchedRecordId = candidates[0].id;
      matchStrategy = 'twilio_stub_ambiguous_picked_latest';
      console.warn('[elevenlabs-post-call] multiple stub candidates, picked latest', {
        elevenLabsConvId, callerPhone, calledNumber, candidateCount: candidates.length
      });
    }
  }

  // ─── Initiales UPDATE oder INSERT ────────────────────────────────────────
  let recordId = matchedRecordId;
  let initialUpdateOk = false;

  if (matchedRecordId) {
    const { error: updateError } = await sbAdmin
      .from('calls')
      .update(updatePayload)
      .eq('id', matchedRecordId);
    if (updateError) {
      console.error('[elevenlabs-post-call] initial update failed', {
        elevenLabsConvId, matchedRecordId, strategy: matchStrategy, error: updateError.message
      });
    } else {
      console.log('[elevenlabs-post-call] initial update done', {
        elevenLabsConvId, id: matchedRecordId, strategy: matchStrategy
      });
      initialUpdateOk = true;
    }
  }

  // Strategy 4: Fallback INSERT
  if (!initialUpdateOk && !matchedRecordId) {
    console.warn('[elevenlabs-post-call] no record matched, inserting fresh', {
      elevenLabsConvId, callerPhone, calledNumber
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

    const { data: inserted, error: insertError } = await sbAdmin
      .from('calls')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertError) {
      console.error('[elevenlabs-post-call] fallback insert failed', {
        elevenLabsConvId, error: insertError.message
      });
      return response(500, { error: 'Call konnte nicht gespeichert werden' });
    }
    console.log('[elevenlabs-post-call] fallback insert success', { elevenLabsConvId });
    matchStrategy = 'fallback_insert';
    recordId = inserted?.id;
    initialUpdateOk = true;
  }

  // ─── Polling: API abfragen bis Analyse vollständig ─────────────────────
  // Beim Webhook-Empfang sind Felder wie lead_quality, priority, call_summary
  // oft noch leer. Wir pollen die GET-Conversation API um die finale Analyse
  // zu bekommen.
  let finalPayload = updatePayload;
  let pollStatus = 'not_attempted';

  if (initialUpdateOk && ELEVENLABS_API_KEY) {
    if (isAnalysisComplete(updatePayload)) {
      pollStatus = 'webhook_already_complete';
      console.log('[elevenlabs-post-call] webhook payload already complete, skipping polling');
    } else {
      console.log('[elevenlabs-post-call] starting polling', {
        elevenLabsConvId, missingFields: {
          lead_quality: updatePayload.lead_quality === undefined,
          priority: updatePayload.priority === undefined,
          call_summary: updatePayload.call_summary === undefined
        }
      });

      await sleep(POLL_INITIAL_DELAY_MS);

      for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
        const apiResult = await fetchConversation(elevenLabsConvId);
        if (!apiResult.ok) {
          console.warn('[elevenlabs-post-call] api fetch failed', {
            attempt, reason: apiResult.reason, status: apiResult.status
          });
        } else {
          // DEBUG: Zeige Struktur der API-Response
          const dcKeys = apiResult.data?.analysis?.data_collection_results
            ? Object.keys(apiResult.data.analysis.data_collection_results)
            : null;
          const dcSample = apiResult.data?.analysis?.data_collection_results?.caller_name;
          console.log('[elevenlabs-post-call] api response debug', {
            attempt,
            topLevelKeys: Object.keys(apiResult.data || {}),
            hasAnalysis: !!apiResult.data?.analysis,
            analysisKeys: apiResult.data?.analysis ? Object.keys(apiResult.data.analysis) : null,
            dcKeys,
            dcCallerNameRaw: dcSample
          });

          const polledPayload = buildUpdatePayloadFromData(apiResult.data, elevenLabsConvId);
          if (isAnalysisComplete(polledPayload)) {
            finalPayload = polledPayload;
            pollStatus = `complete_after_${attempt}_attempts`;
            console.log('[elevenlabs-post-call] polling complete', {
              elevenLabsConvId, attempt, fields: Object.keys(polledPayload)
            });
            break;
          }
          // Auch wenn nicht "complete", merken wir den Fortschritt
          finalPayload = polledPayload;
        }

        if (attempt < POLL_MAX_ATTEMPTS) {
          await sleep(POLL_INTERVAL_MS);
        } else {
          pollStatus = 'max_attempts_reached_incomplete';
          console.warn('[elevenlabs-post-call] polling exhausted', { elevenLabsConvId });
        }
      }
    }

    // ─── Finales UPDATE mit den gepollten Daten ────────────────────────────
    if (recordId && finalPayload !== updatePayload) {
      const { error: finalUpdateError } = await sbAdmin
        .from('calls')
        .update(finalPayload)
        .eq('id', recordId);
      if (finalUpdateError) {
        console.error('[elevenlabs-post-call] final update failed', {
          elevenLabsConvId, recordId, error: finalUpdateError.message
        });
      } else {
        console.log('[elevenlabs-post-call] final update done', {
          elevenLabsConvId, recordId, pollStatus
        });
      }
    }
  } else if (!ELEVENLABS_API_KEY) {
    console.warn('[elevenlabs-post-call] ELEVENLABS_API_KEY not set, skipping polling');
    pollStatus = 'no_api_key';
  }

  // ─── Trigger Mail via Make.com (mit den finalen Daten!) ────────────────
  if (initialUpdateOk && MAKE_MAIL_WEBHOOK) {
    try {
      await fetch(MAKE_MAIL_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elevenlabs_conversation_id: elevenLabsConvId,
          called_number: calledNumber,
          caller_name: finalPayload.caller_name || '',
          caller_phone: callerPhone,
          call_summary: finalPayload.call_summary || '',
          call_summary_short: finalPayload.call_summary_short || '',
          callback_requested: finalPayload.callback_requested === true,
          category: finalPayload.category || '',
          lead_quality: finalPayload.lead_quality || '',
          next_action: finalPayload.next_action || '',
          priority: finalPayload.priority || '',
          duration_seconds: finalPayload.duration_seconds || null
        })
      });
      console.log('[elevenlabs-post-call] mail webhook triggered', { elevenLabsConvId });
    } catch (e) {
      console.warn('[elevenlabs-post-call] mail webhook failed', { error: e.message });
    }
  }

  return response(200, {
    success: true,
    updated: initialUpdateOk,
    matchStrategy: matchStrategy || 'none',
    pollStatus
  });
};
