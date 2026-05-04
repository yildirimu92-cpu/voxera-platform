const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { normalizePhoneE164 } = require('./_lib/phone-normalize'); // [PATCH 2a] Import hinzugefügt

const WEBHOOK_SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET || '';
const MAKE_MAIL_WEBHOOK = process.env.MAKE_MAIL_WEBHOOK || '';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';

// Zeitfenster für den Stub-Match (caller_phone + called_number + recency).
const FALLBACK_MATCH_WINDOW_MINUTES = 120;

// Toleranz für die HMAC-Timestamp-Prüfung (Replay-Schutz).
const SIGNATURE_TOLERANCE_SECONDS = 30 * 60;

// Polling-Konfiguration für die Nach-Analyse.
// Aggressiver gewählt für niedrige Latenz im Dashboard.
// Total Worst-Case: 2s + 5*3s = 17s (sicher unter Pro-Plan-Timeout 26s).
const POLL_MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 3000;
const POLL_INITIAL_DELAY_MS = 2000;

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
// Defensiv: matched auch bei Whitespace oder abweichender Schreibweise im Identifier.
function pickDC(dcResults, key) {
  if (!dcResults || typeof dcResults !== 'object') return null;

  let entry = dcResults[key];

  if (entry == null) {
    const target = key.toLowerCase().trim();
    for (const k of Object.keys(dcResults)) {
      if (k.toLowerCase().trim() === target) {
        entry = dcResults[k];
        break;
      }
    }
  }

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

// Baut Update-Payload aus ElevenLabs `data` Objekt
// (gleiches Schema in Webhook-Payload und GET-Conversation API-Response).
function buildUpdatePayloadFromData(data, elevenLabsConvId, liveStatus) {
  const meta = data.metadata || {};
  const analysis = data.analysis || {};
  const dc = analysis.data_collection_results || {};

  const updatePayload = {};

  const callerName = toStr(pickDC(dc, 'caller_name'));
  if (callerName) updatePayload.caller_name = callerName;

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

  // ─── [PATCH 1] Transcript ────────────────────────────────────────────────
  // ElevenLabs liefert data.transcript als Array von {role, message, time_in_call_secs}.
  // transcript_json: raw Array für strukturierte Auswertung im Dashboard.
  // transcript:      lesbarer Plaintext (role: message pro Zeile).
  // Gilt für Webhook-Payload UND für jeden Polling-API-Response (gleiches Schema).
  if (Array.isArray(data.transcript) && data.transcript.length > 0) {
    updatePayload.transcript_json = data.transcript;
    updatePayload.transcript = data.transcript
      .map(t => `${toStr(t.role)}: ${toStr(t.message)}`)
      .filter(line => line.trim() !== ':')
      .join('\n');
  }
  // ─── [END PATCH 1] ───────────────────────────────────────────────────────

  updatePayload.elevenlabs_conversation_id = elevenLabsConvId;
  updatePayload.dashboard_status = 'new';
  if (liveStatus) updatePayload.live_status = liveStatus;
  updatePayload.updated_at = new Date().toISOString();

  return updatePayload;
}

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

  let rawBody = event.body || '';
  if (event.isBase64Encoded) {
    rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
  }

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

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return response(500, { error: 'Supabase env missing' });
  }
  const sbAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // ─── Initial-Payload aus Webhook-Daten ──────────────────────────────────
  // Status 'analyzing': der Anruf ist beendet, Daten werden gerade vervollständigt.
  let updatePayload = buildUpdatePayloadFromData(data, elevenLabsConvId, 'analyzing');

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

    // ─── [PATCH 2b] Customer-Lookup mit Normalisierungs-Fallback ────────────
    // Vorher: nur exact match → customer_id = null bei Formatabweichungen.
    // Jetzt: erst exact match, dann Kandidaten-Loop mit normalizePhoneE164
    // (identische Logik wie in twilio-inbound-router).
    let customerId = null;
    if (calledNumber) {
      // Versuch 1: Exact match
      const { data: exactCustomer } = await sbAdmin
        .from('customers')
        .select('id, voxera_number')
        .eq('voxera_number', calledNumber)
        .maybeSingle();
      customerId = exactCustomer?.id || null;

      // Versuch 2: Normalisierungs-Fallback
      if (!customerId) {
        const { data: candidates } = await sbAdmin
          .from('customers')
          .select('id, voxera_number')
          .not('voxera_number', 'is', null)
          .limit(5000);
        const matched = (candidates || []).find(
          row => normalizePhoneE164(row.voxera_number).normalized === calledNumber
        );
        customerId = matched?.id || null;
        if (customerId) {
          console.log('[elevenlabs-post-call] strategy4 customer found via normalization fallback', {
            calledNumber, customerId
          });
        } else {
          console.warn('[elevenlabs-post-call] strategy4 customer NOT found', { calledNumber });
        }
      }
    }
    // ─── [END PATCH 2b] ──────────────────────────────────────────────────────

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
  // Nach jedem erfolgreichen API-Call wird sofort ein UPDATE geschrieben,
  // damit das Dashboard den Anruf "wachsen" sieht via Realtime.
  let finalPayload = updatePayload;
  let pollStatus = 'not_attempted';

  if (initialUpdateOk && recordId && ELEVENLABS_API_KEY) {
    if (isAnalysisComplete(updatePayload)) {
      pollStatus = 'webhook_already_complete';
      // Direkt auf 'completed' setzen
      await sbAdmin
        .from('calls')
        .update({ live_status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', recordId);
      console.log('[elevenlabs-post-call] webhook payload already complete, set live_status=completed');
    } else {
      console.log('[elevenlabs-post-call] starting polling', {
        elevenLabsConvId, missingFields: {
          lead_quality: updatePayload.lead_quality === undefined,
          priority: updatePayload.priority === undefined,
          call_summary: updatePayload.call_summary === undefined
        }
      });

      await sleep(POLL_INITIAL_DELAY_MS);

      let analysisCompleteSeen = false;

      for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
        const apiResult = await fetchConversation(elevenLabsConvId);
        if (!apiResult.ok) {
          console.warn('[elevenlabs-post-call] api fetch failed', {
            attempt, reason: apiResult.reason, status: apiResult.status
          });
        } else {
          const complete = (() => {
            const tmp = buildUpdatePayloadFromData(apiResult.data, elevenLabsConvId, 'analyzing');
            return isAnalysisComplete(tmp);
          })();

          // Bei letztem erfolgreichem Versuch oder wenn complete: setze live_status='completed'
          const liveStatus = complete ? 'completed' : 'analyzing';
          const polledPayload = buildUpdatePayloadFromData(apiResult.data, elevenLabsConvId, liveStatus);

          // Sofortiges UPDATE — Dashboard sieht den Fortschritt live
          const { error: progressUpdateError } = await sbAdmin
            .from('calls')
            .update(polledPayload)
            .eq('id', recordId);
          if (progressUpdateError) {
            console.error('[elevenlabs-post-call] progress update failed', {
              attempt, error: progressUpdateError.message
            });
          } else {
            console.log('[elevenlabs-post-call] progress update', {
              attempt, complete, fieldCount: Object.keys(polledPayload).length
            });
          }

          finalPayload = polledPayload;

          if (complete) {
            analysisCompleteSeen = true;
            pollStatus = `complete_after_${attempt}_attempts`;
            break;
          }
        }

        if (attempt < POLL_MAX_ATTEMPTS) {
          await sleep(POLL_INTERVAL_MS);
        } else if (!analysisCompleteSeen) {
          pollStatus = 'max_attempts_reached_incomplete';
          console.warn('[elevenlabs-post-call] polling exhausted', { elevenLabsConvId });
          // Auch wenn nicht complete: live_status auf 'completed' setzen,
          // sonst bleibt der Anruf im Dashboard ewig auf "analyzing"
          await sbAdmin
            .from('calls')
            .update({ live_status: 'completed', updated_at: new Date().toISOString() })
            .eq('id', recordId);
        }
      }
    }
  } else if (!ELEVENLABS_API_KEY) {
    console.warn('[elevenlabs-post-call] ELEVENLABS_API_KEY not set, skipping polling');
    pollStatus = 'no_api_key';
    // Ohne API-Key: gleich auf 'completed' setzen, Webhook-Daten sind alles was wir haben
    if (recordId) {
      await sbAdmin
        .from('calls')
        .update({ live_status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', recordId);
    }
  }

  // ─── Trigger Mail via Make.com (mit den finalen Daten) ─────────────────
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
