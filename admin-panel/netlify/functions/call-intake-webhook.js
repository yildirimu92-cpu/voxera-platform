const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function toStr(value) {
  if (value == null) return '';
  return String(value).trim();
}

function pickString(...values) {
  for (const value of values) {
    const normalized = toStr(value);
    if (normalized) return normalized;
  }
  return '';
}

function readJsonBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch (_e) {
    return null;
  }
}

function extractIncomingNumber(payload) {
  return pickString(
    payload.voxera_number,
    payload.called_number,
    payload.incoming_number,
    payload.to,
    payload.to_number,
    payload.call?.to,
    payload.call?.to_number,
    payload.call?.called_number,
    payload.call?.voxera_number
  );
}

function extractExternalCallId(payload) {
  return pickString(
    payload.call_id,
    payload.external_call_id,
    payload.elevenlabs_call_id,
    payload.call?.id,
    payload.call?.call_id,
    payload.call?.external_call_id,
    payload.id
  );
}

function normalizeDateOnly(isoLike) {
  if (!isoLike) return null;
  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function authorizeWebhook(event) {
  const requiredSecret = toStr(process.env.CALL_INTAKE_WEBHOOK_SECRET);
  if (!requiredSecret) return true;

  const authHeader = toStr(event.headers?.authorization || event.headers?.Authorization);
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const headerSecret = toStr(event.headers?.['x-webhook-secret'] || event.headers?.['X-Webhook-Secret']);
  const providedSecret = bearer || headerSecret;

  return Boolean(providedSecret) && providedSecret === requiredSecret;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  if (!authorizeWebhook(event)) {
    return response(401, { error: 'Unauthorized webhook request' });
  }

  const payload = readJsonBody(event);
  if (!payload) return response(400, { error: 'Invalid JSON payload' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbServiceKey) {
    return response(500, { error: 'Supabase configuration missing' });
  }

  const incomingNumber = extractIncomingNumber(payload);
  if (!incomingNumber) {
    return response(400, {
      error: 'incoming number missing',
      expected_any_of: ['voxera_number', 'called_number', 'incoming_number', 'to', 'to_number']
    });
  }

  const externalCallId = extractExternalCallId(payload);
  if (!externalCallId) {
    return response(400, {
      error: 'call id missing',
      expected_any_of: ['call_id', 'external_call_id', 'elevenlabs_call_id', 'call.id']
    });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('id, voxera_number')
    .eq('voxera_number', incomingNumber)
    .maybeSingle();

  if (customerError) {
    return response(500, { error: 'customer lookup failed', details: customerError.message });
  }

  if (!customer || !customer.id) {
    return response(422, {
      error: 'customer not found for incoming number',
      incoming_number: incomingNumber
    });
  }

  const createdAt = pickString(payload.created_at, payload.started_at, payload.call?.started_at) || new Date().toISOString();
  const callDate = normalizeDateOnly(createdAt);
  const rowId = pickString(payload.id, payload.record_id, externalCallId, `call_${crypto.randomUUID()}`);

  const callRow = {
    id: rowId,
    call_id: externalCallId,
    customer_id: customer.id,
    caller_name: pickString(payload.caller_name, payload.contact_name, payload.call?.caller_name) || null,
    caller_phone: pickString(payload.caller_phone, payload.from, payload.from_number, payload.call?.from) || null,
    called_number: pickString(payload.called_number, payload.to, payload.to_number, payload.call?.to, incomingNumber) || null,
    voxera_number: pickString(payload.voxera_number, payload.call?.voxera_number, incomingNumber) || null,
    date: callDate,
    created_date_raw: callDate,
    duration_seconds: Number.isFinite(Number(payload.duration_seconds)) ? Number(payload.duration_seconds) : null,
    summary: pickString(payload.summary, payload.call_summary, payload.call?.summary) || null,
    call_summary: pickString(payload.call_summary, payload.summary, payload.call?.summary) || null,
    call_summary_short: pickString(payload.call_summary_short, payload.summary_short, payload.call?.summary_short) || null,
    category: pickString(payload.category, payload.call_category, payload.call?.category) || null,
    quality: pickString(payload.quality, payload.call_quality, payload.call?.quality) || null,
    lead_quality: pickString(payload.lead_quality, payload.call?.lead_quality) || null,
    callback_requested: payload.callback_requested === true,
    dashboard_status: pickString(payload.dashboard_status, 'new'),
    next_action: pickString(payload.next_action, payload.call?.next_action) || null,
    follow_up_at: pickString(payload.follow_up_at, payload.call?.follow_up_at) || null,
    transcript: pickString(payload.transcript, payload.call?.transcript) || null,
    transcript_json: payload.transcript_json || payload.call?.transcript_json || null,
    status: pickString(payload.status, payload.call_status, payload.call?.status) || null,
    notes: pickString(payload.notes, payload.call?.notes) || null,
    direction: pickString(payload.direction, payload.call_direction, payload.call?.direction, 'inbound'),
    created_at: createdAt,
    updated_at: new Date().toISOString()
  };

  const { data: inserted, error: insertError } = await sbAdmin
    .from('calls')
    .upsert(callRow, { onConflict: 'call_id' })
    .select('id, call_id, customer_id, called_number, voxera_number, created_at')
    .single();

  if (insertError) {
    return response(500, { error: 'call insert failed', details: insertError.message });
  }

  return response(200, {
    success: true,
    call: inserted,
    mapping: {
      incoming_number: incomingNumber,
      customer_id: customer.id,
      call_id: externalCallId
    }
  });
};
