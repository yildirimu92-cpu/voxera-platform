const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { normalizePhoneE164 } = require('./_lib/phone-normalize');

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

function normalizeCallDirection(...values) {
  const raw = pickString(...values).toLowerCase();
  if (raw === 'outbound') return 'outbound';
  return 'inbound';
}

function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
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
    payload.CallSid,
    payload.call_sid,
    payload.callSid,
    payload.call_id,
    payload.external_call_id,
    payload.elevenlabs_call_id,
    payload.call?.CallSid,
    payload.call?.call_sid,
    payload.call?.callSid,
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

function detectLifecyclePhase(payload) {
  const marker = pickString(
    payload.lifecycle_phase,
    payload.phase,
    payload.event_type,
    payload.event,
    payload.type,
    payload.call?.event_type,
    payload.call?.event,
    payload.call_status,
    payload.status,
    payload.call?.status
  ).toLowerCase();

  if (!marker) return 'completed';
  if (
    marker.includes('start') ||
    marker.includes('initiated') ||
    marker.includes('ringing') ||
    marker.includes('queued') ||
    marker.includes('in-progress') ||
    marker.includes('in_progress')
  ) {
    return 'started';
  }
  if (marker.includes('abandon') || marker.includes('no-answer') || marker.includes('no_answer')) {
    return 'abandoned';
  }
  return 'completed';
}

function buildOptionalCallPatch(payload, lifecyclePhase) {
  const patch = {};

  const maybeSet = (column, ...values) => {
    const value = pickString(...values);
    if (value) patch[column] = value;
  };

  const maybeSetPhone = (column, ...values) => {
    const normalized = normalizePhoneE164(pickString(...values)).normalized;
    if (normalized) patch[column] = normalized;
  };

  maybeSet('caller_name', payload.caller_name, payload.name, payload.full_name, payload.customer_name, payload.contact_name, payload.callerName, payload.caller?.name, payload.call?.caller_name, payload.call?.name);
  maybeSet('summary', payload.summary, payload.call_summary, payload.call?.summary);
  maybeSet('call_summary', payload.call_summary, payload.summary, payload.call?.summary);
  maybeSet('call_summary_short', payload.call_summary_short, payload.summary_short, payload.call?.summary_short);
  maybeSet('category', payload.category, payload.call_category, payload.call?.category);
  maybeSet('quality', payload.quality, payload.call_quality, payload.call?.quality);
  maybeSet('lead_quality', payload.lead_quality, payload.call?.lead_quality);
  maybeSet('next_action', payload.next_action, payload.call?.next_action);
  maybeSet('follow_up_at', payload.follow_up_at, payload.call?.follow_up_at);
  maybeSet('transcript', payload.transcript, payload.call?.transcript);
  maybeSet('notes', payload.notes, payload.call?.notes);
  patch.direction = normalizeCallDirection(payload.direction, payload.call_direction, payload.call?.direction);
  maybeSet('dashboard_status', payload.dashboard_status);
  maybeSet('status', payload.status, payload.call_status, payload.call?.status);

  maybeSetPhone('called_number', payload.called_number, payload.to, payload.to_number, payload.call?.to);
  maybeSetPhone('voxera_number', payload.voxera_number, payload.call?.voxera_number);
  maybeSetPhone('caller_phone', payload.caller_phone, payload.from, payload.from_number, payload.call?.from);

  if (payload.transcript_json || payload.call?.transcript_json) {
    patch.transcript_json = payload.transcript_json || payload.call?.transcript_json;
  }
  if (hasOwn(payload, 'callback_requested')) {
    patch.callback_requested = payload.callback_requested === true;
  }
  if (hasOwn(payload, 'duration_seconds')) {
    const parsedDuration = Number(payload.duration_seconds);
    patch.duration_seconds = Number.isFinite(parsedDuration) ? parsedDuration : null;
  }

  if (!patch.dashboard_status) {
    patch.dashboard_status = lifecyclePhase === 'completed' ? 'in_progress' : 'new';
  }
  if (!patch.status) {
    patch.status = lifecyclePhase;
  }

  return patch;
}

function inferActivationTestCategory({ customer, callRow }) {
  if (!customer || String(customer.forwarding_status || '').toLowerCase() !== 'pending_test') return '';
  const direction = String(callRow.direction || '').toLowerCase();
  if (direction !== 'inbound') return '';
  const startedAtMs = new Date(customer.activation_started_at || '').getTime();
  const createdAtMs = new Date(callRow.created_at || '').getTime();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(createdAtMs) || createdAtMs < startedAtMs) return '';
  return 'activation_test_inbound';
}

function constantTimeSecretEquals(expected, provided) {
  const expectedDigest = crypto.createHash('sha256').update(String(expected)).digest();
  const providedDigest = crypto.createHash('sha256').update(String(provided)).digest();
  return crypto.timingSafeEqual(expectedDigest, providedDigest);
}

function authorizeWebhook(event) {
  const requiredSecret = toStr(process.env.CALL_INTAKE_WEBHOOK_SECRET);
  if (!requiredSecret) return { ok: false, configurationMissing: true };

  const authHeader = toStr(event.headers?.authorization || event.headers?.Authorization);
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const headerSecret = toStr(event.headers?.['x-webhook-secret'] || event.headers?.['X-Webhook-Secret']);
  const providedSecret = bearer || headerSecret;

  return {
    ok: Boolean(providedSecret) && constantTimeSecretEquals(requiredSecret, providedSecret),
    configurationMissing: false
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const webhookAuthorization = authorizeWebhook(event);
  if (webhookAuthorization.configurationMissing) {
    console.error('[call-intake-webhook] CALL_INTAKE_WEBHOOK_SECRET is missing; refusing intake.');
    return response(503, {
      error: 'Webhook security configuration missing',
      error_code: 'webhook_secret_missing'
    });
  }
  if (!webhookAuthorization.ok) {
    return response(401, { error: 'Unauthorized webhook request' });
  }

  const payload = readJsonBody(event);
  if (!payload) return response(400, { error: 'Invalid JSON payload' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbServiceKey) {
    return response(500, { error: 'Supabase configuration missing' });
  }

  const incomingNumberRaw = extractIncomingNumber(payload);
  const normalizedIncoming = normalizePhoneE164(incomingNumberRaw);
  const incomingNumber = normalizedIncoming.normalized;
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

  let customer = null;
  const { data: exactMatch, error: customerError } = await sbAdmin
    .from('customers')
    .select('id, voxera_number, forwarding_status, activation_started_at')
    .eq('voxera_number', incomingNumber)
    .maybeSingle();

  if (customerError) {
    return response(500, { error: 'customer lookup failed', details: customerError.message });
  }

  customer = exactMatch;

  if (!customer) {
    const { data: candidates, error: candidateError } = await sbAdmin
      .from('customers')
      .select('id, voxera_number, forwarding_status, activation_started_at')
      .not('voxera_number', 'is', null)
      .limit(5000);

    if (candidateError) {
      return response(500, { error: 'customer candidate lookup failed', details: candidateError.message });
    }

    customer = (candidates || []).find((row) => normalizePhoneE164(row.voxera_number).normalized === incomingNumber) || null;
  }

  if (!customer || !customer.id) {
    return response(422, {
      error: 'customer not found for incoming number',
      incoming_number: incomingNumber,
      incoming_number_raw: incomingNumberRaw || null
    });
  }

  const createdAt = pickString(payload.created_at, payload.started_at, payload.call?.started_at) || new Date().toISOString();
  const lifecyclePhase = detectLifecyclePhase(payload);
  const callDate = normalizeDateOnly(createdAt);
  const rowId = pickString(payload.id, payload.record_id, `call_${externalCallId}`, `call_${crypto.randomUUID()}`);

  const provisionalRow = {
    id: rowId,
    call_id: externalCallId,
    customer_id: customer.id,
    caller_phone: normalizePhoneE164(pickString(payload.caller_phone, payload.from, payload.from_number, payload.call?.from)).normalized || null,
    called_number: normalizePhoneE164(pickString(payload.called_number, payload.to, payload.to_number, payload.call?.to, incomingNumber)).normalized || null,
    voxera_number: normalizePhoneE164(pickString(payload.voxera_number, payload.call?.voxera_number, incomingNumber)).normalized || null,
    date: callDate,
    created_date_raw: callDate,
    callback_requested: payload.callback_requested === true,
    dashboard_status: 'new',
    status: lifecyclePhase,
    direction: normalizeCallDirection(payload.direction, payload.call_direction, payload.call?.direction),
    created_at: createdAt,
    updated_at: new Date().toISOString()
  };

  const finalPatch = buildOptionalCallPatch(payload, lifecyclePhase);
  const callRow = { ...provisionalRow, ...finalPatch };
  if (!toStr(callRow.category)) {
    const inferredCategory = inferActivationTestCategory({ customer, callRow });
    if (inferredCategory) {
      callRow.category = inferredCategory;
      callRow.caller_name = callRow.caller_name || 'Testanruf Voxera';
    }
  }

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
