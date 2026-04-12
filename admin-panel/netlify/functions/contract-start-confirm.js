'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { syncPostAcceptanceLifecycle } = require('./_lib/offer-acceptance');
const { orchestrateContractBilling } = require('./_lib/contract-billing-orchestrator');

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
  const durationMonths = Math.max(1, Math.trunc(Number(body.term_months || body.duration_months || 0) || 0));
  const computedEndDate = addMonthsDateIsoUtc(startDate, durationMonths);
  const endDate = String(body.end_date || computedEndDate || '').trim();
  if (!contractId) return response(400, { error: 'contract_id fehlt.' });
  if (!startDate || !computedEndDate || !endDate) return response(400, { error: 'start_date oder duration_months ungültig.' });
  if (endDate !== computedEndDate) return response(409, { error: 'end_date ist inkonsistent zur Kombination aus start_date und duration_months.' });

  const nowIso = new Date().toISOString();
  const requestedCustomerId = String(body.customer_id || '').trim();

  const { data: contract, error: contractError } = await sbAdmin
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .maybeSingle();
  if (contractError) return response(500, { error: 'Contract lookup failed.', details: contractError.message });
  if (!contract) return response(404, { error: 'Contract nicht gefunden.' });

  if (requestedCustomerId && String(contract.customer_id || '') && requestedCustomerId !== String(contract.customer_id)) {
    return response(409, { error: 'customer_id passt nicht zum Vertrag.' });
  }
  const customerId = String(body.customer_id || contract.customer_id || '').trim();
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
  if (Object.prototype.hasOwnProperty.call(contract, 'activated_at')) {
    patch.activated_at = contract.activated_at || nowIso;
  }

  const { data: updatedContract, error: updateError } = await sbAdmin
    .from('contracts')
    .update(patch)
    .eq('id', contractId)
    .select('*')
    .single();
  if (updateError) return response(500, { error: 'Contract update failed.', details: updateError.message });

  let billing;
  try {
    billing = await orchestrateContractBilling({
      sbAdmin,
      customer,
      contract: updatedContract,
      nowIso,
      startDate,
      setupFeeAmount: customer.setup_fee_amount,
      monthlyAmount: null,
      forceActiveSubscription: true
    });
  } catch (billingError) {
    return response(500, { error: 'Contract billing orchestration failed.', details: billingError.message });
  }

  if (billing.setupInvoice?.id && contract.offer_id) {
    await sbAdmin.from('offers').update({ invoice_id: billing.setupInvoice.id, updated_at: nowIso }).eq('id', contract.offer_id);
  }

  await syncPostAcceptanceLifecycle({
    sbAdmin,
    offer: { customer_id: customerId },
    nowIso
  });

  return response(200, {
    success: true,
    contract_updated: true,
    subscription_ready: Boolean(billing.subscription?.id),
    setup_fee_invoice_created: Boolean(billing.setup_fee_invoice_created),
    recurring_invoice_created: Boolean(billing.recurring_invoice_created),
    pdfs_generated: (billing.pdf?.errors || []).length === 0,
    pdf_generation_errors: billing.pdf?.errors || [],
    contract: updatedContract,
    subscription: billing.subscription,
    setup_fee_invoice: billing.setupInvoice,
    recurring_invoice: billing.recurringInvoice
  });
};
