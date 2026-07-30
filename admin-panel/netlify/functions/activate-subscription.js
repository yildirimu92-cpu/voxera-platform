'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { normalizePlanCode } = require('./_lib/plan-config');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function addMonths(date, months) {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCMonth(result.getUTCMonth() + months);
  if (result.getUTCDate() < day) result.setUTCDate(0);
  return result;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, { error: 'Supabase-Konfiguration fehlt auf dem Server.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const caller = await requireAdminCaller({
    event,
    supabaseUrl: sbUrl,
    supabaseAnonKey: sbAnonKey,
    sbAdmin,
    requiredCapability: 'billing:write'
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_error) {
    return response(400, { error: 'Ungültiger Request Body.' });
  }

  const customerId = String(body.customer_id || '').trim();
  const billingCycle = String(body.billing_cycle || '').trim().toLowerCase();
  const startDate = String(body.start_date || '').trim();
  if (!customerId || !['monthly', 'yearly'].includes(billingCycle) || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return response(400, {
      error: 'Pflichtfelder fehlen oder sind ungültig: customer_id, billing_cycle (monthly/yearly), start_date (YYYY-MM-DD).'
    });
  }

  const customerResult = await sbAdmin
    .from('customers')
    .select('id, status, plan_code, plan')
    .eq('id', customerId)
    .maybeSingle();
  if (customerResult.error) return response(500, { error: 'Kunde konnte nicht geladen werden.', details: customerResult.error.message });
  if (!customerResult.data) return response(404, { error: 'Kunde nicht gefunden.' });

  const planCode = normalizePlanCode(body.plan || customerResult.data.plan_code || customerResult.data.plan);
  if (!planCode) return response(409, { error: 'Kein gültiger Plan vorhanden.' });

  const startsAt = new Date(`${startDate}T00:00:00.000Z`).toISOString();
  const renewsAt = addMonths(new Date(startsAt), billingCycle === 'yearly' ? 12 : 1).toISOString();
  const nowIso = new Date().toISOString();
  const subscriptionResult = await sbAdmin
    .from('subscriptions')
    .upsert({
      customer_id: customerId,
      plan_code: planCode,
      plan: planCode,
      billing_cycle: billingCycle,
      subscription_status: 'active',
      start_date: startDate,
      starts_at: startsAt,
      renews_at: renewsAt,
      status: 'active',
      updated_at: nowIso
    }, { onConflict: 'customer_id' })
    .select('*')
    .single();

  if (subscriptionResult.error) {
    return response(500, { error: 'Subscription konnte nicht gespeichert werden.', details: subscriptionResult.error.message });
  }

  const customerUpdate = await sbAdmin
    .from('customers')
    .update({
      subscription_id: subscriptionResult.data.id,
      plan_code: planCode,
      plan: planCode,
      updated_at: nowIso
    })
    .eq('id', customerId)
    .select('id, status, subscription_id, plan_code')
    .single();
  if (customerUpdate.error) {
    return response(500, { error: 'Subscription-Verknüpfung konnte nicht gespeichert werden.', details: customerUpdate.error.message });
  }

  return response(200, {
    success: true,
    subscription: subscriptionResult.data,
    customer: customerUpdate.data,
    lifecycle_unchanged: true,
    message: 'Subscription aktiviert. Kundenzugang und Go-live bleiben separate, manuelle Schritte.'
  });
};
