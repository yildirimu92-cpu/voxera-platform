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

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, { error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.' });
  }

  const twilioAccountSid = toStr(process.env.TWILIO_ACCOUNT_SID);
  const twilioAuthToken = toStr(process.env.TWILIO_AUTH_TOKEN);
  const twilioFallbackFrom = normalizePhoneE164(toStr(process.env.TWILIO_OUTBOUND_FROM_NUMBER)).normalized;

  if (!twilioAccountSid || !twilioAuthToken) {
    return response(500, {
      error: 'TWILIO_ACCOUNT_SID und TWILIO_AUTH_TOKEN muessen gesetzt sein.'
    });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('id, tel_nr, voxera_number, forwarding_status, activation_started_at')
    .eq('id', caller.customerId)
    .single();

  if (customerError || !customer) {
    return response(500, { error: 'Kundendaten konnten nicht geladen werden.', details: customerError ? customerError.message : null });
  }

  const customerMainNumber = normalizePhoneE164(customer.tel_nr).normalized;
  const customerVoxeraNumber = normalizePhoneE164(customer.voxera_number).normalized;

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

  const twilioFrom = customerVoxeraNumber || twilioFallbackFrom;
  if (!twilioFrom) {
    return response(500, { error: 'Keine gueltige Absendernummer verfuegbar (voxera_number oder TWILIO_OUTBOUND_FROM_NUMBER).' });
  }

  let twilioCall = null;
  try {
    twilioCall = await createTwilioOutboundCall({
      accountSid: twilioAccountSid,
      authToken: twilioAuthToken,
      from: twilioFrom,
      to: customerMainNumber
    });
  } catch (error) {
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
    customer_id: customer.id,
    caller_phone: twilioFrom,
    called_number: customerMainNumber,
    voxera_number: customerVoxeraNumber || twilioFrom,
    direction: 'outbound',
    dashboard_status: 'new',
    status: 'started',
    category: 'activation_test_outbound',
    notes: `activation_test_session_started_at:${testSessionStartedAt}`,
    created_at: nowIso,
    updated_at: nowIso
  };

  const { error: insertError } = await sbAdmin
    .from('calls')
    .upsert(outboundRow, { onConflict: 'call_id' });

  if (insertError) {
    return response(500, { error: 'Outbound-Testanruf wurde gestartet, aber nicht gespeichert.', details: insertError.message });
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
