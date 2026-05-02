'use strict';

const PDF_BUCKET = 'invoice-pdfs';

function dbErrorMeta(error) {
  if (!error) return null;
  return {
    message: error.message || null,
    code: error.code || null,
    details: error.details || null,
    hint: error.hint || null
  };
}

function invoiceDiag(step, payload) {
  console.log(`[invoice_service] ${step}`, JSON.stringify(payload || {}));
}

function manualMonthlyLog(step, payload) {
  console.log(`[manual_monthly_invoice] ${step}`, JSON.stringify(payload || {}));
}

function toIso(value, fallback = null) {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toISOString();
}

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function money(value) {
  return Number(numberOr(value, 0).toFixed(2));
}

function addMonthsIsoDate(dateStr, months) {
  const base = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCMonth(base.getUTCMonth() + Number(months || 0));
  return base.toISOString().slice(0, 10);
}

function addCycleToDate(dateStr, billingCycle) {
  const cycle = String(billingCycle || '').trim().toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
  return addMonthsIsoDate(dateStr, cycle === 'yearly' ? 12 : 1);
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normalizeBillingCycle(raw) {
  return String(raw || '').trim().toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
}

function normalizeInvoiceType(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'subscription') return 'recurring';
  if (value === 'setup_fee' || value === 'recurring' || value === 'manual' || value === 'credit_note') return value;
  return value || 'manual';
}

function isActivePrimaryInvoiceStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return !['cancelled', 'canceled', 'void', 'voided'].includes(normalized);
}

function contractAllowsBilling(contract) {
  const normalized = String(contract?.status || '').trim().toLowerCase();
  return ['active', 'signed', 'pending_review', 'pending'].includes(normalized);
}

function resolveContractRecurringAmountStrict(contract) {
  const cycle = normalizeBillingCycle(contract?.billing_cycle);
  const recurringAmount = cycle === 'yearly'
    ? contract?.recurring_amount_yearly
    : contract?.recurring_amount_monthly;
  const amount = money(recurringAmount);
  if (!(amount > 0)) {
    throw new Error(`contract recurring price missing: contracts.${cycle === 'yearly' ? 'recurring_amount_yearly' : 'recurring_amount_monthly'} must be > 0 for ${cycle} invoices`);
  }
  return { cycle, amount };
}

function resolveContractSetupFeeAmountStrict(contract) {
  const amount = money(contract?.setup_fee_amount);
  if (!(amount > 0)) {
    throw new Error('contract setup fee missing: contracts.setup_fee_amount must be > 0');
  }
  return amount;
}

function toDateOnlyIso(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function computePeriodStart(subscription, nowDate) {
  const startsAtRaw = subscription && (subscription.starts_at || subscription.start_date);
  const startsAt = startsAtRaw ? new Date(startsAtRaw) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) {
    return new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1));
  }

  const cursor = new Date(startsAt.getTime());
  const isYearly = String(subscription.billing_cycle || '').trim().toLowerCase() === 'yearly';
  const monthsStep = isYearly ? 12 : 1;

  while (cursor <= nowDate) {
    const probe = new Date(cursor.getTime());
    probe.setUTCMonth(probe.getUTCMonth() + monthsStep);
    if (probe > nowDate) break;
    cursor.setTime(probe.getTime());
  }

  return cursor;
}

async function loadUsageSummary(sbAdmin, { customerId, periodStartIso, includedMinutes, extraRate }) {
  const { data, error } = await sbAdmin
    .from('calls')
    .select('duration_seconds')
    .eq('customer_id', customerId)
    .gte('created_at', periodStartIso);

  if (error) {
    return { ok: false, error: error.message || 'usage query failed' };
  }

  const usedSeconds = (Array.isArray(data) ? data : []).reduce((sum, row) => {
    const duration = Number(row && row.duration_seconds);
    return sum + (Number.isFinite(duration) && duration > 0 ? duration : 0);
  }, 0);

  const usedMinutes = Math.ceil(usedSeconds / 60);
  const overageMinutes = Math.max(0, usedMinutes - Math.max(0, Number(includedMinutes) || 0));
  const overageAmount = Number((overageMinutes * (Number(extraRate) || 0)).toFixed(2));

  return {
    ok: true,
    usage: {
      used_minutes: usedMinutes,
      included_minutes: Math.max(0, Number(includedMinutes) || 0),
      overage_minutes: overageMinutes,
      overage_amount: overageAmount
    }
  };
}

async function nextInvoiceNumber(sbAdmin) {
  const { data, error } = await sbAdmin.rpc('next_invoice_number_v1');
  if (error) throw new Error(`invoice number generation failed: ${error.message}`);
  if (!data) throw new Error('invoice number generation returned empty result');
  return String(data);
}

async function createInvoiceWithItems(sbAdmin, payload) {
  const normalizedContractId = String(payload.contractId || '').trim();
  if (!normalizedContractId) throw new Error('contractId is required for invoice creation');
  const invoiceNumber = await nextInvoiceNumber(sbAdmin);
  const issuedAt = toIso(payload.issuedAt, new Date().toISOString());
  const dueAt = toIso(payload.dueAt, null);
  const sentAt = toIso(payload.sentAt, null);
  const paidAt = toIso(payload.paidAt, null);

  const subtotal = money(payload.subtotalAmount);
  const taxAmount = money(payload.taxAmount);
  const totalAmount = money(payload.totalAmount ?? (subtotal + taxAmount));

  const invoiceRow = {
    invoice_number: invoiceNumber,
    customer_id: payload.customerId,
    subscription_id: payload.subscriptionId || null,
    invoice_type: payload.invoiceType,
    billing_provider: payload.billingProvider,
    status: payload.status,
    currency: payload.currency || 'CHF',
    subtotal_amount: subtotal,
    tax_amount: taxAmount,
    total_amount: totalAmount,
    period_start: toIso(payload.periodStart, null),
    period_end: toIso(payload.periodEnd, null),
    issued_at: issuedAt,
    due_at: dueAt,
    sent_at: sentAt,
    paid_at: paidAt,
    paid_source: payload.paidSource || null,
    stripe_payment_intent_id: payload.stripePaymentIntentId || null,
    stripe_checkout_session_id: payload.stripeCheckoutSessionId || null,
    stripe_invoice_id: payload.stripeInvoiceId || null,
    external_reference: payload.externalReference || null,
    offer_id: payload.offerId || null,
    contract_id: normalizedContractId,
    notes: payload.notes || null,
    pdf_url: payload.pdfUrl || null
  };

  const { data: insertedInvoice, error: invoiceError } = await sbAdmin
    .from('invoices')
    .insert(invoiceRow)
    .select('*')
    .single();

  if (invoiceError) {
    const wrapped = new Error(`invoice insert failed: ${invoiceError.message}`);
    wrapped.db_message = invoiceError.message || null;
    wrapped.db_code = invoiceError.code || null;
    wrapped.db_details = invoiceError.details || null;
    wrapped.db_hint = invoiceError.hint || null;
    wrapped.step_failed = 'insert_invoice';
    wrapped.helper_name = 'createInvoiceWithItems';
    wrapped.payload_sent = invoiceRow;
    throw wrapped;
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length > 0) {
    const rows = items.map((item, idx) => {
      const quantity = numberOr(item.quantity, 1);
      const unitPrice = money(item.unitPrice);
      const lineTotal = money(item.lineTotal ?? (quantity * unitPrice));
      return {
        invoice_id: insertedInvoice.id,
        sort_order: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : (idx + 1),
        item_type: item.itemType || 'manual',
        title: item.title || 'Position',
        description: item.description || null,
        quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
        metadata: item.metadata || {}
      };
    });

    const { error: itemError } = await sbAdmin
      .from('invoice_items')
      .insert(rows);

    if (itemError) {
      const wrapped = new Error(`invoice items insert failed: ${itemError.message}`);
      wrapped.db_message = itemError.message || null;
      wrapped.db_code = itemError.code || null;
      wrapped.db_details = itemError.details || null;
      wrapped.db_hint = itemError.hint || null;
      wrapped.step_failed = 'insert_invoice_items';
      wrapped.helper_name = 'createInvoiceWithItems';
      wrapped.payload_sent = rows;
      throw wrapped;
    }
  }

  return insertedInvoice;
}

async function createInvoiceWithFallbackType(sbAdmin, payload, options = {}) {
  const logManual = options && options.debugTag === 'manual_monthly_invoice';
  try {
    if (logManual) {
      manualMonthlyLog('insert_attempt', { invoice_type: payload.invoiceType, payload_sent: payload });
    }
    return await createInvoiceWithItems(sbAdmin, payload);
  } catch (error) {
    if (logManual) {
      manualMonthlyLog('insert_failed', {
        db_message: error && error.db_message ? error.db_message : (error && error.message) || null,
        db_code: error && error.db_code ? error.db_code : null,
        db_details: error && error.db_details ? error.db_details : null,
        db_hint: error && error.db_hint ? error.db_hint : null,
        step_failed: error && error.step_failed ? error.step_failed : 'insert_invoice'
      });
    }
    const msg = String(error && error.message || '').toLowerCase();
    const unsupportedRecurring = payload.invoiceType === 'recurring'
      && (msg.includes('invoices_invoice_type_check') || msg.includes('check constraint'));
    if (!unsupportedRecurring) throw error;
    if (logManual) {
      manualMonthlyLog('fallback_attempt', { from: 'recurring', to: 'subscription' });
    }
    try {
      return await createInvoiceWithItems(sbAdmin, { ...payload, invoiceType: 'subscription' });
    } catch (fallbackError) {
      if (logManual) {
        manualMonthlyLog('fallback_failed', {
          db_message: fallbackError && fallbackError.db_message ? fallbackError.db_message : (fallbackError && fallbackError.message) || null,
          db_code: fallbackError && fallbackError.db_code ? fallbackError.db_code : null,
          db_details: fallbackError && fallbackError.db_details ? fallbackError.db_details : null,
          db_hint: fallbackError && fallbackError.db_hint ? fallbackError.db_hint : null,
          step_failed: fallbackError && fallbackError.step_failed ? fallbackError.step_failed : 'insert_invoice'
        });
      }
      throw fallbackError;
    }
  }
}

function isDuplicateInvoiceReferenceError(error) {
  const code = String(error && error.code || '');
  const msg = String(error && error.message || '').toLowerCase();
  return code === '23505' || msg.includes('duplicate key value');
}

async function findExistingRecurringInvoiceForPeriod({ sbAdmin, contractId, periodStart }) {
  const normalizedContractId = String(contractId || '').trim();
  const normalizedStart = dateOnly(periodStart);
  if (!normalizedContractId || !normalizedStart) return null;
  const periodStartIso = `${normalizedStart}T00:00:00.000Z`;
  const { data, error } = await sbAdmin
    .from('invoices')
    .select('*')
    .eq('contract_id', normalizedContractId)
    .eq('period_start', periodStartIso)
    .in('invoice_type', ['recurring', 'subscription'])
    .order('created_at', { ascending: false });
  if (error) throw new Error(`recurring period lookup failed: ${error.message}`);
  const rows = Array.isArray(data) ? data : [];
  return rows.find((row) => isActivePrimaryInvoiceStatus(row.status)) || rows[0] || null;
}

async function applyContractBillingPatch(sbAdmin, contractId, patch) {
  if (!contractId || !patch || !Object.keys(patch).length) return { data: null, skipped: true };
  const mutablePatch = { ...patch };
  const maxAttempts = Object.keys(mutablePatch).length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await sbAdmin
      .from('contracts')
      .update(mutablePatch)
      .eq('id', contractId)
      .select('*')
      .maybeSingle();
    if (!error) return { data, skipped: false };
    const missingColumn = String(error.code || '') === 'PGRST204'
      ? (String(error.message || '').match(/Could not find the '([^']+)' column/i)?.[1] || null)
      : null;
    if (!missingColumn || !Object.prototype.hasOwnProperty.call(mutablePatch, missingColumn)) {
      throw new Error(`contract update failed: ${error.message}`);
    }
    delete mutablePatch[missingColumn];
  }
  return { data: null, skipped: true };
}

async function createSetupFeeInvoice({
  sbAdmin,
  customer,
  contractId,
  contract = null,
  offerId = null,
  setupFeeAmount,
  billingProvider,
  status,
  dueAt: _dueAt,
  paidAt,
  paidSource,
  notes,
  externalReference,
  stripePaymentIntentId,
  stripeCheckoutSessionId,
  stripeInvoiceId
}) {
  // Default due date: 7 days from now if not specified
  const dueAt = _dueAt || (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString();
  })();
  const normalizedContractId = String(contractId || '').trim();
  if (!normalizedContractId) throw new Error('contractId is required');
  const resolvedContract = contract || null;
  if (resolvedContract) {
    if (String(resolvedContract.customer_id || '') !== String(customer.id || '')) {
      throw new Error('contract does not belong to customer');
    }
    if (!contractAllowsBilling(resolvedContract)) {
      throw new Error(`contract status ${resolvedContract.status || 'unknown'} does not allow billing`);
    }
  }
  const amount = resolvedContract
    ? resolveContractSetupFeeAmountStrict(resolvedContract)
    : money(setupFeeAmount);
  if (amount <= 0) throw new Error('setup fee invoice requires contract.setup_fee_amount > 0');
  const setupReference = externalReference || `setup_fee:${normalizedContractId}`;

  const { data: existingByReference } = await sbAdmin
    .from('invoices')
    .select('*')
    .eq('external_reference', setupReference)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingByReference && isActivePrimaryInvoiceStatus(existingByReference.status)) {
    return existingByReference;
  }

  return createInvoiceWithFallbackType(sbAdmin, {
    customerId: customer.id,
    contractId: normalizedContractId,
    offerId,
    subscriptionId: null,
    invoiceType: 'setup_fee',
    billingProvider,
    status,
    subtotalAmount: amount,
    taxAmount: 0,
    totalAmount: amount,
    issuedAt: new Date(),
    dueAt,
    sentAt: status === 'sent' ? new Date() : null,
    paidAt: status === 'paid' ? paidAt || new Date() : null,
    paidSource: status === 'paid' ? (paidSource || 'manual') : null,
    notes,
    externalReference: setupReference,
    stripePaymentIntentId,
    stripeCheckoutSessionId,
    stripeInvoiceId,
    items: [{
      itemType: 'setup_fee',
      title: 'Setup Fee',
      description: 'Einrichtungsgebühr Voxera',
      quantity: 1,
      unitPrice: amount,
      lineTotal: amount
    }]
  });
}

async function createSubscriptionInvoice({
  sbAdmin,
  customer,
  contractId,
  contract = null,
  offerId = null,
  subscription,
  billingProvider,
  status,
  dueAt,
  paidAt,
  paidSource,
  notes,
  externalReference,
  stripePaymentIntentId,
  stripeCheckoutSessionId,
  stripeInvoiceId,
  periodStartDate = null,
  periodEndDate = null,
  advanceContractNextInvoiceDate = true,
  debugTag = null
}) {
  // Default due date: 7 days from now if not specified
  const dueAt = _dueAt || (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString();
  })();
  const normalizedContractId = String(contractId || '').trim();
  if (!normalizedContractId) throw new Error('contractId is required');
  if (!contract) throw new Error('contract is required for recurring invoice creation');
  if (String(contract.customer_id || '') !== String(customer.id || '')) {
    throw new Error('contract does not belong to customer');
  }
  if (!contractAllowsBilling(contract)) {
    throw new Error(`contract status ${contract.status || 'unknown'} does not allow billing`);
  }
  const resolvedOfferId = offerId || contract?.offer_id || null;
  const logManual = debugTag === 'manual_monthly_invoice';
  if (logManual) manualMonthlyLog('start', { customer_id: customer && customer.id ? customer.id : null });
  const recurringPricing = resolveContractRecurringAmountStrict(contract);
  const cycle = recurringPricing.cycle;
  const baseAmount = recurringPricing.amount;
  if (baseAmount <= 0) throw new Error('recurring invoice requires contract recurring amount > 0');

  const now = new Date();
  const computedStart = dateOnly(periodStartDate)
    ? new Date(`${dateOnly(periodStartDate)}T00:00:00.000Z`)
    : computePeriodStart(subscription, now);
  const computedEnd = dateOnly(periodEndDate)
    ? new Date(`${dateOnly(periodEndDate)}T00:00:00.000Z`)
    : new Date(computedStart.getTime());
  if (!dateOnly(periodEndDate)) {
    computedEnd.setUTCMonth(computedEnd.getUTCMonth() + (cycle === 'yearly' ? 12 : 1));
  }
  const periodStartDay = dateOnly(computedStart);
  const recurringReference = externalReference || `recurring:${normalizedContractId}:${periodStartDay}`;

  const existingForPeriod = await findExistingRecurringInvoiceForPeriod({
    sbAdmin,
    contractId: normalizedContractId,
    periodStart: periodStartDay
  });
  if (existingForPeriod && isActivePrimaryInvoiceStatus(existingForPeriod.status)) {
    return existingForPeriod;
  }

  const usageResult = await loadUsageSummary(sbAdmin, {
    customerId: customer.id,
    periodStartIso: computedStart.toISOString(),
    includedMinutes: Number(contract.included_minutes || 0),
    extraRate: Number(contract.extra_per_minute || 0)
  });

  const overageAmount = usageResult.ok ? money(usageResult.usage.overage_amount) : 0;
  const items = [
    {
      itemType: 'subscription_base',
      title: cycle === 'yearly' ? 'Subscription (jährlich)' : 'Subscription (monatlich)',
      description: `${contract.plan || 'Plan'} · ${cycle}`,
      quantity: 1,
      unitPrice: baseAmount,
      lineTotal: baseAmount,
      metadata: { billing_cycle: cycle }
    }
  ];

  if (overageAmount > 0) {
    items.push({
      itemType: 'overage',
      title: 'Overage Minuten',
      description: usageResult.ok ? `${usageResult.usage.overage_minutes} zusätzliche Minuten` : 'Zusatzverbrauch',
      quantity: usageResult.ok ? usageResult.usage.overage_minutes : 1,
      unitPrice: usageResult.ok ? numberOr(contract.extra_per_minute, 0) : overageAmount,
      lineTotal: overageAmount,
      metadata: usageResult.ok ? usageResult.usage : {}
    });
  }

  const subtotal = money(baseAmount + overageAmount);

  const invoicePayload = {
    customerId: customer.id,
    contractId: normalizedContractId,
    offerId: resolvedOfferId,
    subscriptionId: subscription.id,
    invoiceType: 'recurring',
    billingProvider,
    status,
    subtotalAmount: subtotal,
    taxAmount: 0,
    totalAmount: subtotal,
    periodStart: toDateOnlyIso(computedStart),
    periodEnd: toDateOnlyIso(computedEnd),
    issuedAt: now,
    dueAt,
    sentAt: status === 'sent' ? now : null,
    paidAt: status === 'paid' ? paidAt || now : null,
    paidSource: status === 'paid' ? (paidSource || 'manual') : null,
    notes,
    externalReference: recurringReference,
    stripePaymentIntentId,
    stripeCheckoutSessionId,
    stripeInvoiceId,
    items
  };

  if (logManual) {
    manualMonthlyLog('payload', {
      customer_id: customer.id,
      subscription_id: subscription.id,
      billing_cycle: cycle,
      invoice_type: invoicePayload.invoiceType,
      subtotal_amount: invoicePayload.subtotalAmount
    });
  }

  const invoice = await createInvoiceWithFallbackType(sbAdmin, invoicePayload, { debugTag });
  if (advanceContractNextInvoiceDate) {
    const nextInvoiceDate = addCycleToDate(periodStartDay, cycle);
    if (nextInvoiceDate) {
      await applyContractBillingPatch(sbAdmin, normalizedContractId, {
        next_invoice_date: nextInvoiceDate,
        updated_at: new Date().toISOString()
      });
    }
  }
  if (logManual) {
    manualMonthlyLog('success', {
      invoice_id: invoice && invoice.id ? invoice.id : null,
      invoice_type: invoice && invoice.invoice_type ? invoice.invoice_type : null
    });
  }
  return invoice;
}

async function createInitialContractInvoice({ sbAdmin, customer, contractId, contract = null, subscription, setupFeeAmount, dueAt, notes }) {
  // Default due date: 7 days from now if not specified
  const dueAt = _dueAt || (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString();
  })();
  const normalizedContractId = String(contractId || '').trim();
  if (!normalizedContractId) throw new Error('contractId is required');

  const setupAmount = contract
    ? resolveContractSetupFeeAmountStrict(contract)
    : money(setupFeeAmount);
  if (setupAmount <= 0) throw new Error('setup fee amount must be > 0');

  const externalReference = `initial_contract_invoice:${normalizedContractId}`;
  const { data: existingInvoice, error: existingError } = await sbAdmin
    .from('invoices')
    .select('*')
    .eq('external_reference', externalReference)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw new Error(`initial invoice lookup failed: ${existingError.message}`);
  if (existingInvoice) return { invoice: existingInvoice, duplicate: true };

  const subtotal = money(setupAmount);
  let createdInvoice;
  try {
    createdInvoice = await createInvoiceWithFallbackType(sbAdmin, {
      customerId: customer.id,
      subscriptionId: subscription && subscription.id ? subscription.id : (customer.subscription_id || null),
      contractId: normalizedContractId,
      invoiceType: 'setup_fee',
      billingProvider: 'invoice',
      status: 'draft',
      subtotalAmount: subtotal,
      taxAmount: 0,
      totalAmount: subtotal,
      issuedAt: new Date(),
      dueAt,
      sentAt: null,
      paidAt: null,
      notes: notes || 'Initial invoice (setup fee only) after contract creation',
      externalReference,
      items: [
        {
          itemType: 'setup_fee',
          title: 'Setup Fee',
          description: 'Einrichtungsgebühr',
          quantity: 1,
          unitPrice: setupAmount,
          lineTotal: setupAmount,
          metadata: { contract_id: normalizedContractId, source: 'contract_created' }
        }
      ]
    });
  } catch (createErr) {
    if (!isDuplicateInvoiceReferenceError(createErr)) throw createErr;
    const { data: racedInvoice, error: racedLookupError } = await sbAdmin
      .from('invoices')
      .select('*')
      .eq('external_reference', externalReference)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (racedLookupError) throw new Error(`initial invoice duplicate lookup failed: ${racedLookupError.message}`);
    if (racedInvoice) return { invoice: racedInvoice, duplicate: true };
    throw createErr;
  }

  return { invoice: createdInvoice, duplicate: false };
}

async function updateInvoiceWithSchemaFallback(sbAdmin, invoiceId, patch) {
  const mutablePatch = { ...patch };
  const maxAttempts = Object.keys(mutablePatch).length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await sbAdmin
      .from('invoices')
      .update(mutablePatch)
      .eq('id', invoiceId)
      .select('*')
      .single();
    if (!error) return { data, removed: [] };
    const isMissingColumn = String(error.code || '') === 'PGRST204';
    if (!isMissingColumn) throw new Error(`invoice update failed: ${error.message}`);
    const message = String(error.message || '');
    const match = message.match(/Could not find the '([^']+)' column/i);
    const missing = match && match[1];
    if (!missing || !Object.prototype.hasOwnProperty.call(mutablePatch, missing)) {
      throw new Error(`invoice update failed: ${error.message}`);
    }
    delete mutablePatch[missing];
    if (attempt === maxAttempts) throw new Error(`invoice update failed: ${error.message}`);
  }
  return { data: null, removed: [] };
}

function escapePdfText(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r?\n/g, ' ');
}

function buildSimplePdf(lines) {
  const fontSize = 11;
  const lineGap = 14;
  let y = 800;
  const textOps = ['BT', `/F1 ${fontSize} Tf`, '50 0 0 50 40 0 cm'];
  for (const line of lines) {
    textOps.push(`1 0 0 1 0 ${y} Tm (${escapePdfText(line)}) Tj`);
    y -= lineGap;
  }
  textOps.push('ET');
  const stream = textOps.join('\n');
  const objects = [];
  objects.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj');
  objects.push('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj');
  objects.push('3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj');
  objects.push('4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj');
  objects.push(`5 0 obj << /Length ${Buffer.byteLength(stream, 'utf8')} >> stream\n${stream}\nendstream endobj`);

  let offset = '%PDF-1.4\n'.length;
  const parts = ['%PDF-1.4\n'];
  const xref = ['0000000000 65535 f '];
  objects.forEach((obj) => {
    xref.push(`${String(offset).padStart(10, '0')} 00000 n `);
    parts.push(`${obj}\n`);
    offset += Buffer.byteLength(`${obj}\n`, 'utf8');
  });
  const xrefOffset = offset;
  const xrefText = `xref\n0 ${objects.length + 1}\n${xref.join('\n')}\n`;
  const trailer = `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(xrefText);
  parts.push(trailer);
  return Buffer.from(parts.join(''), 'utf8');
}

async function ensurePdfBucket(sbAdmin) {
  const list = await sbAdmin.storage.listBuckets();
  if (list.error) throw new Error(`bucket list failed: ${list.error.message}`);
  const exists = (list.data || []).some((b) => b.name === PDF_BUCKET || b.id === PDF_BUCKET);
  if (exists) return;
  const created = await sbAdmin.storage.createBucket(PDF_BUCKET, { public: true, fileSizeLimit: 5 * 1024 * 1024 });
  if (created.error && !String(created.error.message || '').toLowerCase().includes('already exists')) {
    throw new Error(`bucket create failed: ${created.error.message}`);
  }
}

function moneyFmt(value) {
  return `${money(value).toFixed(2)} CHF`;
}

async function generateInvoicePdfPreview({ sbAdmin, invoice, customer }) {
  if (!invoice || !invoice.id) return { ok: false, reason: 'invoice_missing' };
  const { data: items, error: itemsError } = await sbAdmin
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', invoice.id)
    .order('sort_order', { ascending: true });
  if (itemsError) throw new Error(`invoice items load failed: ${itemsError.message}`);
  const itemRows = Array.isArray(items) ? items : [];

  const issuedDate = (invoice.issued_at || new Date().toISOString()).slice(0, 10);
  const lines = [
    'VOXERA RECHNUNG (ENTWURF / NOCH NICHT VERENDET)',
    `Rechnungsnummer: ${invoice.invoice_number || invoice.id}`,
    `Datum: ${issuedDate}`,
    `Kunde: ${customer?.customer_name || customer?.name || 'Unbekannt'}`,
    `Adresse: ${[customer?.street, customer?.zip, customer?.city, customer?.country].filter(Boolean).join(', ') || '-'}`,
    '--- Positionen ---'
  ];
  itemRows.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.title || 'Position'} | Menge ${numberOr(item.quantity, 1)} | Einzel ${moneyFmt(item.unit_price)} | Total ${moneyFmt(item.line_total)}`);
  });
  lines.push('--- Summe ---');
  lines.push(`Zwischensumme: ${moneyFmt(invoice.subtotal_amount)}`);
  lines.push(`MwSt: ${moneyFmt(invoice.tax_amount)}`);
  lines.push(`Total: ${moneyFmt(invoice.total_amount)}`);
  lines.push('Zahlungsinformationen: Banküberweisung gemäss Kundenvereinbarung.');
  lines.push('Kontakt: billing@voxera.ai');

  const pdfBuffer = buildSimplePdf(lines);
  await ensurePdfBucket(sbAdmin);
  const path = `invoices/${invoice.id}/v1-${Date.now()}.pdf`;
  const upload = await sbAdmin.storage.from(PDF_BUCKET).upload(path, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true
  });
  if (upload.error) throw new Error(`pdf upload failed: ${upload.error.message}`);
  const pub = sbAdmin.storage.from(PDF_BUCKET).getPublicUrl(path);
  const pdfUrl = pub?.data?.publicUrl || null;
  const patch = {
    pdf_url: pdfUrl,
    pdf_path: path,
    pdf_generated_at: new Date().toISOString(),
    pdf_version: 1,
    updated_at: new Date().toISOString()
  };
  const updated = await updateInvoiceWithSchemaFallback(sbAdmin, invoice.id, patch);
  return { ok: true, invoice: updated.data || invoice, pdf_url: pdfUrl, pdf_path: path };
}

async function ensureDraftInvoiceWithItems({
  sbAdmin,
  customer,
  offerId = null,
  contractId = null,
  subscriptionId = null,
  invoiceType,
  externalReference,
  compatibilityReferences = [],
  dueAt,
  periodStart,
  periodEnd,
  notes,
  lineItem
}) {
  // Default due date: 7 days from now if not specified
  const dueAt = _dueAt || (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString();
  })();
  const normalizedContractId = String(contractId || '').trim();
  if (!normalizedContractId) throw new Error('contract_id is required for draft invoice ensure');
  invoiceDiag('invoice_ensure_start', {
    invoice_type: invoiceType,
    external_reference: externalReference,
    contract_id: contractId || null,
    customer_id: customer?.id || null,
    subscription_id: subscriptionId || null,
    payload_keys: ['invoiceType', 'externalReference', 'dueAt', 'periodStart', 'periodEnd', 'lineItem']
  });
  const referenceCandidates = [externalReference, ...(Array.isArray(compatibilityReferences) ? compatibilityReferences : [])]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  const existingRefQuery = sbAdmin
    .from('invoices')
    .select('*');
  if (referenceCandidates.length === 1) {
    existingRefQuery.eq('external_reference', referenceCandidates[0]);
  } else {
    existingRefQuery.in('external_reference', referenceCandidates);
  }
  const { data: existingRefRows, error: existingError } = await existingRefQuery
    .order('created_at', { ascending: false });
  if (existingError) {
    invoiceDiag('invoice_ensure_lookup_error', {
      invoice_type: invoiceType,
      external_reference: externalReference,
      db_error: dbErrorMeta(existingError)
    });
    throw new Error(`invoice lookup failed: ${existingError.message}`);
  }
  const existingRows = Array.isArray(existingRefRows) ? existingRefRows : [];
  const existing = existingRows.find((row) => isActivePrimaryInvoiceStatus(row.status)) || existingRows[0] || null;

  if (!existing && normalizeInvoiceType(invoiceType) === 'recurring') {
    const recurringPeriodExisting = await findExistingRecurringInvoiceForPeriod({
      sbAdmin,
      contractId: normalizedContractId,
      periodStart
    });
    if (recurringPeriodExisting && isActivePrimaryInvoiceStatus(recurringPeriodExisting.status)) {
      invoiceDiag('invoice_ensure_existing_period', {
        invoice_type: invoiceType,
        external_reference: externalReference,
        invoice_id: recurringPeriodExisting.id || null
      });
      return { invoice: recurringPeriodExisting, created: false, verification: { found: true, matched_by: 'contract_period' } };
    }
  }
  if (existing) {
    const healPatch = {
      customer_id: customer.id,
      updated_at: new Date().toISOString()
    };
    if (offerId) healPatch.offer_id = offerId;
    if (contractId) healPatch.contract_id = contractId;
    if (subscriptionId) healPatch.subscription_id = subscriptionId;
    if (String(existing.invoice_type || '').trim().toLowerCase() !== String(invoiceType || '').trim().toLowerCase()) {
      healPatch.invoice_type = invoiceType;
    }
    if (String(existing.status || '').trim().toLowerCase() !== 'draft') {
      healPatch.status = 'draft';
    }
    if (Object.keys(healPatch).length > 1) {
      const { error: healError } = await sbAdmin.from('invoices').update(healPatch).eq('id', existing.id);
      if (healError) throw new Error(`invoice heal failed: ${healError.message}`);
    }
    invoiceDiag('invoice_ensure_existing', {
      invoice_type: invoiceType,
      external_reference: externalReference,
      invoice_id: existing.id || null
    });
    return { invoice: existing, created: false, verification: { found: true, matched_by: 'external_reference' } };
  }

  const qty = numberOr(lineItem.quantity, 1);
  const unit = money(lineItem.unitPrice);
  const total = money(lineItem.lineTotal ?? (qty * unit));
  if (total <= 0) {
    throw new Error(`invoice amount must be > 0 for ${invoiceType}`);
  }
  let created;
  try {
    created = await createInvoiceWithFallbackType(sbAdmin, {
      customerId: customer.id,
      offerId,
      subscriptionId,
      contractId: normalizedContractId,
      invoiceType,
      billingProvider: 'invoice',
      status: 'draft',
      currency: 'CHF',
      subtotalAmount: total,
      taxAmount: 0,
      totalAmount: total,
      issuedAt: new Date(),
      dueAt,
      periodStart,
      periodEnd,
      notes,
      externalReference,
      items: [{
        itemType: lineItem.itemType || 'manual',
        title: lineItem.title,
        description: lineItem.description || null,
        quantity: qty,
        unitPrice: unit,
        lineTotal: total,
        metadata: lineItem.metadata || {}
      }]
    });
  } catch (error) {
    const duplicate = String(error.message || '').toLowerCase().includes('duplicate');
    if (!duplicate) {
      invoiceDiag('invoice_ensure_insert_error', {
        invoice_type: invoiceType,
        external_reference: externalReference,
        db_error: dbErrorMeta(error)
      });
      throw error;
    }
    const raced = await sbAdmin
      .from('invoices')
      .select('*')
      .eq('external_reference', externalReference)
      .maybeSingle();
    if (raced.error) {
      invoiceDiag('invoice_ensure_duplicate_recovery_error', {
        invoice_type: invoiceType,
        external_reference: externalReference,
        db_error: dbErrorMeta(raced.error)
      });
      throw new Error(`invoice duplicate recovery failed: ${raced.error.message}`);
    }
    if (raced.data) {
      invoiceDiag('invoice_ensure_duplicate_recovered', {
        invoice_type: invoiceType,
        external_reference: externalReference,
        invoice_id: raced.data.id || null
      });
      return { invoice: raced.data, created: false, verification: { found: true, matched_by: 'external_reference_duplicate' } };
    }
    throw error;
  }
  const { data: verified, error: verifyError } = await sbAdmin
    .from('invoices')
    .select('*')
    .eq('external_reference', externalReference)
    .maybeSingle();
  invoiceDiag('invoice_ensure_end', {
    invoice_type: invoiceType,
    external_reference: externalReference,
    invoice_id: created?.id || null,
    created: true,
    verify_found: Boolean(verified),
    verify_error: dbErrorMeta(verifyError)
  });
  if (verifyError || !verified) {
    throw new Error(`invoice verify failed for ${externalReference}: ${verifyError?.message || 'invoice missing after create'}`);
  }
  return { invoice: created, created: true, verification: { found: true, matched_by: 'external_reference' } };
}

async function ensureContractStartInvoices({
  sbAdmin,
  customer,
  contract,
  subscription,
  startDate
}) {
  const cycle = normalizeBillingCycle(contract?.billing_cycle || subscription?.billing_cycle);
  const setupAmount = resolveContractSetupFeeAmountStrict(contract);
  const recurringPricing = resolveContractRecurringAmountStrict(contract);
  const month1Amount = recurringPricing.amount;
  const setupReference = `setup_fee:${contract.id}`;
  const periodStart = `${startDate}T00:00:00.000Z`;
  const nextMonth = addCycleToDate(startDate, cycle);
  const periodEnd = nextMonth ? `${nextMonth}T00:00:00.000Z` : null;
  const monthReference = `recurring:${contract.id}:${startDate}`;
  const legacyMonthReference = `month_1:${subscription.id}:${startDate}`;
  const dueAt = periodStart;

  const setupInvoice = await ensureDraftInvoiceWithItems({
    sbAdmin,
    customer,
    offerId: contract.offer_id || null,
    contractId: contract.id,
    subscriptionId: null,
    invoiceType: 'setup_fee',
    externalReference: setupReference,
    dueAt,
    notes: `Draft setup-fee invoice for contract ${contract.id}`,
    lineItem: {
      itemType: 'setup_fee',
      title: 'Setup Fee Voxera',
      description: 'Einrichtungsgebühr Voxera',
      quantity: 1,
      unitPrice: setupAmount,
      lineTotal: setupAmount,
      metadata: { contract_id: contract.id }
    }
  });

  const recurringInvoice = await ensureDraftInvoiceWithItems({
    sbAdmin,
    customer,
    offerId: contract.offer_id || null,
    contractId: contract.id,
    subscriptionId: subscription.id,
    invoiceType: 'recurring',
    externalReference: monthReference,
    compatibilityReferences: [legacyMonthReference],
    dueAt,
    periodStart,
    periodEnd,
    notes: `Draft recurring invoice (month 1) for subscription ${subscription.id}`,
    lineItem: {
      itemType: 'subscription_base',
      title: `Voxera Monatsabo ${String(subscription.plan_code || subscription.plan || '').trim() ? `[${String(subscription.plan_code || subscription.plan)}]` : ''}`.trim(),
      description: 'Monatliche Subscription (Monat 1)',
      quantity: 1,
      unitPrice: month1Amount,
      lineTotal: month1Amount,
      metadata: { billing_cycle: cycle, period_start: startDate }
    }
  });

  const { data: setupVerify, error: setupVerifyError } = await sbAdmin
    .from('invoices')
    .select('id, external_reference, customer_id, contract_id, subscription_id, invoice_type, status')
    .eq('external_reference', setupReference)
    .maybeSingle();
  invoiceDiag('setup_fee_invoice_verify', {
    contract_id: contract?.id || null,
    customer_id: customer?.id || null,
    subscription_id: subscription?.id || null,
    invoice_type: 'setup_fee',
    external_reference: setupReference,
    invoice_id: setupVerify?.id || null,
    found: Boolean(setupVerify),
    db_error: dbErrorMeta(setupVerifyError)
  });
  if (setupVerifyError || !setupVerify) {
    throw new Error(`setup fee invoice verify failed: ${setupVerifyError?.message || `missing ${setupReference}`}`);
  }

  const { data: recurringVerify, error: recurringVerifyError } = await sbAdmin
    .from('invoices')
    .select('id, external_reference, customer_id, contract_id, subscription_id, invoice_type, status, period_start')
    .eq('external_reference', monthReference)
    .maybeSingle();
  invoiceDiag('month_1_invoice_verify', {
    contract_id: contract?.id || null,
    customer_id: customer?.id || null,
    subscription_id: subscription?.id || null,
    invoice_type: 'recurring',
    external_reference: monthReference,
    invoice_id: recurringVerify?.id || null,
    found: Boolean(recurringVerify),
    db_error: dbErrorMeta(recurringVerifyError)
  });
  if (recurringVerifyError || !recurringVerify) {
    throw new Error(`month 1 invoice verify failed: ${recurringVerifyError?.message || `missing ${monthReference}`}`);
  }

  return {
    setupInvoice: { ...setupInvoice, verification: { found: true, invoice_id: setupVerify.id } },
    recurringInvoice: { ...recurringInvoice, verification: { found: true, invoice_id: recurringVerify.id } }
  };
}

async function markInvoicePaid(sbAdmin, invoiceId, {
  paidAt,
  paidSource,
  paidAmount = null,
  paymentReference = null,
  stripePaymentIntentId,
  stripeCheckoutSessionId,
  stripeInvoiceId,
  notes
}) {
  const referenceText = String(paymentReference || '').trim();
  const normalizedNotes = [String(notes || '').trim(), referenceText ? `Ref: ${referenceText}` : ''].filter(Boolean).join('\n');
  const patch = {
    status: 'paid',
    paid_at: toIso(paidAt, new Date().toISOString()),
    paid_source: paidSource || 'manual',
    updated_at: new Date().toISOString()
  };
  const normalizedPaidAmount = Number(paidAmount);
  if (Number.isFinite(normalizedPaidAmount) && normalizedPaidAmount >= 0) {
    patch.amount_paid = money(normalizedPaidAmount);
    patch.paid_amount = money(normalizedPaidAmount);
  }
  if (referenceText) {
    patch.payment_reference = referenceText;
    patch.reference = referenceText;
  }
  if (stripePaymentIntentId) patch.stripe_payment_intent_id = stripePaymentIntentId;
  if (stripeCheckoutSessionId) patch.stripe_checkout_session_id = stripeCheckoutSessionId;
  if (stripeInvoiceId) patch.stripe_invoice_id = stripeInvoiceId;
  if (normalizedNotes) patch.notes = normalizedNotes;

  const updated = await updateInvoiceWithSchemaFallback(sbAdmin, invoiceId, patch);
  if (!updated?.data) throw new Error('invoice update failed: empty result');
  return updated.data;
}

function resolveNextContractInvoiceDate(contract) {
  const fromNext = dateOnly(contract?.next_invoice_date);
  if (fromNext) return fromNext;
  const fromStart = dateOnly(contract?.start_date);
  if (fromStart) return fromStart;
  return null;
}

async function ensureRecurringInvoiceForContract({
  sbAdmin,
  customer,
  contract,
  subscription,
  force = false,
  status = 'draft',
  billingProvider = 'invoice',
  notes = null
}) {
  if (!contract?.id) throw new Error('contract is required');
  if (!subscription?.id) throw new Error('subscription is required');
  if (!contractAllowsBilling(contract)) return { invoice: null, created: false, skipped: 'contract_status_not_billable' };
  const autoInvoiceEnabled = contract.auto_invoice_enabled == null ? true : Boolean(contract.auto_invoice_enabled);
  if (!force && !autoInvoiceEnabled) return { invoice: null, created: false, skipped: 'auto_invoice_disabled' };

  const cycle = normalizeBillingCycle(contract.billing_cycle || subscription.billing_cycle);
  const today = dateOnly(new Date());
  const periodStart = resolveNextContractInvoiceDate(contract);
  if (!periodStart) return { invoice: null, created: false, skipped: 'next_invoice_date_missing' };
  if (!force && periodStart > today) return { invoice: null, created: false, skipped: 'not_due' };
  const periodEnd = addCycleToDate(periodStart, cycle);
  const recurringReference = `recurring:${contract.id}:${periodStart}`;
  const existing = await findExistingRecurringInvoiceForPeriod({
    sbAdmin,
    contractId: contract.id,
    periodStart
  });
  if (existing && isActivePrimaryInvoiceStatus(existing.status)) {
    const nextDate = addCycleToDate(periodStart, cycle);
    if (nextDate) {
      await applyContractBillingPatch(sbAdmin, contract.id, { next_invoice_date: nextDate, updated_at: new Date().toISOString() });
    }
    return { invoice: existing, created: false, skipped: 'already_exists_for_period' };
  }

  const invoice = await createSubscriptionInvoice({
    sbAdmin,
    customer,
    contractId: contract.id,
    contract,
    offerId: contract.offer_id || null,
    subscription,
    billingProvider,
    status,
    dueAt: (() => {
      const d = new Date(`${periodStart}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + 7);
      return d.toISOString();
    })(),
    notes: notes || `Recurring contract invoice for ${periodStart}`,
    externalReference: recurringReference,
    periodStartDate: periodStart,
    periodEndDate: periodEnd,
    advanceContractNextInvoiceDate: true
  });
  return { invoice, created: true, skipped: null };
}

async function runRecurringBillingSweep({ sbAdmin, limit = 200, now = new Date() }) {
  const today = dateOnly(now);
  const { data: contracts, error } = await sbAdmin
    .from('contracts')
    .select('*')
    .eq('status', 'active')
    .lte('next_invoice_date', today)
    .order('next_invoice_date', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`due contracts query failed: ${error.message}`);

  const results = [];
  for (const contract of (contracts || [])) {
    const customerId = String(contract.customer_id || '').trim();
    if (!customerId) {
      results.push({ contract_id: contract.id, created: false, skipped: 'missing_customer_id' });
      continue;
    }
    const { data: customer } = await sbAdmin.from('customers').select('*').eq('id', customerId).maybeSingle();
    if (!customer) {
      results.push({ contract_id: contract.id, created: false, skipped: 'customer_not_found' });
      continue;
    }
    const { data: subscription } = await sbAdmin.from('subscriptions').select('*').eq('customer_id', customerId).maybeSingle();
    if (!subscription) {
      results.push({ contract_id: contract.id, created: false, skipped: 'subscription_not_found' });
      continue;
    }
    try {
      const ensured = await ensureRecurringInvoiceForContract({
        sbAdmin, customer, contract, subscription
      });
      results.push({ contract_id: contract.id, invoice_id: ensured.invoice?.id || null, created: Boolean(ensured.created), skipped: ensured.skipped || null });
    } catch (sweepError) {
      results.push({ contract_id: contract.id, created: false, skipped: 'error', error: sweepError.message });
    }
  }

  return { processed: (contracts || []).length, results };
}

module.exports = {
  createSetupFeeInvoice,
  createSubscriptionInvoice,
  createInitialContractInvoice,
  markInvoicePaid,
  ensureContractStartInvoices,
  generateInvoicePdfPreview,
  ensureRecurringInvoiceForContract,
  runRecurringBillingSweep
};
