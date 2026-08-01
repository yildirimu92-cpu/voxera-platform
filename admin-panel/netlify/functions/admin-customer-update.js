'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const PROTECTED_FIELDS = new Set([
  'id', 'created_at', 'deleted_at',
  'status', 'customer_status', 'lifecycle_status',
  'plan', 'plan_code', 'subscription_status', 'payment_status',
  'stripe_customer_id', 'stripe_subscription_id', 'stripe_price_id',
  'access_status', 'portal_access_enabled', 'customer_portal_enabled',
  'activated_at', 'activation_completed_at', 'invited_at', 'live_at', 'paused_at',
  'go_live_approved_at', 'go_live_approved_by', 'go_live_approval_note', 'go_live_checks',
  'billing_status', 'billing_cycle', 'monthly_price', 'mrr',
  'contract_id', 'offer_id',
  'voxera_number', 'voxera', 'elevenlabs_agent_id'
]);

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function cleanPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { patch: {}, rejected: [] };
  }
  const patch = {};
  const rejected = [];
  for (const [key, value] of Object.entries(input)) {
    if (PROTECTED_FIELDS.has(key)) rejected.push(key);
    else patch[key] = value;
  }
  return { patch, rejected };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, { error: 'Supabase-Konfiguration fehlt.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const caller = await requireAdminCaller({
    event,
    supabaseUrl: sbUrl,
    supabaseAnonKey: sbAnonKey,
    sbAdmin,
    requiredCapability: 'customer:write'
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_error) { return response(400, { error: 'Ungültiger Request Body.' }); }

  const customerId = String(body.id || body.customer_id || '').trim();
  if (!customerId) return response(400, { error: 'Kunden-ID fehlt.' });

  const { patch, rejected } = cleanPatch(body.patch);
  if (rejected.length) {
    return response(409, {
      error: 'Geschützte Kundenfelder dürfen nicht über die allgemeine Bearbeitung geändert werden.',
      code: 'protected_customer_fields',
      rejected_fields: rejected,
      required_workflow: 'Lifecycle-, Vertrags-, Billing- und Zugriffsänderungen müssen über den vorgesehenen Fachprozess erfolgen.'
    });
  }
  if (!Object.keys(patch).length) return response(400, { error: 'Keine zulässigen Änderungen übermittelt.' });

  patch.updated_at = new Date().toISOString();
  const { data, error } = await sbAdmin
    .from('customers')
    .update(patch)
    .eq('id', customerId)
    .select('*')
    .maybeSingle();

  if (error) return response(400, { error: error.message });
  if (!data) return response(404, { error: 'Kunde nicht gefunden.' });

  return response(200, {
    ok: true,
    customer: data,
    changed_fields: Object.keys(patch).filter(key => key !== 'updated_at')
  });
};
