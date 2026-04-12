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

async function createSetupFeeInvoice({ sbAdmin, customer, setupFeeAmount, billingProvider, status, dueAt, paidAt, paidSource, notes, externalReference, stripePaymentIntentId, stripeCheckoutSessionId, stripeInvoiceId }) {
  const amount = money(setupFeeAmount);
  if (amount <= 0) throw new Error('setup fee amount must be > 0');

  return createInvoiceWithFallbackType(sbAdmin, {
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

async function createSubscriptionInvoice({ sbAdmin, customer, subscription, planConfig, billingProvider, status, dueAt, paidAt, paidSource, notes, externalReference, stripePaymentIntentId, stripeCheckoutSessionId, stripeInvoiceId, debugTag = null }) {
  const logManual = debugTag === 'manual_monthly_invoice';
  if (logManual) manualMonthlyLog('start', { customer_id: customer && customer.id ? customer.id : null });
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

  const invoicePayload = {
    customerId: customer.id,
    subscriptionId: subscription.id,
    invoiceType: 'recurring',
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
  if (logManual) {
    manualMonthlyLog('success', {
      invoice_id: invoice && invoice.id ? invoice.id : null,
      invoice_type: invoice && invoice.invoice_type ? invoice.invoice_type : null
    });
  }
  return invoice;
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
    createdInvoice = await createInvoiceWithFallbackType(sbAdmin, {
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
  dueAt,
  periodStart,
  periodEnd,
  notes,
  lineItem
}) {
  invoiceDiag('invoice_ensure_start', {
    invoice_type: invoiceType,
    external_reference: externalReference,
    contract_id: contractId || null,
    customer_id: customer?.id || null,
    subscription_id: subscriptionId || null,
    payload_keys: ['invoiceType', 'externalReference', 'dueAt', 'periodStart', 'periodEnd', 'lineItem']
  });
  const { data: existing, error: existingError } = await sbAdmin
    .from('invoices')
    .select('*')
    .eq('external_reference', externalReference)
    .maybeSingle();
  if (existingError) {
    invoiceDiag('invoice_ensure_lookup_error', {
      invoice_type: invoiceType,
      external_reference: externalReference,
      db_error: dbErrorMeta(existingError)
    });
    throw new Error(`invoice lookup failed: ${existingError.message}`);
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
  let created;
  try {
    created = await createInvoiceWithFallbackType(sbAdmin, {
      customerId: customer.id,
      offerId,
      subscriptionId,
      contractId,
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
  setupFeeAmount,
  monthlyAmount,
  startDate
}) {
  const setupReference = `setup_fee:${contract.id}`;
  const periodStart = `${startDate}T00:00:00.000Z`;
  const nextMonth = addMonthsIsoDate(startDate, 1);
  const periodEnd = nextMonth ? `${nextMonth}T00:00:00.000Z` : null;
  const monthReference = `month_1:${subscription.id}:${startDate}`;
  const dueAt = periodStart;

  const setupInvoice = await ensureDraftInvoiceWithItems({
    sbAdmin,
    customer,
    offerId: contract.offer_id || null,
    contractId: contract.id,
    subscriptionId: subscription.id,
    invoiceType: 'setup_fee',
    externalReference: setupReference,
    dueAt,
    notes: `Draft setup-fee invoice for contract ${contract.id}`,
    lineItem: {
      itemType: 'setup_fee',
      title: 'Setup Fee Voxera',
      description: 'Einrichtungsgebühr Voxera',
      quantity: 1,
      unitPrice: setupFeeAmount,
      lineTotal: setupFeeAmount,
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
    dueAt,
    periodStart,
    periodEnd,
    notes: `Draft recurring invoice (month 1) for subscription ${subscription.id}`,
    lineItem: {
      itemType: 'subscription_base',
      title: `Voxera Monatsabo ${String(subscription.plan_code || subscription.plan || '').trim() ? `[${String(subscription.plan_code || subscription.plan)}]` : ''}`.trim(),
      description: 'Monatliche Subscription (Monat 1)',
      quantity: 1,
      unitPrice: monthlyAmount,
      lineTotal: monthlyAmount,
      metadata: { billing_cycle: 'monthly', period_start: startDate }
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
    invoice_type: 'month_1',
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

module.exports = {
  createSetupFeeInvoice,
  createSubscriptionInvoice,
  createInitialContractInvoice,
  markInvoicePaid,
  ensureContractStartInvoices,
  generateInvoicePdfPreview
};
