const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { normalizeCustomerStatus, assertCustomerTransition } = require('./_lib/status-model');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
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

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return response(400, { error: 'Ungueltiger Request Body' }); }

  const customerId = String(body.customer_id || '').trim();
  const targetStatus = normalizeCustomerStatus(body.status);
  if (!customerId) return response(400, { error: 'customer_id fehlt' });

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();
  if (customerError) return response(500, { error: 'Customer lookup failed', details: customerError.message });
  if (!customer) return response(404, { error: 'Customer nicht gefunden' });

  const currentStatus = normalizeCustomerStatus(customer.status);
  try {
    assertCustomerTransition(currentStatus, targetStatus);
  } catch (e) {
    return response(409, { error: e.message, from_status: currentStatus, to_status: targetStatus });
  }

  const { data, error } = await sbAdmin
    .from('customers')
    .update({ status: targetStatus, updated_at: new Date().toISOString() })
    .eq('id', customerId)
    .select('*')
    .single();
  if (error) return response(500, { error: 'Customer-Status konnte nicht gespeichert werden.', details: error.message });

  return response(200, { success: true, customer: data });
};
