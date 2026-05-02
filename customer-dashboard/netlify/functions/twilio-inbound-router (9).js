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

function twimlRedirectResponse() {
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Redirect method="POST">${ELEVENLABS_INBOUND_URL}</Redirect>\n</Response>`;
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
    return twimlRedirectResponse();
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[twilio-inbound-router] Supabase env missing');
    return twimlRedirectResponse();
  }

  const toNormalized = normalizePhoneE164(toRaw).normalized || toRaw;
  const fromNormalized = normalizePhoneE164(fromRaw).normalized || fromRaw;

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
      created_at: new Date().toISOString()
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

  console.log('[twilio-inbound-router] redirected to ElevenLabs', { callSid });
  return twimlRedirectResponse();
};
