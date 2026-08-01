'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const ALLOWED_MAIL_TYPES = new Set(['ai_change_request', 'cancellation_request']);
const MAX_MESSAGE_LENGTH = 3000;
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization'
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
  const makeWebhook = process.env.MAKE_MAIL_WEBHOOK;
  if (!sbUrl || !sbAnonKey || !sbServiceKey || !makeWebhook) {
    console.error('[ai-change-notify] server_configuration_missing');
    return response(503, { error: 'server_configuration_missing' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: 'invalid_json' });
  }

  const mailType = String(body.mail_type || 'ai_change_request').trim().toLowerCase();
  const message = String(body.message || '').trim();
  if (!ALLOWED_MAIL_TYPES.has(mailType)) return response(400, { error: 'invalid_mail_type' });
  if (mailType === 'ai_change_request' && !message) return response(400, { error: 'message_required' });
  if (message.length > MAX_MESSAGE_LENGTH) {
    return response(400, { error: 'message_too_long', max_length: MAX_MESSAGE_LENGTH });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const caller = await requireCustomerCaller({
    event,
    sbUrl,
    sbAnonKey,
    sbAdmin,
    functionName: 'ai-change-notify'
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('id, customer_name, plan, plan_code')
    .eq('id', caller.customerId)
    .single();
  if (customerError) {
    console.error('[ai-change-notify] customer_load_failed', { customer_id: caller.customerId });
    return response(500, { error: 'customer_load_failed' });
  }

  const notificationMessage = mailType === 'cancellation_request'
    ? 'Der Kunde hat im Customer Portal eine Kündigung eingereicht.'
    : message;
  const payload = {
    mail_type: mailType,
    customer_id: caller.customerId,
    customer_name: customer.customer_name || 'Unbekannt',
    plan: customer.plan_code || customer.plan || null,
    message: notificationMessage,
    timestamp: new Date().toISOString(),
    admin_url: 'https://admin.voxera.ch/#ai-setup'
  };

  try {
    const webhookResponse = await fetch(makeWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!webhookResponse.ok) {
      console.error('[ai-change-notify] webhook_request_failed', {
        customer_id: caller.customerId,
        mail_type: mailType,
        status: webhookResponse.status
      });
      return response(502, { error: 'notification_delivery_failed' });
    }
  } catch {
    console.error('[ai-change-notify] webhook_request_failed', {
      customer_id: caller.customerId,
      mail_type: mailType,
      status: null
    });
    return response(502, { error: 'notification_delivery_failed' });
  }

  return response(200, { success: true, notification_sent: true });
};
