'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = {
  'Access-Control-Allow-Origin': 'https://admin.voxera.ch',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

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
    requiredCapability: 'customer:read'
  });
  if (!guard.ok) return response(guard.statusCode, guard.body);

  const [{ data: customer, error: customerError }, { data: logs, error: logError }] = await Promise.all([
    sb.from('customers')
      .select('id, elevenlabs_agent_id, elevenlabs_last_sync_at, elevenlabs_sync_status, elevenlabs_sync_error')
      .eq('id', customerId)
      .maybeSingle(),
    sb.from('elevenlabs_sync_log')
      .select('id, customer_id, agent_id, status, triggered_by, prompt_length, error_message, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(20)
  ]);

  if (customerError) return response(500, { error: 'Sync-Status konnte nicht geladen werden.' });
  if (!customer) return response(404, { error: 'Kunde nicht gefunden.' });
  if (logError) return response(500, { error: 'Sync-Historie konnte nicht geladen werden.' });

  return response(200, {
    success: true,
    customer: {
      id: customer.id,
      agent_id: customer.elevenlabs_agent_id || null,
      sync_status: customer.elevenlabs_sync_status || 'never',
      last_sync_at: customer.elevenlabs_last_sync_at || null,
      sync_error: customer.elevenlabs_sync_error || null
    },
    logs: logs || []
  });
};
