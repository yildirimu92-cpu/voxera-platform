const querystring = require('querystring');
const { createClient } = require('@supabase/supabase-js');

const STATUS_MAP = Object.freeze({
  ringing: 'incoming',
  'in-progress': 'active',
  completed: 'processing',
  busy: 'failed',
  failed: 'failed',
  'no-answer': 'abandoned',
  canceled: 'abandoned'
});

function parseBody(event) {
  const body = event.body || '';
  if (!body) return {};
  if (event.isBase64Encoded) {
    const decoded = Buffer.from(body, 'base64').toString('utf8');
    return querystring.parse(decoded);
  }
  return querystring.parse(body);
}

function toStr(value) {
  return value == null ? '' : String(value).trim();
}

function toInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function canPromoteFromTerminal(currentLiveStatus, targetLiveStatus) {
  const current = toStr(currentLiveStatus).toLowerCase();
  const target = toStr(targetLiveStatus).toLowerCase();
  if (!current) return true;

  // Never downgrade from terminal enrichment success.
  if (current === 'completed') return false;

  // Preserve existing terminal failure/abandonment; Twilio retries/out-of-order events should not reopen.
  if ((current === 'failed' || current === 'abandoned') && (target === 'incoming' || target === 'active' || target === 'processing')) {
    return false;
  }

  return true;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const payload = parseBody(event);
  const callSid = toStr(payload.CallSid);
  const twilioStatus = toStr(payload.CallStatus).toLowerCase();
  const mappedStatus = STATUS_MAP[twilioStatus] || '';

  if (!callSid) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'CallSid is required' })
    };
  }

  if (!mappedStatus) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, ignored: true, reason: 'unsupported_status', call_sid: callSid, call_status: twilioStatus || null })
    };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Supabase env missing' })
    };
  }

  const sbAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: rows, error: lookupError } = await sbAdmin
    .from('calls')
    .select('id, call_id, live_status, transcript, call_summary, duration_seconds')
    .eq('call_id', callSid)
    .order('created_at', { ascending: false })
    .limit(2);

  if (lookupError) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Call lookup failed', details: lookupError.message })
    };
  }

  if (!rows || rows.length === 0) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, not_found: true, call_sid: callSid })
    };
  }

  const row = rows[0];
  const hasEnrichment = Boolean(toStr(row.transcript) || toStr(row.call_summary));
  const patch = { updated_at: new Date().toISOString() };

  if (twilioStatus === 'completed') {
    // If enrichment already exists, preserve completed if already set; otherwise keep mapped processing.
    if (toStr(row.live_status).toLowerCase() === 'completed' && hasEnrichment) {
      // no-op for live_status
    } else if (canPromoteFromTerminal(row.live_status, mappedStatus)) {
      patch.live_status = mappedStatus;
    }
  } else if (canPromoteFromTerminal(row.live_status, mappedStatus)) {
    patch.live_status = mappedStatus;
  }

  const durationSeconds = toInt(payload.CallDuration);
  if (durationSeconds !== null) {
    patch.duration_seconds = durationSeconds;
  }

  if (Object.keys(patch).length === 1) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, call_sid: callSid, unchanged: true, current_live_status: row.live_status || null })
    };
  }

  const { error: updateError } = await sbAdmin
    .from('calls')
    .update(patch)
    .eq('id', row.id);

  if (updateError) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Call update failed', details: updateError.message })
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      call_sid: callSid,
      twilio_status: twilioStatus,
      live_status_mapped: mappedStatus,
      updated_call_id: row.id,
      matched_rows: rows.length
    })
  };
};
