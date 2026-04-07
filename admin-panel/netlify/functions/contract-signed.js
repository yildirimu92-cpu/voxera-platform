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
const { createOutboxEvent, markOutboxSent, markOutboxFailed } = require('./_lib/webhook-outbox');

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

  const payload = {
    contract_id,
    customer_id,
    customer_email,
    customer_name,
    plan: plan || '',
    contract_text: contract_text || '',
    signed_at: signed_at || new Date().toISOString(),
    action: 'contract_signed'
  };
  let outbox;
  try {
    outbox = await createOutboxEvent(sbAdmin, {
      eventType: 'contract_signed_notification',
      payload,
      payloadSummary: `contract_signed -> ${customer_email}`
    });
  } catch (outboxErr) {
    const msg = outboxErr && outboxErr.message ? outboxErr.message : 'outbox insert failed';
    console.error(JSON.stringify({ level: 'error', event: 'outbox_insert_failed', event_type: 'contract_signed_notification', customer_id, error: msg }));
    return response(500, { error: 'Webhook-Outbox konnte nicht gespeichert werden.', details: msg });
  }
  console.log(JSON.stringify({ level: 'info', event: 'webhook_send_attempt', event_type: 'contract_signed_notification', outbox_id: outbox.id, customer_id }));

  // Call Make.com webhook
  const makeWebhook = process.env.MAKE_CONTRACT_WEBHOOK;
  if (!makeWebhook) {
    await markOutboxFailed(sbAdmin, outbox.id, 'MAKE_CONTRACT_WEBHOOK not configured');
    console.error(JSON.stringify({ level: 'error', event: 'webhook_send_failed', event_type: 'contract_signed_notification', outbox_id: outbox.id, reason: 'missing_webhook_env' }));
    return response(500, { error: 'MAKE_CONTRACT_WEBHOOK not configured', outbox_id: outbox.id });
  }

  let failureAlreadyMarked = false;
  try {
    const makeResponse = await fetch(makeWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!makeResponse.ok) {
      const errMsg = `Make webhook failed: ${makeResponse.status}`;
      await markOutboxFailed(sbAdmin, outbox.id, errMsg);
      failureAlreadyMarked = true;
      console.error(JSON.stringify({ level: 'error', event: 'webhook_send_failed', event_type: 'contract_signed_notification', outbox_id: outbox.id, status: makeResponse.status }));
      throw new Error(errMsg);
    }

    await markOutboxSent(sbAdmin, outbox.id);
    console.log(JSON.stringify({ level: 'info', event: 'webhook_send_succeeded', event_type: 'contract_signed_notification', outbox_id: outbox.id }));
    return response(200, { success: true, message: 'Contract signed and webhook triggered', outbox_id: outbox.id });
  } catch (err) {
    const msg = err && err.message ? err.message : 'Internal server error';
    if (!failureAlreadyMarked) {
      await markOutboxFailed(sbAdmin, outbox.id, msg);
    }
    console.error('contract-signed error:', msg);
    return response(500, { error: msg, outbox_id: outbox.id });
  }
};
