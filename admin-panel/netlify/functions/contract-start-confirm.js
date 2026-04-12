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

function dbDiag(error) {
  if (!error) return { db_message: null, db_code: null, db_details: null, db_hint: null };
  return {
    db_message: error.message || null,
    db_code: error.code || null,
    db_details: error.details || null,
    db_hint: error.hint || null
  };
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
  const idempotencyKey = String(event.headers['x-idempotency-key'] || '').trim() || `contract_start_confirm:${contractId}:${startDate}:${durationMonths}`;
  const requestedCustomerId = String(body.customer_id || '').trim();
  console.log('[contract_start_confirm] start', JSON.stringify({
    idempotency_key: idempotencyKey,
    contract_id: contractId || null,
    customer_id: requestedCustomerId || null,
    start_date: startDate,
    end_date: endDate,
    duration_months: durationMonths
  }));

  const { data: contract, error: contractError } = await sbAdmin
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .maybeSingle();
  if (contractError) return response(500, { error: 'Contract lookup failed.', step_failed: 'contract_lookup', contract_id: contractId, ...dbDiag(contractError) });
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
  if (customerError) return response(500, { error: 'Customer lookup failed.', step_failed: 'customer_lookup', contract_id: contractId, customer_id: customerId, ...dbDiag(customerError) });
  if (!customer) return response(404, { error: 'Customer nicht gefunden.' });

  let offerForBilling = null;
  if (contract.offer_id) {
    const { data: offer, error: offerErr } = await sbAdmin
      .from('offers')
      .select('id, setup_fee, monthly_price, billing_cycle')
      .eq('id', contract.offer_id)
      .maybeSingle();
    if (offerErr) {
      return response(500, { error: 'Offer lookup failed.', step_failed: 'offer_lookup', contract_id: contractId, customer_id: customerId, ...dbDiag(offerErr) });
    }
    offerForBilling = offer || null;
  }

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
  if (updateError) return response(500, { error: 'Contract update failed.', step_failed: 'contract_update', contract_id: contractId, customer_id: customerId, ...dbDiag(updateError) });

  let billing;
  let billingErrorPayload = null;
  try {
    billing = await orchestrateContractBilling({
      sbAdmin,
      customer,
      contract: updatedContract,
      nowIso,
      startDate,
      setupFeeAmount: offerForBilling?.setup_fee ?? null,
      monthlyAmount: offerForBilling?.monthly_price ?? null,
      forceActiveSubscription: true
    });
  } catch (billingError) {
    const structured = billingError && billingError.error === 'Contract billing orchestration failed'
      ? billingError
      : null;
    billingErrorPayload = {
      error: 'Contract billing orchestration failed',
      step_failed: structured?.step_failed || 'contract_billing_orchestration',
      contract_id: structured?.contract_id || contractId,
      customer_id: structured?.customer_id || customerId,
      subscription_id: structured?.subscription_id || null,
      setup_fee_invoice_id: structured?.setup_fee_invoice_id || null,
      month_1_invoice_id: structured?.month_1_invoice_id || null,
      ...(structured || dbDiag(billingError))
    };
    console.error('[contract_start_confirm] billing_follow_up_required', JSON.stringify(billingErrorPayload));
    billing = {
      subscription: null,
      setupInvoice: null,
      recurringInvoice: null,
      setup_fee_invoice_created: false,
      recurring_invoice_created: false,
      pdf: { errors: [] }
    };
  }

  if (billing.setupInvoice?.id && contract.offer_id) {
    await sbAdmin.from('offers').update({ invoice_id: billing.setupInvoice.id, updated_at: nowIso }).eq('id', contract.offer_id);
  }

  await syncPostAcceptanceLifecycle({
    sbAdmin,
    offer: { customer_id: customerId },
    nowIso
  });

  console.log('[contract_start_confirm] end', JSON.stringify({
    idempotency_key: idempotencyKey,
    contract_id: updatedContract?.id || contractId,
    customer_id: customer?.id || customerId,
    subscription_id: billing?.subscription?.id || null,
    setup_fee_invoice_id: billing?.setupInvoice?.id || null,
    month_1_invoice_id: billing?.recurringInvoice?.id || null
  }));

  return response(200, {
    success: true,
    contract_updated: true,
    subscription_ready: Boolean(billing.subscription?.id),
    follow_up_required: Boolean(billingErrorPayload),
    follow_up_issues: billingErrorPayload ? ['billing'] : [],
    diagnostics: billingErrorPayload || null,
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
