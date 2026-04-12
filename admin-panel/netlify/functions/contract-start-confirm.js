'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { createInitialContractInvoice } = require('./_lib/invoice-service');
const { normalizePlanCode, loadPlanByCode } = require('./_lib/plan-config');
const { syncPostAcceptanceLifecycle } = require('./_lib/offer-acceptance');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function addMonthsDateIsoUtc(dateStr, months) {
  const base = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  const next = new Date(base.getTime());
  next.setUTCMonth(next.getUTCMonth() + Number(months || 0));
  return next.toISOString().slice(0, 10);
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
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
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return response(400, { error: 'Ungültiger Request Body' }); }

  const contractId = String(body.contract_id || '').trim();
  const startDate = String(body.start_date || '').trim();
  const durationMonths = Math.max(1, Math.trunc(Number(body.duration_months || 0) || 0));
  const computedEndDate = addMonthsDateIsoUtc(startDate, durationMonths);
  const endDate = String(body.end_date || computedEndDate || '').trim();
  if (!contractId) return response(400, { error: 'contract_id fehlt.' });
  if (!startDate || !computedEndDate || !endDate) return response(400, { error: 'start_date oder duration_months ungültig.' });
  if (endDate !== computedEndDate) return response(409, { error: 'end_date ist inkonsistent zur Kombination aus start_date und duration_months.' });

  const nowIso = new Date().toISOString();

  const { data: contract, error: contractError } = await sbAdmin
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .maybeSingle();
  if (contractError) return response(500, { error: 'Contract lookup failed.', details: contractError.message });
  if (!contract) return response(404, { error: 'Contract nicht gefunden.' });

  const customerId = String(contract.customer_id || '').trim();
  if (!customerId) return response(409, { error: 'Contract hat keine customer_id.' });

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();
  if (customerError) return response(500, { error: 'Customer lookup failed.', details: customerError.message });
  if (!customer) return response(404, { error: 'Customer nicht gefunden.' });

  const noticeMonths = String(contract.cancellation_notice || '') === '3 Monate' ? 3 : 1;
  const patch = {
    status: 'active',
    start_date: startDate,
    duration_months: durationMonths,
    months: durationMonths,
    end_date: endDate,
    cancellation_date: addMonthsDateIsoUtc(endDate, -noticeMonths),
    notes: String(body.notes || contract.notes || '').trim() || null,
    updated_at: nowIso
  };

  const { data: updatedContract, error: updateError } = await sbAdmin
    .from('contracts')
    .update(patch)
    .eq('id', contractId)
    .select('*')
    .single();
  if (updateError) return response(500, { error: 'Contract update failed.', details: updateError.message });

  const planCode = normalizePlanCode(contract.plan || customer.plan_code || customer.plan || '');
  const billingCycle = String(customer.billing_cycle || contract.billing_cycle || 'monthly').trim().toLowerCase() === 'yearly' ? 'yearly' : 'monthly';

  const startsAt = `${startDate}T00:00:00.000Z`;
  const renewsAt = addMonthsDateIsoUtc(startDate, billingCycle === 'yearly' ? 12 : 1);
  const subscriptionPayload = {
    customer_id: customerId,
    plan: planCode || 'professional',
    plan_code: planCode || 'professional',
    billing_cycle: billingCycle,
    subscription_status: 'inactive',
    status: 'paused',
    payment_status: 'none',
    billing_state: 'awaiting_setup_fee',
    start_date: startDate,
    starts_at: startsAt,
    renews_at: renewsAt ? `${renewsAt}T00:00:00.000Z` : null,
    updated_at: nowIso
  };

  const { data: subscription, error: subscriptionError } = await sbAdmin
    .from('subscriptions')
    .upsert(subscriptionPayload, { onConflict: 'customer_id' })
    .select('*')
    .single();
  if (subscriptionError) return response(500, { error: 'Subscription ensure failed.', details: subscriptionError.message });

  if (String(customer.subscription_id || '') !== String(subscription.id || '')) {
    await sbAdmin
      .from('customers')
      .update({ subscription_id: subscription.id, start_date: startDate, updated_at: nowIso })
      .eq('id', customerId);
  } else {
    await sbAdmin
      .from('customers')
      .update({ start_date: startDate, updated_at: nowIso })
      .eq('id', customerId);
  }
  if (String(updatedContract.subscription_id || '') !== String(subscription.id || '')) {
    await sbAdmin
      .from('contracts')
      .update({ subscription_id: subscription.id, updated_at: nowIso })
      .eq('id', contractId);
  }

  const { plan: planConfig, error: planError } = await loadPlanByCode(sbAdmin, planCode || 'professional');
  if (planError) return response(500, { error: 'Plan-Konfiguration konnte nicht geladen werden.', details: planError.message });
  const setupFeeAmount = money(customer.setup_fee_amount ?? planConfig?.setup_fee_amount ?? 0);
  const initialInvoiceResult = await createInitialContractInvoice({
    sbAdmin,
    customer,
    contractId,
    subscription,
    setupFeeAmount,
    dueAt: null,
    notes: `Initial setup-fee draft invoice for contract ${contractId}`
  });
  const initialInvoice = initialInvoiceResult.invoice || null;

  if (initialInvoice && contract.offer_id) {
    await sbAdmin
      .from('offers')
      .update({ invoice_id: initialInvoice.id, updated_at: nowIso })
      .eq('id', contract.offer_id);
  }

  await syncPostAcceptanceLifecycle({
    sbAdmin,
    offer: { customer_id: customerId },
    nowIso
  });

  return response(200, {
    success: true,
    contract: updatedContract,
    subscription,
    subscription_ensured: true,
    invoice: initialInvoice,
    initial_invoice_id: initialInvoice ? initialInvoice.id : null,
    initial_invoice_duplicate: Boolean(initialInvoiceResult.duplicate)
  });
};
