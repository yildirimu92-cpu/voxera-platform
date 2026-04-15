const { createClient } = require('@supabase/supabase-js');
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
  const caller = await requireCustomerCaller({
    event,
    sbUrl,
    sbAnonKey,
    sbAdmin,
    requireActiveContract: false
  });

  if (!caller.ok) return response(caller.statusCode, caller.body);

  const state = caller.contractState || {
    status: 'none',
    hasContract: false,
    hasActiveContract: false,
    latestContract: null,
    effectiveContract: null,
    rows: []
  };

  return response(200, {
    success: true,
    customer_id: caller.customerId,
    state: {
      status: state.status || 'none',
      hasContract: state.hasContract === true,
      hasActiveContract: state.hasActiveContract === true,
      latestContract: state.latestContract || null,
      effectiveContract: state.effectiveContract || null,
      contracts: Array.isArray(state.rows) ? state.rows : []
    }
  });
};
