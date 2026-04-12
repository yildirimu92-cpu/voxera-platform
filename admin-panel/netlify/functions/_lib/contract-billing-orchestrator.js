'use strict';

const { ensureContractStartInvoices, generateInvoicePdfPreview } = require('./invoice-service');
const { normalizePlanCode, loadPlanByCode } = require('./plan-config');

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function addMonthsDateIsoUtc(dateStr, months) {
  const base = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  const next = new Date(base.getTime());
  next.setUTCMonth(next.getUTCMonth() + Number(months || 0));
  return next.toISOString().slice(0, 10);
}

function extractMissingColumn(err) {
  if (!err || String(err.code || '') !== 'PGRST204') return null;
  const message = String(err.message || '');
  const match = message.match(/Could not find the '([^']+)' column/i);
  return match?.[1] || null;
}

async function mutateWithSchemaFallback({ sbAdmin, table, mode, payload, matchColumn, matchValue }) {
  const dynamicPayload = { ...payload };
  const removedColumns = [];
  const maxAttempts = Object.keys(dynamicPayload).length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const query = sbAdmin.from(table);
    const mutation = mode === 'insert'
      ? query.insert(dynamicPayload)
      : query.update(dynamicPayload).eq(matchColumn, matchValue);

    const { data, error } = await mutation.select('*').single();
    if (!error) return { data, error: null, removedColumns, finalPayload: dynamicPayload };

    const missingColumn = extractMissingColumn(error);
    if (!missingColumn || !(missingColumn in dynamicPayload)) {
      return { data: null, error, removedColumns, finalPayload: dynamicPayload };
    }

    delete dynamicPayload[missingColumn];
    removedColumns.push(missingColumn);
  }

  return {
    data: null,
    error: { code: 'SCHEMA_FALLBACK_EXHAUSTED', message: `Schema fallback exhausted for table ${table}.` },
    removedColumns,
    finalPayload: dynamicPayload
  };
}

async function ensureSubscriptionForContract({ sbAdmin, customer, contract, planCode, startDate, nowIso, forceActive = false }) {
  const billingCycle = String(customer.billing_cycle || contract.billing_cycle || 'monthly').trim().toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
  const startsAt = `${startDate}T00:00:00.000Z`;
  const renewsAt = addMonthsDateIsoUtc(startDate, billingCycle === 'yearly' ? 12 : 1);
  const subscriptionStatus = forceActive || String(contract.status || '').trim().toLowerCase() === 'active' ? 'active' : 'inactive';

  const payload = {
    customer_id: customer.id,
    plan: planCode || 'professional',
    plan_code: planCode || 'professional',
    billing_cycle: billingCycle,
    subscription_status: subscriptionStatus,
    status: subscriptionStatus,
    payment_status: 'pending',
    billing_state: 'awaiting_invoices',
    start_date: startDate,
    starts_at: startsAt,
    renews_at: renewsAt ? `${renewsAt}T00:00:00.000Z` : null,
    updated_at: nowIso
  };

  const { data: existing, error: lookupError } = await sbAdmin
    .from('subscriptions')
    .select('*')
    .eq('customer_id', customer.id)
    .maybeSingle();

  if (lookupError) throw new Error(`subscription lookup failed: ${lookupError.message}`);

  let subscription = null;
  if (existing) {
    const updated = await mutateWithSchemaFallback({
      sbAdmin,
      table: 'subscriptions',
      mode: 'update',
      payload,
      matchColumn: 'id',
      matchValue: existing.id
    });
    if (updated.error) throw new Error(`subscription update failed: ${updated.error.message}`);
    subscription = updated.data || existing;
  } else {
    const inserted = await mutateWithSchemaFallback({
      sbAdmin,
      table: 'subscriptions',
      mode: 'insert',
      payload
    });
    if (inserted.error) {
      const duplicateKey = String(inserted.error.code || '') === '23505';
      if (!duplicateKey) throw new Error(`subscription insert failed: ${inserted.error.message}`);
      const { data: duplicateExisting, error: duplicateLookupError } = await sbAdmin
        .from('subscriptions')
        .select('*')
        .eq('customer_id', customer.id)
        .maybeSingle();
      if (duplicateLookupError || !duplicateExisting) {
        throw new Error(`subscription duplicate lookup failed: ${duplicateLookupError?.message || 'missing duplicate row'}`);
      }
      const healed = await mutateWithSchemaFallback({
        sbAdmin,
        table: 'subscriptions',
        mode: 'update',
        payload,
        matchColumn: 'id',
        matchValue: duplicateExisting.id
      });
      if (healed.error) throw new Error(`subscription heal failed: ${healed.error.message}`);
      subscription = healed.data || duplicateExisting;
    } else {
      subscription = inserted.data;
    }
  }

  if (!subscription?.id) throw new Error('subscription ensure failed: no row returned');

  if (String(customer.subscription_id || '') !== String(subscription.id || '')) {
    await sbAdmin.from('customers').update({ subscription_id: subscription.id, start_date: startDate, updated_at: nowIso }).eq('id', customer.id);
  } else {
    await sbAdmin.from('customers').update({ start_date: startDate, updated_at: nowIso }).eq('id', customer.id);
  }

  if (String(contract.subscription_id || '') !== String(subscription.id || '')) {
    await sbAdmin.from('contracts').update({ subscription_id: subscription.id, updated_at: nowIso }).eq('id', contract.id);
  }

  return subscription;
}

async function orchestrateContractBilling({ sbAdmin, customer, contract, nowIso, startDate, setupFeeAmount = null, monthlyAmount = null, forceActiveSubscription = false }) {
  const safeStartDate = String(startDate || contract.start_date || nowIso.slice(0, 10)).slice(0, 10);
  const planCode = normalizePlanCode(customer.plan_code || contract.plan || customer.plan || '');
  if (!planCode) throw new Error('plan code missing for billing orchestration');

  const { plan: planConfig, error: planError } = await loadPlanByCode(sbAdmin, planCode);
  if (planError) throw new Error(`plan lookup failed: ${planError.message}`);

  const resolvedSetupFee = money(setupFeeAmount ?? customer.setup_fee_amount ?? planConfig?.setup_fee_amount ?? 0);
  const resolvedMonthly = money(monthlyAmount ?? planConfig?.price_monthly ?? 0);

  const subscription = await ensureSubscriptionForContract({
    sbAdmin,
    customer,
    contract,
    planCode,
    startDate: safeStartDate,
    nowIso,
    forceActive: forceActiveSubscription
  });

  const invoiceResults = await ensureContractStartInvoices({
    sbAdmin,
    customer,
    contract,
    subscription,
    setupFeeAmount: resolvedSetupFee,
    monthlyAmount: resolvedMonthly,
    startDate: safeStartDate
  });

  const setupInvoice = invoiceResults.setupInvoice?.invoice || null;
  const recurringInvoice = invoiceResults.recurringInvoice?.invoice || null;

  const pdf = { setup_fee: null, month_1: null, errors: [] };
  if (setupInvoice) {
    try {
      pdf.setup_fee = await generateInvoicePdfPreview({ sbAdmin, invoice: setupInvoice, customer });
    } catch (err) {
      pdf.errors.push({ invoice_id: setupInvoice.id, message: err?.message || String(err) });
    }
  }
  if (recurringInvoice) {
    try {
      pdf.month_1 = await generateInvoicePdfPreview({ sbAdmin, invoice: recurringInvoice, customer });
    } catch (err) {
      pdf.errors.push({ invoice_id: recurringInvoice.id, message: err?.message || String(err) });
    }
  }

  return {
    subscription,
    setupInvoice,
    recurringInvoice,
    setup_fee_invoice_created: Boolean(invoiceResults.setupInvoice?.created),
    recurring_invoice_created: Boolean(invoiceResults.recurringInvoice?.created),
    pdf
  };
}

module.exports = {
  orchestrateContractBilling
};
