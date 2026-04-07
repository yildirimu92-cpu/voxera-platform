// netlify/functions/contract-signed.js
//
// Called after a contract is signed in the admin panel.
// Forwards contract details to the Make.com webhook (MAKE_CONTRACT_WEBHOOK)
// so that a confirmation e-mail can be sent to the customer.
//
// Accepts (POST JSON):
//   contract_id, customer_id, customer_email, customer_name,
//   plan, contract_text, signed_at
//
// Returns:
//   { success: true }

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

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
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbServiceKey || !sbAnonKey) {
    return response(500, { error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Guard: Admin authentication
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) {
    return response(caller.statusCode, caller.body);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return response(400, { error: 'Ungültiger Request Body' }); }

  const { contract_id, customer_id, customer_email, customer_name, plan, contract_text, signed_at } = body;

  // Guard: Validate required fields
  if (!contract_id || !customer_id || !customer_email || !customer_name) {
    return response(400, { error: 'Missing required fields: contract_id, customer_id, customer_email, customer_name' });
  }

  // Call Make.com webhook
  const makeWebhook = process.env.MAKE_CONTRACT_WEBHOOK;
  if (!makeWebhook) {
    console.error('MAKE_CONTRACT_WEBHOOK not configured');
    return response(500, { error: 'MAKE_CONTRACT_WEBHOOK not configured' });
  }

  try {
    const makeResponse = await fetch(makeWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contract_id,
        customer_id,
        customer_email,
        customer_name,
        plan: plan || '',
        contract_text: contract_text || '',
        signed_at: signed_at || new Date().toISOString(),
        action: 'contract_signed'
      })
    });

    if (!makeResponse.ok) {
      throw new Error(`Make webhook failed: ${makeResponse.status}`);
    }

    return response(200, { success: true, message: 'Contract signed and webhook triggered' });
  } catch (err) {
    console.error('contract-signed error:', err);
    return response(500, { error: err.message || 'Internal server error' });
  }
};
