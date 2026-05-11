const querystring = require('querystring');
const { createClient } = require('@supabase/supabase-js');
const { normalizePhoneE164 } = require('./_lib/phone-normalize');

const ELEVENLABS_INBOUND_URL = 'https://api.us.elevenlabs.io/twilio/inbound_call';


function normalizeBaseUrl(rawUrl) {
  const raw = toStringOrEmpty(rawUrl);
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProtocol);
    return `${u.protocol}//${u.host}`;
  } catch (_err) {
    return '';
  }
}

function resolveStatusCallbackUrl() {
  const baseUrl = normalizeBaseUrl(
    process.env.TWILIO_STATUS_CALLBACK_BASE_URL
    || process.env.URL
    || process.env.DEPLOY_PRIME_URL
    || process.env.DEPLOY_URL
  );
  if (!baseUrl) return '';
  return `${baseUrl}/twilio/status-callback`;
}

function validateStatusCallbackUrl(candidateUrl) {
  const raw = toStringOrEmpty(candidateUrl);
  if (!raw) return { ok: false, reason: 'empty_url' };

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') {
      return { ok: false, reason: 'non_https_url' };
    }
    if (!parsed.hostname) {
      return { ok: false, reason: 'missing_hostname' };
    }
    return { ok: true, url: parsed.toString() };
  } catch (_error) {
    return { ok: false, reason: 'invalid_url' };
  }
}

function buildElevenLabsInboundUrl(statusCallbackUrl) {
  const u = new URL(ELEVENLABS_INBOUND_URL);
  if (statusCallbackUrl) {
    u.searchParams.set('statusCallback', statusCallbackUrl);
    ['initiated', 'ringing', 'answered', 'completed'].forEach((evt) => {
      u.searchParams.append('statusCallbackEvent', evt);
    });
  }
  return u.toString();
}

async function attachTwilioStatusCallback(callSid, statusCallbackUrl) {
  try {
    const accountSid = toStringOrEmpty(process.env.TWILIO_ACCOUNT_SID);
    const authToken = toStringOrEmpty(process.env.TWILIO_AUTH_TOKEN);
    if (!callSid || !statusCallbackUrl || !accountSid || !authToken) {
      return { ok: false, skipped: true, reason: 'missing_config_or_input' };
    }

  const params = new URLSearchParams();
  params.set('StatusCallback', statusCallbackUrl);
  params.set('StatusCallbackMethod', 'POST');
  ['initiated', 'ringing', 'answered', 'completed'].forEach((evt) => {
    params.append('StatusCallbackEvent', evt);
  });

    const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${encodeURIComponent(callSid)}.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!resp.ok) {
      const text = await resp.text();
      return { ok: false, skipped: false, reason: 'twilio_api_error', status: resp.status, body: text.slice(0, 500) };
    }

    return { ok: true, skipped: false };
  } catch (error) {
    return { ok: false, skipped: false, reason: 'exception', error: error.message };
  }
}

function parseBody(event) {
  const body = event.body || '';
  if (!body) return {};
  if (event.isBase64Encoded) {
    const decoded = Buffer.from(body, 'base64').toString('utf8');
    return querystring.parse(decoded);
  }
  return querystring.parse(body);
}

function toStringOrEmpty(value) {
  if (value == null) return '';
  return String(value).trim();
}

function twimlRedirectResponse(statusCallbackUrl) {
  const elevenLabsTarget = buildElevenLabsInboundUrl(statusCallbackUrl);
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Redirect method="POST">${elevenLabsTarget}</Redirect>\n</Response>`;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
    body
  };
}

async function resolveCustomerByVoxeraNumber(supabaseAdmin, calledNumber) {
  const { data: exactMatch, error: exactError } = await supabaseAdmin
    .from('customers')
    .select('id, voxera_number, forwarding_status')
    .eq('voxera_number', calledNumber)
    .maybeSingle();

  if (exactError) throw new Error(`customer exact lookup failed: ${exactError.message}`);
  if (exactMatch?.id) return exactMatch;

  const { data: candidates, error: candidateError } = await supabaseAdmin
    .from('customers')
    .select('id, voxera_number, forwarding_status')
    .not('voxera_number', 'is', null)
    .limit(5000);

  if (candidateError) throw new Error(`customer candidate lookup failed: ${candidateError.message}`);

  return (
    (candidates || []).find((row) => normalizePhoneE164(row.voxera_number).normalized === calledNumber) || null
  );
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
  const callSid = toStringOrEmpty(payload.CallSid);
  const fromRaw = toStringOrEmpty(payload.From);
  const toRaw = toStringOrEmpty(payload.To);

  console.log('[twilio-inbound-router] inbound received', {
    callSid: callSid || null,
    from: fromRaw || null,
    to: toRaw || null
  });

  if (!callSid || !toRaw) {
    console.error('[twilio-inbound-router] missing mandatory fields', {
      hasCallSid: Boolean(callSid),
      hasTo: Boolean(toRaw)
    });
    return twimlRedirectResponse(resolveStatusCallbackUrl());
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[twilio-inbound-router] Supabase env missing');
    return twimlRedirectResponse(resolveStatusCallbackUrl());
  }

  const toNormalized = normalizePhoneE164(toRaw).normalized || toRaw;
  const fromNormalized = normalizePhoneE164(fromRaw).normalized || fromRaw;
  const resolvedStatusCallbackUrl = resolveStatusCallbackUrl();
  const callbackValidation = validateStatusCallbackUrl(resolvedStatusCallbackUrl);
  const statusCallbackUrl = callbackValidation.ok ? callbackValidation.url : '';
  if (!callbackValidation.ok) {
    console.warn('[twilio-inbound-router] callback config', {
      callSid,
      callbackAttachSkippedReason: callbackValidation.reason
    });
  }

  // ─── Loop-Erkennung ──────────────────────────────────────────────────────
  if (fromNormalized === toNormalized) {
    console.warn('[twilio-inbound-router] loop call detected, rejecting', { callSid });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>'
    };
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    const customer = await resolveCustomerByVoxeraNumber(supabaseAdmin, toNormalized);

    console.log('[twilio-inbound-router] customer resolved', {
      callSid,
      to: toNormalized,
      customerId: customer?.id || null
    });

    // ─── Sofortiger INSERT beim Anrufstart ───────────────────────────────────
    // Damit erscheint der Anruf sofort live im Dashboard via Realtime-Subscribe.
    // live_status = 'incoming' signalisiert dem Dashboard: Anruf läuft GERADE.
    // elevenlabs-post-call wechselt später auf 'analyzing' und finalisiert mit 'completed'.
    const callRecord = {
      call_id: callSid,
      customer_id: customer?.id || null,
      caller_phone: fromNormalized || null,
      called_number: toNormalized || null,
      voxera_number: toNormalized || null,
      direction: 'inbound',
      dashboard_status: 'new',
      category: 'inbound',
      live_status: 'incoming',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { error: insertError } = await supabaseAdmin
      .from('calls')
      .insert(callRecord);

    if (insertError) {
      console.error('[twilio-inbound-router] insert failed', {
        callSid,
        error: insertError.message
      });
    } else {
      console.log('[twilio-inbound-router] call record inserted', { callSid, customerId: customer?.id || null });
    }

  } catch (error) {
    console.error('[twilio-inbound-router] error', { callSid, error: error.message });
    // Fehler niemals den ElevenLabs-Redirect blockieren
  }

  const callbackAttachAttempted = Boolean(callSid && statusCallbackUrl);
  console.log('[twilio-inbound-router] callback attach state', {
    callSid,
    callbackAttachAttempted
  });

  if (callbackAttachAttempted) {
    const callbackAttach = await attachTwilioStatusCallback(callSid, statusCallbackUrl);
    if (callbackAttach.ok) {
      console.log('[twilio-inbound-router] callback attach success', {
        callSid,
        callbackAttachAttempted: true
      });
    } else if (callbackAttach.skipped) {
      console.warn('[twilio-inbound-router] callback attach skipped', {
        callSid,
        callbackAttachAttempted: true,
        callbackAttachSkippedReason: callbackAttach.reason || 'unknown'
      });
    } else {
      console.warn('[twilio-inbound-router] callback attach failed', {
        callSid,
        callbackAttachAttempted: true,
        callbackAttachFailedReason: callbackAttach.reason || 'unknown',
        status: callbackAttach.status || null
      });
    }
  }

  console.log('[twilio-inbound-router] redirected to ElevenLabs', {
    callSid,
    statusCallbackUrl: statusCallbackUrl || null,
    twimlReturned: true
  });
  return twimlRedirectResponse(statusCallbackUrl);
};
