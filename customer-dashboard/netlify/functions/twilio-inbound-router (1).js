const querystring = require('querystring');
const { createClient } = require('@supabase/supabase-js');
const { normalizePhoneE164 } = require('./_lib/phone-normalize');

const ELEVENLABS_INBOUND_URL = 'https://api.us.elevenlabs.io/twilio/inbound_call';

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

function getTimestamp(payload) {
  return (
    toStringOrEmpty(payload.Timestamp) ||
    toStringOrEmpty(payload.timestamp) ||
    toStringOrEmpty(payload.CallTimestamp) ||
    toStringOrEmpty(payload.call_timestamp)
  );
}

function twimlRedirectResponse() {
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Redirect method="POST">${ELEVENLABS_INBOUND_URL}</Redirect>\n</Response>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body
  };
}

async function resolveCustomerByVoxeraNumber(supabaseAdmin, calledNumber) {
  const { data: exactMatch, error: exactError } = await supabaseAdmin
    .from('customers')
    .select('id, voxera_number, forwarding_status, activation_started_at')
    .eq('voxera_number', calledNumber)
    .maybeSingle();

  if (exactError) throw new Error(`customer exact lookup failed: ${exactError.message}`);
  if (exactMatch?.id) return exactMatch;

  const { data: candidates, error: candidateError } = await supabaseAdmin
    .from('customers')
    .select('id, voxera_number, forwarding_status, activation_started_at')
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
  const inboundTimestamp = getTimestamp(payload);

  console.log('[twilio-inbound-router] inbound received', {
    callSid: callSid || null,
    from: fromRaw || null,
    to: toRaw || null,
    timestamp: inboundTimestamp || null
  });

  if (!callSid || !toRaw) {
    console.error('[twilio-inbound-router] missing mandatory Twilio payload fields', {
      hasCallSid: Boolean(callSid),
      hasTo: Boolean(toRaw)
    });
    console.log('[twilio-inbound-router] redirected to ElevenLabs');
    return twimlRedirectResponse();
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[twilio-inbound-router] Supabase env missing', {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseServiceRoleKey: Boolean(supabaseServiceRoleKey)
    });
    console.log('[twilio-inbound-router] redirected to ElevenLabs');
    return twimlRedirectResponse();
  }

  const toNormalized = normalizePhoneE164(toRaw).normalized || toRaw;
  const fromNormalized = normalizePhoneE164(fromRaw).normalized || fromRaw;

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

    // ── Loop-Erkennung ───────────────────────────────────────────────────────
    // Nach dem ElevenLabs-Gespräch macht Twilio manchmal einen zweiten Anruf
    // von der Outbound-Nummer zurück zur Voxera-Nummer. Das ist ein interner
    // Loop der nicht weitergeleitet werden soll.
    // Erkennungskriterium: From = TWILIO_OUTBOUND_FROM_NUMBER oder From = To
    const outboundFromNumber = normalizePhoneE164(
      toStringOrEmpty(process.env.TWILIO_OUTBOUND_FROM_NUMBER)
    ).normalized || '';
    const isLoopCall = (outboundFromNumber && fromNormalized === outboundFromNumber && fromNormalized === toNormalized)
      || fromNormalized === toNormalized;

    if (isLoopCall) {
      console.warn('[twilio-inbound-router] loop call detected, rejecting silently', {
        callSid, from: fromNormalized, to: toNormalized
      });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
        body: '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>'
      };
    }

    if (customer?.id) {
      const activationPending = String(customer.forwarding_status || '').toLowerCase() === 'pending_test';
      const provisionalRow = {
        call_id: callSid,
        customer_id: customer.id,
        caller_name: activationPending ? 'Testanruf Voxera' : null,
        caller_phone: fromNormalized || null,
        called_number: toNormalized,
        voxera_number: toNormalized,
        direction: 'inbound',
        category: activationPending ? 'activation_test_inbound' : null,
        dashboard_status: 'new',
        status: 'new',
        created_at: new Date().toISOString()
      };

      const { error: upsertError } = await supabaseAdmin
        .from('calls')
        .upsert(provisionalRow, { onConflict: 'call_id' });

      if (upsertError) {
        console.error('[twilio-inbound-router] provisional insert failed', {
          callSid,
          error: upsertError.message
        });
      } else {
        console.log('[twilio-inbound-router] provisional inserted', { callSid, customerId: customer.id });
      }
    } else {
      console.warn('[twilio-inbound-router] customer not found; provisional insert skipped', {
        callSid,
        to: toNormalized
      });
    }
  } catch (error) {
    console.error('[twilio-inbound-router] database handling failed', {
      callSid,
      error: error.message
    });
  }

  console.log('[twilio-inbound-router] redirected to ElevenLabs', {
    callSid,
    redirectUrl: ELEVENLABS_INBOUND_URL
  });
  return twimlRedirectResponse();
};
