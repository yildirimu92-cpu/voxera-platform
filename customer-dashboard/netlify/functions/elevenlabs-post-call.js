const { createClient } = require('@supabase/supabase-js');

const WEBHOOK_SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET || '';
const MAKE_MAIL_WEBHOOK = process.env.MAKE_MAIL_WEBHOOK || '';

// Zeitfenster für den Stub-Match (caller_phone + called_number + recency).
// ElevenLabs feuert den Webhook üblicherweise 1–2 Min nach Call-Ende;
// 120 Min ist grosszügig, deckt aber auch verzögerte Retries ab.
const FALLBACK_MATCH_WINDOW_MINUTES = 120;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function toStr(v) {
  return v == null ? '' : String(v).trim();
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v || '').toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function toInt(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { error: 'Method not allowed' });
  }

  // ─── Parse body ─────────────────────────────────────────────────────────
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return response(400, { error: 'Invalid JSON' });
  }

  // ─── Webhook Secret Validation ───────────────────────────────────────────
  if (WEBHOOK_SECRET && toStr(body.webhook_secret) !== WEBHOOK_SECRET) {
    console.warn('[elevenlabs-post-call] invalid webhook secret');
    return response(401, { error: 'Unauthorized' });
  }

  // WICHTIG: body.call_sid von ElevenLabs ist die *ElevenLabs Conversation ID*
  // (conv_...), NICHT die Twilio CallSid. Sie wird ausschliesslich in
  // elevenlabs_conversation_id geschrieben, niemals in call_id.
  const elevenLabsConvId = toStr(body.call_sid);
  const calledNumber = toStr(body.called_number);
  const callerPhone = toStr(body.phone_number);

  if (!elevenLabsConvId && !calledNumber) {
    return response(400, { error: 'call_sid oder called_number erforderlich' });
  }

  console.log('[elevenlabs-post-call] received', {
    elevenLabsConvId: elevenLabsConvId || null,
    calledNumber: calledNumber || null,
    callerPhone: callerPhone || null,
    callerName: toStr(body.caller_name) || null
  });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return response(500, { error: 'Supabase env missing' });
  }

  const sbAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // ─── Build update payload ────────────────────────────────────────────────
  // call_id wird hier NICHT gesetzt — die Twilio CallSid bleibt unverändert
  // (vom twilio-inbound-router gesetzt).
  const updatePayload = {};
  if (toStr(body.caller_name)) updatePayload.caller_name = toStr(body.caller_name);
  if (toStr(body.call_summary)) updatePayload.call_summary = toStr(body.call_summary);
  if (toStr(body.call_summary_short)) updatePayload.call_summary_short = toStr(body.call_summary_short);
  if (toInt(body.duration_seconds) !== null) updatePayload.duration_seconds = toInt(body.duration_seconds);
  if (body.callback_requested !== undefined) updatePayload.callback_requested = toBool(body.callback_requested);
  if (toStr(body.lead_quality)) updatePayload.lead_quality = toStr(body.lead_quality);
  if (toStr(body.category) && body.category !== 'inbound') updatePayload.category = toStr(body.category);
  if (toStr(body.next_action)) updatePayload.next_action = toStr(body.next_action);
  if (toStr(body.priority)) updatePayload.priority = toStr(body.priority);
  if (toStr(body.intent)) updatePayload.intent = toStr(body.intent);
  if (toStr(body.urgency)) updatePayload.urgency = toStr(body.urgency);
  if (toStr(body.company_name)) updatePayload.company_name = toStr(body.company_name);
  if (elevenLabsConvId) updatePayload.elevenlabs_conversation_id = elevenLabsConvId;
  updatePayload.dashboard_status = 'new';
  updatePayload.updated_at = new Date().toISOString();

  // ─── Match-Strategie ─────────────────────────────────────────────────────
  // 1) elevenlabs_conversation_id (idempotent — schützt gegen Webhook-Retries)
  // 2) Twilio-Stub via caller_phone + called_number + recency (kein conv_id)
  // 3) Fallback INSERT
  let matchedRecordId = null;
  let matchStrategy = null;

  // ─── Strategy 1: bestehende ElevenLabs Conversation ID ───────────────────
  if (elevenLabsConvId) {
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

  // ─── Strategy 2: Twilio-Stub via caller_phone + called_number + recency ──
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
      // Mehrdeutig — neuester Stub gewinnt. Sollte selten vorkommen
      // (gleicher Anrufer ruft mehrfach binnen 2h die gleiche Voxera-Nummer an).
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

  // ─── Strategy 3: Fallback INSERT ─────────────────────────────────────────
  // Tritt auf wenn:
  //   - twilio-inbound-router INSERT vorher fehlgeschlagen ist
  //   - Outbound-Testanruf ohne Stub
  //   - Match-Window überschritten
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
      call_id: null,                                  // Twilio CallSid hier unbekannt
      elevenlabs_conversation_id: elevenLabsConvId || null,
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

  // ─── Trigger E-Mail via Make.com ─────────────────────────────────────────
  // call_sid bleibt für Backwards-Compat im Make-Payload, zusätzlich neu
  // elevenlabs_conversation_id für saubere Filter ab jetzt.
  if (updated && MAKE_MAIL_WEBHOOK) {
    try {
      await fetch(MAKE_MAIL_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call_sid: elevenLabsConvId,
          elevenlabs_conversation_id: elevenLabsConvId,
          called_number: calledNumber,
          caller_name: toStr(body.caller_name),
          caller_phone: callerPhone,
          call_summary: toStr(body.call_summary),
          call_summary_short: toStr(body.call_summary_short),
          callback_requested: toBool(body.callback_requested),
          category: toStr(body.category),
          lead_quality: toStr(body.lead_quality),
          next_action: toStr(body.next_action),
          priority: toStr(body.priority),
          duration_seconds: toInt(body.duration_seconds)
        })
      });
      console.log('[elevenlabs-post-call] mail webhook triggered', { elevenLabsConvId });
    } catch (e) {
      console.warn('[elevenlabs-post-call] mail webhook failed', { error: e.message });
      // Non-fatal — call ist bereits gespeichert
    }
  }

  return response(200, {
    success: true,
    updated,
    matchStrategy: matchStrategy || 'none'
  });
};
