const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { normalizePhoneE164 } = require('./_lib/phone-normalize');
const { requireCustomerCaller } = require('./_lib/require-customer');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

async function createTwilioOutboundCall({ accountSid, authToken, from, to }) {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`;
  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const twiml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    '<Say language="de-DE" voice="alice">Dies ist ein automatischer Voxera Testanruf. Bitte legen Sie jetzt auf.</Say>',
    '<Pause length="1"/>',
    '<Hangup/>',
    '</Response>'
  ].join('');

  const body = new URLSearchParams({
    To: to,
    From: from,
    Twiml: twiml,
    Timeout: '12'
  });

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_e) { json = null; }

  if (!res.ok) {
    const message = json && json.message ? json.message : `Twilio HTTP ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.payload = json || text;
    throw error;
  }

  return json || {};
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });
  const requestId = toStr((event && event.headers && (event.headers['x-nf-request-id'] || event.headers['X-Nf-Request-Id'])) || '');
  console.log('[activation-start-system-test-call] function_invoked', {
    request_id: requestId || null,
    http_method: event.httpMethod
  });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    console.error('[activation-start-system-test-call] supabase_env_missing', {
      request_id: requestId || null,
      has_supabase_url: !!sbUrl,
      has_supabase_anon_key: !!sbAnonKey,
      has_supabase_service_role_key: !!sbServiceKey
    });
    return response(500, { error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.' });
  }

  const twilioAccountSid = toStr(process.env.TWILIO_ACCOUNT_SID);
  const twilioAuthToken = toStr(process.env.TWILIO_AUTH_TOKEN);
  const twilioFallbackFrom = normalizePhoneE164(toStr(process.env.TWILIO_OUTBOUND_FROM_NUMBER)).normalized;

  if (!twilioAccountSid || !twilioAuthToken) {
    console.error('[activation-start-system-test-call] twilio_env_missing', {
      request_id: requestId || null,
      has_twilio_account_sid: !!twilioAccountSid,
      has_twilio_auth_token: !!twilioAuthToken,
      has_twilio_outbound_from_number: !!twilioFallbackFrom
    });
    return response(500, {
      error: 'TWILIO_ACCOUNT_SID und TWILIO_AUTH_TOKEN muessen gesetzt sein.'
    });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);
  console.log('[activation-start-system-test-call] customer_context_resolved', {
    request_id: requestId || null,
    user_id: caller.userId,
    customer_id: caller.customerId
  });

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('id, tel_nr, voxera_number, forwarding_status, activation_started_at')
    .eq('id', caller.customerId)
    .single();

  if (customerError || !customer) {
    console.error('[activation-start-system-test-call] customer_resolve_failed', {
      request_id: requestId || null,
      customer_id: caller.customerId,
      error_message: customerError ? customerError.message : null
    });
    return response(500, { error: 'Kundendaten konnten nicht geladen werden. Bitte spaeter erneut versuchen.' });
  }

  const customerMainNumber = normalizePhoneE164(customer.tel_nr).normalized;
  const customerVoxeraNumber = normalizePhoneE164(customer.voxera_number).normalized;
  console.log('[activation-start-system-test-call] customer_resolved', {
    request_id: requestId || null,
    customer_id: customer.id,
    forwarding_status: customer.forwarding_status || null,
    activation_started_at: toStr(customer.activation_started_at) || null
  });
  console.log('[activation-start-system-test-call] tel_nr_checked', {
    request_id: requestId || null,
    customer_id: customer.id,
    tel_nr_raw: toStr(customer.tel_nr) || null,
    tel_nr_e164: customerMainNumber || null,
    tel_nr_valid: !!customerMainNumber
  });

  if (!customerMainNumber) {
    return response(400, { error: 'Keine gueltige Hauptnummer (tel_nr) fuer den Testanruf hinterlegt.' });
  }

  if (String(customer.forwarding_status || '').toLowerCase() !== 'pending_test') {
    return response(409, { error: 'Testanruf kann nur im Status pending_test gestartet werden.' });
  }

  const testSessionStartedAt = toStr(customer.activation_started_at);
  if (!testSessionStartedAt) {
    return response(409, { error: 'Aktivierungssitzung fehlt. Bitte Aktivierung zuerst starten.' });
  }

  const twilioFrom = twilioFallbackFrom || customerVoxeraNumber;
  if (!twilioFrom) {
    console.error('[activation-start-system-test-call] twilio_from_missing', {
      request_id: requestId || null,
      customer_id: customer.id,
      customer_voxera_number_e164: customerVoxeraNumber || null,
      twilio_fallback_from_e164: twilioFallbackFrom || null
    });
    return response(500, { error: 'Keine gueltige Absendernummer verfuegbar (voxera_number oder TWILIO_OUTBOUND_FROM_NUMBER).' });
  }

  const sessionMarker = `activation_test_session_started_at:${testSessionStartedAt}`;
  const { data: existingOutboundRows, error: existingOutboundError } = await sbAdmin
    .from('calls')
    .select('id, call_id, created_at')
    .eq('customer_id', customer.id)
    .eq('category', 'activation_test_outbound')
    .eq('notes', sessionMarker)
    .order('created_at', { ascending: true })
    .limit(1);

  if (existingOutboundError) {
    console.error('[activation-start-system-test-call] existing_outbound_lookup_failed', {
      request_id: requestId || null,
      customer_id: customer.id,
      error_message: existingOutboundError.message
    });
    return response(500, { error: 'Vorhandener Testanruf konnte nicht geprueft werden. Bitte erneut versuchen.' });
  }

  const existingOutbound = Array.isArray(existingOutboundRows) && existingOutboundRows.length ? existingOutboundRows[0] : null;
  if (existingOutbound) {
    const existingCallId = toStr(existingOutbound.call_id || existingOutbound.id);
    return response(200, {
      success: true,
      activation_test: {
        mode: 'system_call',
        outbound_started: true,
        reused_existing_outbound_call: true,
        outbound_call_id: existingCallId || null,
        started_at: toStr(existingOutbound.created_at) || null,
        customer_main_number: customerMainNumber
      }
    });
  }

  let twilioCall = null;
  try {
    console.log('[activation-start-system-test-call] twilio_request_start', {
      request_id: requestId || null,
      customer_id: customer.id,
      twilio_from: twilioFrom,
      twilio_to: customerMainNumber
    });
    twilioCall = await createTwilioOutboundCall({
      accountSid: twilioAccountSid,
      authToken: twilioAuthToken,
      from: twilioFrom,
      to: customerMainNumber
    });
    console.log('[activation-start-system-test-call] twilio_response_ok', {
      request_id: requestId || null,
      customer_id: customer.id,
      twilio_sid: toStr(twilioCall && twilioCall.sid) || null,
      twilio_status: toStr(twilioCall && twilioCall.status) || null
    });
  } catch (error) {
    console.error('[activation-start-system-test-call] twilio_request_failed', {
      request_id: requestId || null,
      customer_id: customer.id,
      error_code: error && error.code ? error.code : null,
      error_message: error && error.message ? error.message : 'Unknown Twilio error',
      twilio_status: error && error.status ? error.status : null
    });
    return response(502, {
      error: 'Outbound-Testanruf konnte nicht gestartet werden.',
      details: error.message,
      twilio_status: error.status || null
    });
  }

  const nowIso = new Date().toISOString();
  const callSid = toStr(twilioCall.sid) || `activation_test_${crypto.randomUUID()}`;

  const outboundRow = {
    call_id: callSid,
    caller_name: 'Testanruf Voxera',
    customer_id: customer.id,
    caller_phone: twilioFrom,
    called_number: customerMainNumber,
    voxera_number: customerVoxeraNumber || twilioFrom,
    direction: 'outbound',
    dashboard_status: 'new',
    status: 'started',
    category: 'activation_test_outbound',
    notes: sessionMarker,
    created_at: nowIso,
    updated_at: nowIso
  };

  const { error: insertError } = await sbAdmin
    .from('calls')
    .upsert(outboundRow, { onConflict: 'call_id' });

  if (insertError) {
    console.error('[activation-start-system-test-call] call_persist_failed', {
      request_id: requestId || null,
      customer_id: customer.id,
      call_id: callSid,
      error_message: insertError.message
    });
    return response(200, {
      success: true,
      activation_test: {
        mode: 'system_call',
        outbound_started: true,
        outbound_call_id: callSid,
        started_at: nowIso,
        customer_main_number: customerMainNumber,
        persistence_warning: 'call_row_not_persisted'
      }
    });
  }

  return response(200, {
    success: true,
    activation_test: {
      mode: 'system_call',
      outbound_started: true,
      outbound_call_id: callSid,
      started_at: nowIso,
      customer_main_number: customerMainNumber
    }
  });
};
