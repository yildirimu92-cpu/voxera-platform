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

function dbErrorMeta(error) {
  if (!error) return null;
  return {
    message: error.message || null,
    code: error.code || null,
    details: error.details || null,
    hint: error.hint || null
  };
}

function billingDiag(step, payload) {
  console.log(`[billing_orchestrator] ${step}`, JSON.stringify(payload || {}));
}

function orchestrationError({
  stepName,
  error,
  contractId,
  customerId,
  subscriptionId = null,
  setupFeeInvoiceId = null,
  month1InvoiceId = null
}) {
  return {
    error: 'Contract billing orchestration failed',
    step_failed: stepName,
    db_message: error?.message || null,
    db_code: error?.code || null,
    db_details: error?.details || null,
    db_hint: error?.hint || null,
    contract_id: contractId || null,
    customer_id: customerId || null,
    subscription_id: subscriptionId || null,
    setup_fee_invoice_id: setupFeeInvoiceId || null,
    month_1_invoice_id: month1InvoiceId || null
  };
}

function normalizeThrownError(err) {
  if (!err) return null;
  if (err?.error === 'Contract billing orchestration failed' && err?.step_failed) return err;
  return null;
}

async function runOrchestrationStep({
  stepName,
  contractId,
  customerId,
  subscriptionId = null,
  setupFeeInvoiceId = null,
  month1InvoiceId = null,
  fn
}) {
  billingDiag(`${stepName}_START`, {
    step_name: stepName,
    contract_id: contractId || null,
    customer_id: customerId || null,
    subscription_id: subscriptionId || null
  });
  try {
    const result = await fn();
    billingDiag(`${stepName}_SUCCESS`, {
      step_name: stepName,
      contract_id: contractId || null,
      customer_id: customerId || null,
      subscription_id: result?.subscription_id ?? subscriptionId ?? null,
      setup_fee_invoice_id: result?.setup_fee_invoice_id ?? setupFeeInvoiceId ?? null,
      month_1_invoice_id: result?.month_1_invoice_id ?? month1InvoiceId ?? null
    });
    return result;
  } catch (error) {
    const normalized = normalizeThrownError(error);
    if (normalized) throw normalized;
    throw orchestrationError({
      stepName,
      error,
      contractId,
      customerId,
      subscriptionId,
      setupFeeInvoiceId,
      month1InvoiceId
    });
  }
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
  const billingCycle = String(contract.billing_cycle || customer.billing_cycle || 'monthly').trim().toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
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
  billingDiag('subscription_ensure_start', {
    contract_id: contract?.id || null,
    customer_id: customer?.id || null,
    subscription_id: contract?.subscription_id || customer?.subscription_id || null,
    payload_keys: Object.keys(payload),
    force_active: Boolean(forceActive)
  });

  const { data: existing, error: lookupError } = await sbAdmin
    .from('subscriptions')
    .select('*')
    .eq('customer_id', customer.id)
    .maybeSingle();

  if (lookupError) {
    billingDiag('subscription_ensure_lookup_error', {
      contract_id: contract?.id || null,
      customer_id: customer?.id || null,
      db_error: dbErrorMeta(lookupError)
    });
    throw new Error(`subscription lookup failed: ${lookupError.message}`);
  }

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
    if (updated.error) {
      billingDiag('subscription_ensure_update_error', {
        contract_id: contract?.id || null,
        customer_id: customer?.id || null,
        existing_subscription_id: existing?.id || null,
        db_error: dbErrorMeta(updated.error)
      });
      throw new Error(`subscription update failed: ${updated.error.message}`);
    }
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
      if (!duplicateKey) {
        billingDiag('subscription_ensure_insert_error', {
          contract_id: contract?.id || null,
          customer_id: customer?.id || null,
          db_error: dbErrorMeta(inserted.error)
        });
        throw new Error(`subscription insert failed: ${inserted.error.message}`);
      }
      const { data: duplicateExisting, error: duplicateLookupError } = await sbAdmin
        .from('subscriptions')
        .select('*')
        .eq('customer_id', customer.id)
        .maybeSingle();
      if (duplicateLookupError || !duplicateExisting) {
        billingDiag('subscription_ensure_duplicate_lookup_error', {
          contract_id: contract?.id || null,
          customer_id: customer?.id || null,
          db_error: dbErrorMeta(duplicateLookupError),
          duplicate_found: Boolean(duplicateExisting)
        });
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
      if (healed.error) {
        billingDiag('subscription_ensure_heal_error', {
          contract_id: contract?.id || null,
          customer_id: customer?.id || null,
          subscription_id: duplicateExisting?.id || null,
          db_error: dbErrorMeta(healed.error)
        });
        throw new Error(`subscription heal failed: ${healed.error.message}`);
      }
      subscription = healed.data || duplicateExisting;
    } else {
      subscription = inserted.data;
    }
  }

  if (!subscription?.id) throw new Error('subscription ensure failed: no row returned');

  if (String(customer.subscription_id || '') !== String(subscription.id || '')) {
    await sbAdmin.from('customers').update({ subscription_id: subscription.id, updated_at: nowIso }).eq('id', customer.id);
  }

  if (String(contract.subscription_id || '') !== String(subscription.id || '')) {
    await sbAdmin.from('contracts').update({ subscription_id: subscription.id, updated_at: nowIso }).eq('id', contract.id);
  }

  const { data: verified, error: verifyError } = await sbAdmin
    .from('subscriptions')
    .select('*')
    .eq('id', subscription.id)
    .maybeSingle();
  billingDiag('subscription_ensure_end', {
    contract_id: contract?.id || null,
    customer_id: customer?.id || null,
    subscription_id: subscription?.id || null,
    verify_found: Boolean(verified),
    verify_error: dbErrorMeta(verifyError)
  });
  if (verifyError || !verified) {
    throw new Error(`subscription verify failed: ${verifyError?.message || 'subscription not found after ensure'}`);
  }

  return subscription;
}

async function orchestrateContractBilling({ sbAdmin, customer, contract, nowIso, startDate, setupFeeAmount = null, monthlyAmount = null, forceActiveSubscription = false }) {
  const safeStartDate = String(startDate || contract.start_date || nowIso.slice(0, 10)).slice(0, 10);
  const planCode = normalizePlanCode(contract.plan || customer.plan_code || customer.plan || '');
  if (!planCode) throw new Error('plan code missing for billing orchestration');

  const { plan: planConfig, error: planError } = await loadPlanByCode(sbAdmin, planCode);
  if (planError) throw new Error(`plan lookup failed: ${planError.message}`);

  const resolvedSetupFee = money(setupFeeAmount ?? planConfig?.setup_fee_amount ?? 0);
  const resolvedMonthly = money(monthlyAmount ?? planConfig?.price_monthly ?? 0);
  billingDiag('orchestration_start', {
    contract_id: contract?.id || null,
    customer_id: customer?.id || null,
    subscription_id: customer?.subscription_id || contract?.subscription_id || null,
    start_date: safeStartDate,
    setup_fee_amount: resolvedSetupFee,
    monthly_amount: resolvedMonthly
  });

  const contractId = contract?.id || null;
  const customerId = customer?.id || null;

  const subscriptionStep = await runOrchestrationStep({
    stepName: 'ensure_subscription',
    contractId,
    customerId,
    subscriptionId: customer?.subscription_id || contract?.subscription_id || null,
    fn: async () => {
      const subscription = await ensureSubscriptionForContract({
        sbAdmin,
        customer,
        contract,
        planCode,
        startDate: safeStartDate,
        nowIso,
        forceActive: forceActiveSubscription
      });
      return { subscription, subscription_id: subscription?.id || null };
    }
  });
  const subscription = subscriptionStep.subscription;

  const setupStep = await runOrchestrationStep({
    stepName: 'ensure_setup_fee_invoice',
    contractId,
    customerId,
    subscriptionId: subscription?.id || null,
    fn: async () => {
      const results = await ensureContractStartInvoices({
        sbAdmin,
        customer,
        contract,
        subscription,
        setupFeeAmount: resolvedSetupFee,
        monthlyAmount: resolvedMonthly,
        startDate: safeStartDate
      });
      const setupInvoice = results?.setupInvoice?.invoice || null;
      if (!setupInvoice?.id) throw new Error('setup fee invoice missing after ensure');
      const { data: setupVerify, error: setupVerifyError } = await sbAdmin
        .from('invoices')
        .select('*')
        .eq('id', setupInvoice.id)
        .maybeSingle();
      if (setupVerifyError || !setupVerify) {
        throw Object.assign(new Error(`setup fee invoice readback failed: ${setupVerifyError?.message || 'missing row'}`), setupVerifyError || {});
      }
      return { invoiceResults: results, setup_fee_invoice_id: setupVerify.id };
    }
  });

  const month1Step = await runOrchestrationStep({
    stepName: 'ensure_month_1_invoice',
    contractId,
    customerId,
    subscriptionId: subscription?.id || null,
    setupFeeInvoiceId: setupStep?.invoiceResults?.setupInvoice?.invoice?.id || null,
    fn: async () => {
      const recurringInvoice = setupStep?.invoiceResults?.recurringInvoice?.invoice || null;
      if (!recurringInvoice?.id) throw new Error('month 1 invoice missing after ensure');
      const { data: recurringVerify, error: recurringVerifyError } = await sbAdmin
        .from('invoices')
        .select('*')
        .eq('id', recurringInvoice.id)
        .maybeSingle();
      if (recurringVerifyError || !recurringVerify) {
        throw Object.assign(new Error(`month 1 invoice readback failed: ${recurringVerifyError?.message || 'missing row'}`), recurringVerifyError || {});
      }
      return { month_1_invoice_id: recurringVerify.id };
    }
  });

  const invoiceResults = setupStep.invoiceResults;
  const setupInvoice = invoiceResults.setupInvoice?.invoice || null;
  const recurringInvoice = invoiceResults.recurringInvoice?.invoice || null;

  await runOrchestrationStep({
    stepName: 'sync_contract_linkage',
    contractId,
    customerId,
    subscriptionId: subscription?.id || null,
    setupFeeInvoiceId: setupInvoice?.id || null,
    month1InvoiceId: recurringInvoice?.id || null,
    fn: async () => {
      const linkagePatch = { updated_at: nowIso };
      if (String(contract?.subscription_id || '') !== String(subscription?.id || '')) {
        linkagePatch.subscription_id = subscription.id;
      }
      const { error: contractLinkError } = await sbAdmin
        .from('contracts')
        .update(linkagePatch)
        .eq('id', contract.id);
      if (contractLinkError) {
        throw Object.assign(new Error(`contract linkage sync failed: ${contractLinkError.message}`), contractLinkError);
      }
      const { data: contractVerify, error: contractVerifyError } = await sbAdmin
        .from('contracts')
        .select('id, customer_id, subscription_id')
        .eq('id', contract.id)
        .maybeSingle();
      if (contractVerifyError || !contractVerify) {
        throw Object.assign(new Error(`contract linkage verify failed: ${contractVerifyError?.message || 'missing contract row'}`), contractVerifyError || {});
      }
      if (String(contractVerify.subscription_id || '') !== String(subscription.id || '')) {
        throw new Error('contract linkage verify failed: subscription_id mismatch');
      }
      return { subscription_id: subscription.id };
    }
  });

  const pdf = { setup_fee: null, month_1: null, errors: [] };
  if (setupInvoice) {
    await runOrchestrationStep({
      stepName: 'generate_setup_fee_pdf',
      contractId,
      customerId,
      subscriptionId: subscription?.id || null,
      setupFeeInvoiceId: setupInvoice?.id || null,
      month1InvoiceId: recurringInvoice?.id || null,
      fn: async () => {
        try {
          pdf.setup_fee = await generateInvoicePdfPreview({ sbAdmin, invoice: setupInvoice, customer });
          return { setup_fee_invoice_id: setupInvoice.id, month_1_invoice_id: recurringInvoice?.id || null };
        } catch (err) {
          pdf.errors.push({ invoice_id: setupInvoice.id, message: err?.message || String(err) });
          billingDiag('generate_setup_fee_pdf_WARNING', {
            step_name: 'generate_setup_fee_pdf',
            contract_id: contractId,
            customer_id: customerId,
            subscription_id: subscription?.id || null,
            setup_fee_invoice_id: setupInvoice?.id || null,
            month_1_invoice_id: recurringInvoice?.id || null,
            warning_message: err?.message || String(err)
          });
          return { setup_fee_invoice_id: setupInvoice.id, month_1_invoice_id: recurringInvoice?.id || null };
        }
      }
    });
  }
  if (recurringInvoice) {
    await runOrchestrationStep({
      stepName: 'generate_month_1_pdf',
      contractId,
      customerId,
      subscriptionId: subscription?.id || null,
      setupFeeInvoiceId: setupInvoice?.id || null,
      month1InvoiceId: recurringInvoice?.id || null,
      fn: async () => {
        try {
          pdf.month_1 = await generateInvoicePdfPreview({ sbAdmin, invoice: recurringInvoice, customer });
          return { setup_fee_invoice_id: setupInvoice?.id || null, month_1_invoice_id: recurringInvoice.id };
        } catch (err) {
          pdf.errors.push({ invoice_id: recurringInvoice.id, message: err?.message || String(err) });
          billingDiag('generate_month_1_pdf_WARNING', {
            step_name: 'generate_month_1_pdf',
            contract_id: contractId,
            customer_id: customerId,
            subscription_id: subscription?.id || null,
            setup_fee_invoice_id: setupInvoice?.id || null,
            month_1_invoice_id: recurringInvoice?.id || null,
            warning_message: err?.message || String(err)
          });
          return { setup_fee_invoice_id: setupInvoice?.id || null, month_1_invoice_id: recurringInvoice.id };
        }
      }
    });
  }

  await runOrchestrationStep({
    stepName: 'validate_created_rows',
    contractId,
    customerId,
    subscriptionId: subscription?.id || null,
    setupFeeInvoiceId: setupInvoice?.id || null,
    month1InvoiceId: recurringInvoice?.id || null,
    fn: async () => {
      const { data: validateSetup, error: validateSetupError } = await sbAdmin
        .from('invoices')
        .select('id, contract_id, customer_id, subscription_id, external_reference')
        .eq('id', setupInvoice.id)
        .maybeSingle();
      if (validateSetupError || !validateSetup) {
        throw Object.assign(new Error(`validate setup fee row failed: ${validateSetupError?.message || 'missing row'}`), validateSetupError || {});
      }
      if (!validateSetup.contract_id) throw new Error('validate setup fee row failed: missing contract_id');
      if (!validateSetup.customer_id) throw new Error('validate setup fee row failed: missing customer_id');
      const { data: validateMonth1, error: validateMonth1Error } = await sbAdmin
        .from('invoices')
        .select('id, contract_id, customer_id, subscription_id, external_reference')
        .eq('id', recurringInvoice.id)
        .maybeSingle();
      if (validateMonth1Error || !validateMonth1) {
        throw Object.assign(new Error(`validate month 1 row failed: ${validateMonth1Error?.message || 'missing row'}`), validateMonth1Error || {});
      }
      if (!validateMonth1.contract_id) throw new Error('validate month 1 row failed: missing contract_id');
      if (!validateMonth1.customer_id) throw new Error('validate month 1 row failed: missing customer_id');
      if (!validateMonth1.subscription_id) throw new Error('validate month 1 row failed: missing subscription_id');
      return { setup_fee_invoice_id: validateSetup.id, month_1_invoice_id: validateMonth1.id };
    }
  });

  await runOrchestrationStep({
    stepName: 'final_response_build',
    contractId,
    customerId,
    subscriptionId: subscription?.id || null,
    setupFeeInvoiceId: setupInvoice?.id || null,
    month1InvoiceId: recurringInvoice?.id || null,
    fn: async () => ({
      subscription_id: subscription?.id || null,
      setup_fee_invoice_id: setupInvoice?.id || null,
      month_1_invoice_id: recurringInvoice?.id || null
    })
  });

  billingDiag('orchestration_end', {
    contract_id: contract?.id || null,
    customer_id: customer?.id || null,
    subscription_id: subscription?.id || null,
    setup_fee_invoice_id: setupInvoice?.id || null,
    month_1_invoice_id: recurringInvoice?.id || null,
    setup_fee_invoice_created: Boolean(invoiceResults.setupInvoice?.created),
    month_1_invoice_created: Boolean(invoiceResults.recurringInvoice?.created),
    setup_fee_verification: invoiceResults.setupInvoice?.verification || null,
    month_1_verification: invoiceResults.recurringInvoice?.verification || null,
    month_1_invoice_verified_in_step: month1Step?.month_1_invoice_id || null
  });

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
