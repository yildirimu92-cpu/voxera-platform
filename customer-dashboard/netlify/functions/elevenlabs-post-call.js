const { createClient } = require('@supabase/supabase-js');

const WEBHOOK_SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET || '';
const MAKE_MAIL_WEBHOOK = process.env.MAKE_MAIL_WEBHOOK || '';

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

  const callSid = toStr(body.call_sid);
  const calledNumber = toStr(body.called_number);

  if (!callSid && !calledNumber) {
    return response(400, { error: 'call_sid oder called_number erforderlich' });
  }

  console.log('[elevenlabs-post-call] received', {
    callSid: callSid || null,
    calledNumber: calledNumber || null,
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
  updatePayload.dashboard_status = 'new';
  updatePayload.updated_at = new Date().toISOString();

  // ─── Update existing call record (matched by call_id) ────────────────────
  let updated = false;

  if (callSid) {
    const { data: existing, error: findError } = await sbAdmin
      .from('calls')
      .select('id, customer_id')
      .eq('call_id', callSid)
      .maybeSingle();

    if (findError) {
      console.error('[elevenlabs-post-call] find by call_id failed', { callSid, error: findError.message });
    }

    if (existing?.id) {
      const { error: updateError } = await sbAdmin
        .from('calls')
        .update(updatePayload)
        .eq('id', existing.id);

      if (updateError) {
        console.error('[elevenlabs-post-call] update failed', { callSid, error: updateError.message });
      } else {
        console.log('[elevenlabs-post-call] call updated', { callSid, id: existing.id });
        updated = true;
      }
    }
  }

  // ─── Fallback: INSERT if no existing record found ────────────────────────
  // Happens if twilio-inbound-router insert failed OR for outbound test calls
  if (!updated) {
    console.warn('[elevenlabs-post-call] no existing record found, inserting', { callSid });

    // Resolve customer via called_number
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
      call_id: callSid || null,
      customer_id: customerId,
      caller_phone: toStr(body.phone_number) || null,
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
      console.error('[elevenlabs-post-call] fallback insert failed', { callSid, error: insertError.message });
      return response(500, { error: 'Call konnte nicht gespeichert werden' });
    }

    console.log('[elevenlabs-post-call] fallback insert success', { callSid });
    updated = true;
  }

  // ─── Trigger E-Mail via Make.com ─────────────────────────────────────────
  if (updated && MAKE_MAIL_WEBHOOK) {
    try {
      await fetch(MAKE_MAIL_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call_sid: callSid,
          called_number: calledNumber,
          caller_name: toStr(body.caller_name),
          caller_phone: toStr(body.phone_number),
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
      console.log('[elevenlabs-post-call] mail webhook triggered', { callSid });
    } catch (e) {
      console.warn('[elevenlabs-post-call] mail webhook failed', { error: e.message });
      // Non-fatal — call is already saved
    }
  }

  return response(200, { success: true, updated });
};
