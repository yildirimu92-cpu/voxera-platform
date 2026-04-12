'use strict';

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
    contract_id: payload.contractId || null,
    notes: payload.notes || null,
    pdf_url: payload.pdfUrl || null
  };

  const { data: insertedInvoice, error: invoiceError } = await sbAdmin
    .from('invoices')
    .insert(invoiceRow)
    .select('*')
    .single();

  if (invoiceError) throw new Error(`invoice insert failed: ${invoiceError.message}`);

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

    if (itemError) throw new Error(`invoice items insert failed: ${itemError.message}`);
  }

  return insertedInvoice;
}

function isDuplicateInvoiceReferenceError(error) {
  const code = String(error && error.code || '');
  const msg = String(error && error.message || '').toLowerCase();
  return code === '23505' || msg.includes('duplicate key value');
}

async function createSetupFeeInvoice({ sbAdmin, customer, setupFeeAmount, billingProvider, status, dueAt, paidAt, paidSource, notes, externalReference, stripePaymentIntentId, stripeCheckoutSessionId, stripeInvoiceId }) {
  const amount = money(setupFeeAmount);
  if (amount <= 0) throw new Error('setup fee amount must be > 0');

  return createInvoiceWithItems(sbAdmin, {
    customerId: customer.id,
    subscriptionId: customer.subscription_id || null,
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
    externalReference,
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

async function createSubscriptionInvoice({ sbAdmin, customer, subscription, planConfig, billingProvider, status, dueAt, paidAt, paidSource, notes, externalReference, stripePaymentIntentId, stripeCheckoutSessionId, stripeInvoiceId }) {
  const cycle = String(subscription.billing_cycle || 'monthly').toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
  const baseAmountRaw = cycle === 'yearly' ? planConfig.price_yearly : planConfig.price_monthly;
  const baseAmount = money(baseAmountRaw);

  const now = new Date();
  const periodStartDate = computePeriodStart(subscription, now);
  const periodEndDate = new Date(periodStartDate.getTime());
  periodEndDate.setUTCMonth(periodEndDate.getUTCMonth() + (cycle === 'yearly' ? 12 : 1));

  const usageResult = await loadUsageSummary(sbAdmin, {
    customerId: customer.id,
    periodStartIso: periodStartDate.toISOString(),
    includedMinutes: Number(planConfig.minutes || 0),
    extraRate: Number(planConfig.extra_rate || 0)
  });

  const overageAmount = usageResult.ok ? money(usageResult.usage.overage_amount) : 0;
  const items = [
    {
      itemType: 'subscription_base',
      title: cycle === 'yearly' ? 'Subscription (jährlich)' : 'Subscription (monatlich)',
      description: `${planConfig.plan_label || planConfig.name || planConfig.id || 'Plan'} · ${cycle}`,
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
      unitPrice: usageResult.ok ? numberOr(planConfig.extra_rate, 0) : overageAmount,
      lineTotal: overageAmount,
      metadata: usageResult.ok ? usageResult.usage : {}
    });
  }

  const subtotal = money(baseAmount + overageAmount);

  return createInvoiceWithItems(sbAdmin, {
    customerId: customer.id,
    subscriptionId: subscription.id,
    invoiceType: 'subscription',
    billingProvider,
    status,
    subtotalAmount: subtotal,
    taxAmount: 0,
    totalAmount: subtotal,
    periodStart: toDateOnlyIso(periodStartDate),
    periodEnd: toDateOnlyIso(periodEndDate),
    issuedAt: now,
    dueAt,
    sentAt: status === 'sent' ? now : null,
    paidAt: status === 'paid' ? paidAt || now : null,
    paidSource: status === 'paid' ? (paidSource || 'manual') : null,
    notes,
    externalReference,
    stripePaymentIntentId,
    stripeCheckoutSessionId,
    stripeInvoiceId,
    items
  });
}

async function createInitialContractInvoice({ sbAdmin, customer, contractId, subscription, setupFeeAmount, dueAt, notes }) {
  const normalizedContractId = String(contractId || '').trim();
  if (!normalizedContractId) throw new Error('contractId is required');

  const setupAmount = money(setupFeeAmount);
  if (setupAmount < 0) throw new Error('setup fee amount must be >= 0');

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
    createdInvoice = await createInvoiceWithItems(sbAdmin, {
      customerId: customer.id,
      subscriptionId: subscription && subscription.id ? subscription.id : (customer.subscription_id || null),
      contractId: normalizedContractId,
      invoiceType: 'manual',
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

async function markInvoicePaid(sbAdmin, invoiceId, { paidAt, paidSource, stripePaymentIntentId, stripeCheckoutSessionId, stripeInvoiceId, notes }) {
  const patch = {
    status: 'paid',
    paid_at: toIso(paidAt, new Date().toISOString()),
    paid_source: paidSource || 'manual',
    updated_at: new Date().toISOString()
  };
  if (stripePaymentIntentId) patch.stripe_payment_intent_id = stripePaymentIntentId;
  if (stripeCheckoutSessionId) patch.stripe_checkout_session_id = stripeCheckoutSessionId;
  if (stripeInvoiceId) patch.stripe_invoice_id = stripeInvoiceId;
  if (notes) patch.notes = notes;

  const { data, error } = await sbAdmin
    .from('invoices')
    .update(patch)
    .eq('id', invoiceId)
    .select('*')
    .single();

  if (error) throw new Error(`invoice update failed: ${error.message}`);
  return data;
}

module.exports = {
  createSetupFeeInvoice,
  createSubscriptionInvoice,
  createInitialContractInvoice,
  markInvoicePaid
};
