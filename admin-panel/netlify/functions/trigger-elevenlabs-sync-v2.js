'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SYNC_TIMEOUT_MS = 24_000;

const headers = {
  'Access-Control-Allow-Origin': 'https://admin.voxera.ch',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

function siteBaseUrl(event) {
  const configured = process.env.DEPLOY_PRIME_URL || process.env.URL || process.env.ADMIN_URL;
  if (configured) return String(configured).replace(/\/$/, '');
  const host = event.headers?.host || event.headers?.Host;
  const proto = event.headers?.['x-forwarded-proto'] || 'https';
  return host ? `${proto}://${host}` : 'https://admin.voxera.ch';
}

async function setSyncState(sb, customerId, status, errorMessage = null) {
  const patch = {
    elevenlabs_sync_status: status,
    elevenlabs_sync_error: errorMessage,
    updated_at: new Date().toISOString()
  };
  if (status !== 'syncing') patch.elevenlabs_last_sync_at = new Date().toISOString();
  const { error } = await sb.from('customers').update(patch).eq('id', customerId);
  if (error) console.warn('[trigger-elevenlabs-sync-v2] state update failed', error.message);
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    return response(500, { error: 'Supabase-Konfiguration fehlt.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_error) { return response(400, { error: 'Ungültiger Request Body.' }); }

  const customerId = String(body.customer_id || '').trim();
  if (!customerId) return response(400, { error: 'Kunde fehlt.' });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const guard = await requireAdminCaller({
    event,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    sbAdmin: sb,
    requiredCapability: 'customer:write'
  });
  if (!guard.ok) return response(guard.statusCode, guard.body);

  const { data: customer, error: customerError } = await sb
    .from('customers')
    .select('id, elevenlabs_agent_id')
    .eq('id', customerId)
    .maybeSingle();
  if (customerError) return response(500, { error: 'Kunde konnte nicht geladen werden.' });
  if (!customer) return response(404, { error: 'Kunde nicht gefunden.' });

  const agentId = String(customer.elevenlabs_agent_id || '').trim();
  if (!agentId) {
    return response(409, {
      error: 'Für diesen Kunden ist noch kein ElevenLabs-Agent hinterlegt.',
      error_code: 'agent_missing'
    });
  }
  const requestedAgentId = String(body.agent_id || '').trim();
  if (requestedAgentId && requestedAgentId !== agentId) {
    return response(409, {
      error: 'Die Agent-ID stimmt nicht mit dem Kundenkonto überein.',
      error_code: 'agent_mismatch'
    });
  }

  await setSyncState(sb, customerId, 'syncing');
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const started = Date.now();

  try {
    const upstream = await fetchWithTimeout(`${siteBaseUrl(event)}/.netlify/functions/trigger-elevenlabs-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify({
        customer_id: customerId,
        agent_id: agentId,
        triggered_by: body.triggered_by || 'admin_save',
        prev_values: body.prev_values || {}
      })
    });

    let payload = {};
    try { payload = await upstream.json(); }
    catch (_error) { payload = {}; }

    if (!upstream.ok || payload.success === false) {
      const message = String(payload.error || `ElevenLabs-Sync fehlgeschlagen (HTTP ${upstream.status}).`).slice(0, 500);
      await setSyncState(sb, customerId, 'failed', message);
      return response(upstream.status >= 400 ? upstream.status : 502, {
        success: false,
        error: message,
        error_code: payload.error_code || 'sync_failed',
        duration_ms: Date.now() - started
      });
    }

    return response(200, {
      ...payload,
      success: true,
      customer_id: customerId,
      agent_id: agentId,
      duration_ms: Date.now() - started
    });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    const message = timedOut
      ? 'Der ElevenLabs-Sync hat nicht innerhalb von 24 Sekunden geantwortet.'
      : 'Der ElevenLabs-Sync konnte nicht gestartet werden.';
    await setSyncState(sb, customerId, 'failed', message);
    console.warn('[trigger-elevenlabs-sync-v2]', error?.message || error);
    return response(timedOut ? 504 : 502, {
      success: false,
      error: message,
      error_code: timedOut ? 'sync_timeout' : 'sync_transport_failed',
      duration_ms: Date.now() - started
    });
  }
};
