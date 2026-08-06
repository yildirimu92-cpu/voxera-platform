const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const {
  createSetupFeeInvoice,
  markInvoicePaid,
  ensureRecurringInvoiceForContract
} = require('./_lib/invoice-service');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function parseBillingProvider(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'invoice' || value === 'manual') return 'invoice';
  return 'stripe';
}

function parsePaidSource(raw, fallback) {
  const value = String(raw || '').trim().toLowerCase();
  if (['stripe', 'bank_transfer', 'manual'].includes(value)) return value;
  return fallback;
}

function deriveAccessInviteState(customerRow) {
  const inviteStatus = String(customerRow?.invite_status || '').trim().toLowerCase();
  if (inviteStatus === 'activated') return 'activated';
  if (inviteStatus === 'sent') return 'sent';
  const paymentStatus = String(customerRow?.payment_status || '').trim().toLowerCase();
  if (paymentStatus === 'paid') return 'ready_to_send';
  return 'pending_payment';
}

function legacyActionBlocked(action) {
  return {
    statusCode: 409,
    payload: {
      error: 'Legacy billing action blocked. Use invoice-first actions only.',
      step_failed: 'legacy_action_blocked',
      action,
      allowed_actions: [
        'mark_invoice_paid',
        'record_invoice_reminder',
        'create_manual_setup_invoice',
        'create_manual_subscription_invoice'
      ]
    }
  };
}

function invoiceIsCancelledLike(invoice) {
  const status = String(invoice?.status || '').trim().toLowerCase();
  return ['cancelled', 'canceled', 'void', 'voided'].includes(status);
}

async function loadContractForBilling({ sbAdmin, customerId, requestedContractId = '' }) {
  const normalizedContractId = String(requestedContractId || '').trim();
  if (!normalizedContractId) {
    return { contract: null, error: 'contract_id ist erforderlich. Rechnungen müssen mit Vertragskontext erstellt werden.' };
  }
  const { data: contract, error } = await sbAdmin
    .from('contracts')
    .select('*')
    .eq('id', normalizedContractId)
    .maybeSingle();
  if (error) return { contract: null, error: `Contract lookup failed: ${error.message}` };
  if (!contract) return { contract: null, error: 'Contract nicht gefunden.' };
  if (String(contract.customer_id || '') !== String(customerId)) {
    return { contract: null, error: 'Contract gehört nicht zu diesem Kunden.' };
  }
  return { contract, error: null };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, { error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return response(400, { error: 'Ungueltiger Request Body' }); }

  const customerId = String(body.customer_id || '').trim();
  const action = String(body.action || '').trim().toLowerCase();
  if (!customerId) return response(400, { error: 'customer_id fehlt' });
  if (![
    'send_payment_link',
    'mark_paid',
    'send_monthly_payment_link',
    'send_yearly_payment_link',
    'mark_subscription_paid',
    'create_manual_setup_invoice',
    'create_manual_subscription_invoice',
    'create_manual_invoice',
    'cancel_invoice',
    'create_replacement_invoice',
    'create_credit_note',
    'mark_invoice_paid',
    'record_invoice_reminder'
  ].includes(action)) {
    return response(400, { error: 'Unbekannte action.' });
  }

  const nowIso = new Date().toISOString();
  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();

  if (customerError) return response(500, { error: 'Customer lookup failed', details: customerError.message });
  if (!customer) return response(404, { error: 'Customer nicht gefunden' });
  const billingProvider = parseBillingProvider(body.billing_provider);
  const paidSource = parsePaidSource(body.paid_source, billingProvider === 'stripe' ? 'stripe' : 'manual');

  if (action === 'mark_invoice_paid') {
    const invoiceId = String(body.invoice_id || '').trim();
    if (!invoiceId) return response(400, { error: 'invoice_id fehlt' });
    try {
      const { data: invoice, error: invoiceLookupError } = await sbAdmin
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .maybeSingle();
      if (invoiceLookupError) return response(500, { error: 'Invoice lookup failed', details: invoiceLookupError.message });
      if (!invoice) return response(404, { error: 'Rechnung nicht gefunden.' });
      if (String(invoice.customer_id) !== customerId) return response(409, { error: 'Rechnung gehört nicht zu diesem Kunden.' });

      const updatedInvoice = await markInvoicePaid(sbAdmin, invoiceId, {
        paidAt: body.paid_at || nowIso,
        paidSource,
        paidAmount: body.amount_paid,
        paymentReference: body.payment_reference || body.reference || null,
        stripePaymentIntentId: body.stripe_payment_intent_id,
        stripeCheckoutSessionId: body.stripe_checkout_session_id,
        stripeInvoiceId: body.stripe_invoice_id,
        notes: body.notes
      });
      const { data: setupPaidInvoice } = await sbAdmin
        .from('invoices')
        .select('id')
        .eq('customer_id', customerId)
        .eq('invoice_type', 'setup_fee')
        .eq('status', 'paid')
        .limit(1)
        .maybeSingle();
      const setupPaid = Boolean(setupPaidInvoice?.id);

      // ── Sync customers.payment_status ──────────────────────────
      // If any setup_fee invoice is now paid → set payment_status = 'paid'
      // This keeps the legacy field in sync with invoice reality.
      let updatedCustomer = customer;
      if (setupPaid && String(customer.payment_status || '').toLowerCase() !== 'paid') {
        const { data: custPatched, error: custPatchErr } = await sbAdmin
          .from('customers')
          .update({ payment_status: 'paid', updated_at: nowIso })
          .eq('id', customerId)
          .select('*')
          .maybeSingle();
        if (custPatchErr) {
          console.error('[billing] payment_status sync failed:', custPatchErr.message);
          // Non-blocking: invoice is paid, customer field sync failed — return optimistic state
          updatedCustomer = { ...customer, payment_status: 'paid' };
        } else if (custPatched) {
          updatedCustomer = custPatched;
        }
      }
      // ─────────────────────────────────────────────────────────────

      return response(200, {
        success: true,
        action,
        invoice: updatedInvoice,
        customer: updatedCustomer,
        access_readiness: {
          state: setupPaid ? 'ready_to_send' : deriveAccessInviteState(updatedCustomer),
          can_send_access: setupPaid || deriveAccessInviteState(updatedCustomer) === 'ready_to_send',
          hint: setupPaid
            ? 'Setup-Fee-Rechnung ist bezahlt – Zugangsdaten können jetzt manuell gesendet werden.'
            : 'Rechnung bezahlt markiert.'
        }
      });
    } catch (err) {
      return response(500, { error: 'Invoice konnte nicht als bezahlt markiert werden.', details: err.message });
    }
  }

  if (action === 'record_invoice_reminder') {
    return response(409, {
      error: 'Mahnungen müssen über den zentralen Rechnungsversand ausgelöst werden.',
      step_failed: 'canonical_dunning_dispatch_required',
      action,
      required_function: 'invoice-mail-dispatch'
    });
  }

  if (action === 'create_manual_setup_invoice') {
    const { contract, error: contractError } = await loadContractForBilling({
      sbAdmin,
      customerId,
      requestedContractId: body.contract_id
    });
    if (contractError || !contract) {
      return response(409, {
        error: contractError || 'Keine Vertragsbasis gefunden. Setup-Rechnung muss aus Vertrag/Offerte orchestriert werden.'
      });
    }
    const amount = Number(contract?.setup_fee_amount ?? null);
    if (!Number.isFinite(amount) || amount <= 0) {
      return response(409, {
        error: 'Contract pricing fehlt: contracts.setup_fee_amount muss > 0 sein. Rechnung wurde nicht erstellt.',
        contract_id: contract.id
      });
    }
    try {
      const invoice = await createSetupFeeInvoice({
        sbAdmin,
        customer,
        contractId: contract.id,
        contract,
        offerId: contract.offer_id || null,
        setupFeeAmount: amount,
        billingProvider: 'invoice',
        status: 'sent',
        dueAt: body.due_at || null,
        notes: body.notes || null
      });
      return response(200, { success: true, action, invoice });
    } catch (err) {
      return response(500, { error: 'Setup-Invoice konnte nicht erstellt werden.', details: err.message });
    }
  }

  if (action === 'create_manual_subscription_invoice') {
    const helperName = 'createSubscriptionInvoice';
    const helperPayload = {
      customer_id: customerId,
      billing_provider: 'invoice',
      status: 'sent',
      due_at: body.due_at || null,
      notes: body.notes || null,
      debug_tag: 'manual_monthly_invoice'
    };
    const { contract, error: contractError } = await loadContractForBilling({
      sbAdmin,
      customerId,
      requestedContractId: body.contract_id
    });
    if (contractError || !contract) {
      return response(409, { error: contractError || 'Keine Vertragsbasis gefunden.' });
    }

    const { data: subscription, error: subscriptionError } = await sbAdmin
      .from('subscriptions')
      .select('*')
      .eq('customer_id', customerId)
      .maybeSingle();

    if (subscriptionError) return response(500, { error: 'Subscription lookup failed', details: subscriptionError.message });
    if (!subscription) return response(404, { error: 'Subscription nicht gefunden' });

    try {
      const ensured = await ensureRecurringInvoiceForContract({
        sbAdmin,
        customer,
        contract,
        subscription,
        force: false,
        status: 'sent',
        billingProvider: 'invoice',
        notes: body.notes || 'Manual recurring trigger via admin'
      });
      if (ensured.skipped === 'not_due') {
        return response(409, {
          error: `Nächste Vertragsperiode (${contract.next_invoice_date || 'nicht gesetzt'}) ist noch nicht fällig. Für Sonderfälle bitte "create_manual_invoice" nutzen.`,
          contract_id: contract.id,
          step_failed: 'create_manual_subscription_invoice_not_due'
        });
      }
      return response(200, {
        success: true,
        action,
        customer,
        subscription,
        invoice: ensured.invoice,
        created: Boolean(ensured.created),
        skipped: ensured.skipped || null
      });
    } catch (err) {
      const msg = err?.db_message || err?.message || 'Subscription-Invoice konnte nicht erstellt werden.';
      if (String(msg).toLowerCase().includes('contract recurring price missing')) {
        return response(409, {
          error: 'Contract pricing fehlt: recurring price aus Vertrag ist ungültig. Subscription-Rechnung wurde nicht erstellt.',
          contract_id: contract.id,
          step_failed: err?.step_failed || 'create_manual_subscription_invoice'
        });
      }
      return response(500, {
        error: msg,
        db_message: err?.db_message || null,
        db_code: err?.db_code || null,
        db_details: err?.db_details || null,
        db_hint: err?.db_hint || null,
        step_failed: err?.step_failed || 'create_manual_subscription_invoice',
        helper_name: err?.helper_name || helperName,
        payload_sent: err?.payload_sent || helperPayload
      });
    }
  }

  if (action === 'create_manual_invoice') {
    const contractId = String(body.contract_id || '').trim() || null;
    const amount = Number(body.amount || body.total_amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return response(400, { error: 'amount muss > 0 sein.' });
    const title = String(body.title || 'Manual invoice').trim();
    const invoiceTypeRaw = String(body.invoice_type || 'manual').trim().toLowerCase();
    const invoiceType = invoiceTypeRaw === 'credit_note' ? 'credit_note' : 'manual';
    const dueAt = body.due_at || null;
    const nowIso = new Date().toISOString();
    const externalReference = `manual:${customerId}:${Date.now()}`;
    const payload = {
      invoice_number: await sbAdmin.rpc('next_invoice_number_v1').then((r) => r.data),
      customer_id: customerId,
      contract_id: contractId,
      subscription_id: null,
      invoice_type: invoiceType,
      billing_provider: 'invoice',
      status: 'draft',
      currency: 'CHF',
      subtotal_amount: Number(amount.toFixed(2)),
      tax_amount: 0,
      total_amount: Number(amount.toFixed(2)),
      issued_at: nowIso,
      due_at: dueAt,
      external_reference: externalReference,
      notes: body.notes || null
    };
    const { data: invoice, error: invoiceError } = await sbAdmin.from('invoices').insert(payload).select('*').single();
    if (invoiceError) return response(500, { error: 'Manual invoice create failed', details: invoiceError.message });
    const item = {
      invoice_id: invoice.id,
      sort_order: 1,
      item_type: 'manual',
      title,
      // invoice_items.description is NOT NULL in production; '' rather than
      // null so an admin-supplied invoice without a description doesn't fail.
      description: body.description || '',
      quantity: 1,
      unit_price: Number(amount.toFixed(2)),
      line_total: Number(amount.toFixed(2)),
      metadata: { source: 'manual_admin', invoice_type: invoiceType }
    };
    const { error: itemError } = await sbAdmin.from('invoice_items').insert(item);
    if (itemError) return response(500, { error: 'Manual invoice item create failed', details: itemError.message, invoice_id: invoice.id });
    return response(200, { success: true, action, invoice });
  }

  if (action === 'cancel_invoice') {
    const invoiceId = String(body.invoice_id || '').trim();
    if (!invoiceId) return response(400, { error: 'invoice_id fehlt' });
    const { data: invoice, error: lookupError } = await sbAdmin.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
    if (lookupError) return response(500, { error: 'Invoice lookup failed', details: lookupError.message });
    if (!invoice) return response(404, { error: 'Rechnung nicht gefunden.' });
    if (String(invoice.customer_id || '') !== customerId) return response(409, { error: 'Rechnung gehört nicht zu diesem Kunden.' });
    if (invoiceIsCancelledLike(invoice)) return response(200, { success: true, action, invoice, already_cancelled: true });
    const patch = { status: 'cancelled', dunning_status: 'closed_cancelled', dunning_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { data: cancelled, error: cancelError } = await sbAdmin.from('invoices').update(patch).eq('id', invoiceId).select('*').single();
    if (cancelError) return response(500, { error: 'Invoice cancel failed', details: cancelError.message });
    return response(200, { success: true, action, invoice: cancelled });
  }

  if (action === 'create_replacement_invoice') {
    const invoiceId = String(body.invoice_id || '').trim();
    if (!invoiceId) return response(400, { error: 'invoice_id fehlt' });
    const { data: original, error: lookupError } = await sbAdmin.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
    if (lookupError) return response(500, { error: 'Invoice lookup failed', details: lookupError.message });
    if (!original) return response(404, { error: 'Originalrechnung nicht gefunden.' });
    if (!invoiceIsCancelledLike(original)) return response(409, { error: 'Replacement nur nach storniert/voided erlaubt.' });
    const amount = Number(body.amount || original.total_amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return response(400, { error: 'amount muss > 0 sein.' });
    const nowIso = new Date().toISOString();
    const replacementRef = `replacement:${original.id}:${Date.now()}`;
    const { data: numData } = await sbAdmin.rpc('next_invoice_number_v1');
    const insertPayload = {
      invoice_number: String(numData || ''),
      customer_id: original.customer_id,
      contract_id: original.contract_id || null,
      subscription_id: original.subscription_id || null,
      invoice_type: original.invoice_type || 'manual',
      billing_provider: 'invoice',
      status: 'draft',
      currency: original.currency || 'CHF',
      subtotal_amount: Number(amount.toFixed(2)),
      tax_amount: 0,
      total_amount: Number(amount.toFixed(2)),
      issued_at: nowIso,
      due_at: body.due_at || original.due_at || null,
      period_start: original.period_start || null,
      period_end: original.period_end || null,
      external_reference: replacementRef,
      replacement_for_invoice_id: original.id,
      notes: body.notes || `Replacement for ${original.invoice_number || original.id}`
    };
    const { data: replacement, error: replError } = await sbAdmin.from('invoices').insert(insertPayload).select('*').single();
    if (replError) return response(500, { error: 'Replacement invoice create failed', details: replError.message });
    const { data: origItems } = await sbAdmin.from('invoice_items').select('*').eq('invoice_id', original.id).order('sort_order', { ascending: true });
    if (Array.isArray(origItems) && origItems.length) {
      const mapped = origItems.map((it) => ({ ...it, id: undefined, invoice_id: replacement.id }));
      await sbAdmin.from('invoice_items').insert(mapped.map((it) => ({
        invoice_id: it.invoice_id, sort_order: it.sort_order, item_type: it.item_type, title: it.title, description: it.description,
        quantity: it.quantity, unit_price: it.unit_price, line_total: it.line_total, metadata: it.metadata || {}
      })));
    }
    return response(200, { success: true, action, invoice: replacement, original_invoice_id: original.id });
  }

  if (action === 'create_credit_note') {
    const originalInvoiceId = String(body.invoice_id || '').trim();
    if (!originalInvoiceId) return response(400, { error: 'invoice_id fehlt' });
    const { data: original, error: lookupError } = await sbAdmin.from('invoices').select('*').eq('id', originalInvoiceId).maybeSingle();
    if (lookupError) return response(500, { error: 'Invoice lookup failed', details: lookupError.message });
    if (!original) return response(404, { error: 'Originalrechnung nicht gefunden.' });
    const amountRaw = Number(body.amount || original.total_amount || 0);
    if (!Number.isFinite(amountRaw) || amountRaw <= 0) return response(400, { error: 'amount muss > 0 sein.' });
    const amount = Number((-Math.abs(amountRaw)).toFixed(2));
    const { data: numData } = await sbAdmin.rpc('next_invoice_number_v1');
    const payload = {
      invoice_number: String(numData || ''),
      customer_id: original.customer_id,
      contract_id: original.contract_id || null,
      subscription_id: original.subscription_id || null,
      invoice_type: 'credit_note',
      billing_provider: 'invoice',
      status: 'draft',
      currency: original.currency || 'CHF',
      subtotal_amount: amount,
      tax_amount: 0,
      total_amount: amount,
      issued_at: new Date().toISOString(),
      due_at: body.due_at || null,
      external_reference: `credit_note:${original.id}:${Date.now()}`,
      replacement_for_invoice_id: original.id,
      notes: body.notes || `Credit note for ${original.invoice_number || original.id}`
    };
    const { data: credit, error: creditError } = await sbAdmin.from('invoices').insert(payload).select('*').single();
    if (creditError) return response(500, { error: 'Credit note create failed', details: creditError.message });
    await sbAdmin.from('invoice_items').insert({
      invoice_id: credit.id,
      sort_order: 1,
      item_type: 'credit_note',
      title: 'Credit Note',
      description: body.description || `Gutschrift zu Rechnung ${original.invoice_number || original.id}`,
      quantity: 1,
      unit_price: amount,
      line_total: amount,
      metadata: { original_invoice_id: original.id }
    });
    return response(200, { success: true, action, invoice: credit, original_invoice_id: original.id });
  }

  if (action === 'create_overage_invoice') {
    const overageMinutesRaw = Number(body.overage_minutes);
    const overageRateRaw    = Number(body.overage_rate);
    if (!Number.isFinite(overageMinutesRaw) || overageMinutesRaw <= 0) {
      return response(400, { error: 'overage_minutes muss eine positive Zahl sein.' });
    }
    if (!Number.isFinite(overageRateRaw) || overageRateRaw <= 0) {
      return response(400, { error: 'overage_rate muss eine positive Zahl sein.' });
    }
    const overageMinutes = Math.floor(overageMinutesRaw);
    const overageRate    = overageRateRaw;
    // periodMonth can be YYYY-MM (legacy) OR YYYY-MM-DD (new contract-cycle key)
    const periodMonth    = String(body.period_month || '').trim();
    if (!periodMonth) {
      return response(400, { error: 'period_month fehlt.' });
    }
    const contractId = String(body.contract_id || '').trim() || null;

    // ── Idempotency key — synchronized with daily-billing-runner ──
    // New key (contract-cycle): overage:<contract_id>:<period_start_date>  e.g. overage:bc0c5ae4:2026-05-02
    // Legacy key (calendar):    overage:<customer_id>:<YYYY-MM>            e.g. overage:cust_xxx:2026-05
    // We check BOTH keys so manual + automatic billing never duplicate.
    const isDateKey = /^\d{4}-\d{2}-\d{2}$/.test(periodMonth);
    const newKey     = contractId ? `overage:${contractId}:${periodMonth}` : null;
    const legacyKey  = `overage:${customerId}:${periodMonth.slice(0, 7)}`; // YYYY-MM prefix

    // Check new key first (contract-cycle)
    let existing = null;
    let existingErr = null;
    if (newKey) {
      const res1 = await sbAdmin.from('invoices').select('*').eq('external_reference', newKey).maybeSingle();
      if (res1.error) return response(500, { error: 'Idempotency lookup failed', details: res1.error.message });
      existing = res1.data;
    }
    // Fallback: check legacy key
    if (!existing) {
      const res2 = await sbAdmin.from('invoices').select('*').eq('external_reference', legacyKey).maybeSingle();
      if (res2.error) return response(500, { error: 'Idempotency lookup failed', details: res2.error.message });
      existing = res2.data;
    }
    // Use new key if available, otherwise legacy
    const externalReference = newKey || legacyKey;

    if (existing) {
      return response(200, {
        success: true,
        action,
        invoice: existing,
        created: false,
        skipped: 'already_exists_for_period'
      });
    }
    const totalAmount = Number((overageMinutes * overageRate).toFixed(2));
    // Support both YYYY-MM (calendar month) and YYYY-MM-DD (contract-cycle start date)
    let periodStart, periodEnd;
    const isFullDate = /^\d{4}-\d{2}-\d{2}$/.test(periodMonth);
    if (isFullDate) {
      // Contract-cycle: period_start = exact date, period_end = same day next month
      const startD = new Date(periodMonth + 'T00:00:00Z');
      const endD   = new Date(Date.UTC(startD.getUTCFullYear(), startD.getUTCMonth() + 1, startD.getUTCDate()));
      periodStart = startD.toISOString();
      periodEnd   = endD.toISOString();
    } else {
      // Calendar month: YYYY-MM → first to first of next month
      const [yearStr, monthStr] = periodMonth.split('-');
      periodStart = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1)).toISOString();
      periodEnd   = new Date(Date.UTC(Number(yearStr), Number(monthStr), 1)).toISOString();
    }
    const nowIso = new Date().toISOString();
    const payload = {
      invoice_number: await sbAdmin.rpc('next_invoice_number_v1').then((r) => r.data),
      customer_id: customerId,
      contract_id: contractId,
      subscription_id: null,
      invoice_type: 'extra_minutes',
      billing_provider: 'invoice',
      status: 'draft',
      currency: 'CHF',
      subtotal_amount: totalAmount,
      tax_amount: 0,
      total_amount: totalAmount,
      issued_at: nowIso,
      due_at: nowIso,
      period_start: periodStart,
      period_end: periodEnd,
      external_reference: externalReference,
      notes: body.notes || `Überzugsrechnung ${periodMonth}`,
      metadata: {
        source: 'manual_overage',
        overage_minutes: overageMinutes,
        overage_rate: overageRate,
        period_month: periodMonth
      }
    };
    const { data: invoice, error: invoiceError } = await sbAdmin
      .from('invoices')
      .insert(payload)
      .select('*')
      .single();
    if (invoiceError) {
      return response(500, { error: 'Overage invoice create failed', details: invoiceError.message });
    }
    const item = {
      invoice_id: invoice.id,
      sort_order: 1,
      item_type: 'extra_minutes',
      title: `Überzug ${periodMonth}`,
      description: `${overageMinutes} Min × CHF ${overageRate.toFixed(2)}/Min`,
      quantity: overageMinutes,
      unit_price: overageRate,
      line_total: totalAmount,
      metadata: { source: 'manual_overage', period_month: periodMonth }
    };
    const { error: itemError } = await sbAdmin.from('invoice_items').insert(item);
    if (itemError) {
      return response(500, {
        error: 'Overage invoice item create failed',
        details: itemError.message,
        invoice_id: invoice.id
      });
    }

    // ── Überzugs-Mail via Make ──────────────────────────────────────
    try {
      const customerMailData = await sbAdmin
        .from('customers')
        .select('customer_name, email, contact_first_name, contact_last_name, contact_name')
        .eq('id', customerId)
        .single();

      if (customerMailData.data) {
        const c = customerMailData.data;
        const recipientName = c.contact_first_name
          ? `${c.contact_first_name} ${c.contact_last_name || ''}`.trim()
          : (c.contact_name || c.customer_name || 'Kunde');

        const periodLabel = body.period_start_label && body.period_end_label
          ? `${body.period_start_label} – ${body.period_end_label}`
          : (body.period_month || '—');

        const mailOverageRate = Number(body.overage_rate || 0);
        const mailOverageMinutes = Number(body.overage_minutes || 0);
        const totalAmountMail = (mailOverageMinutes * mailOverageRate).toFixed(2);

        // Überzug wird per Banküberweisung bezahlt (kein fixer Stripe-Link möglich)
        const voxeraIban = process.env.VOXERA_IBAN || 'CH53 0878 1000 2615 3320 0';
        const voxeraBic  = process.env.VOXERA_BIC  || 'SWQBCHZZXXX';
        const voxeraBank = process.env.VOXERA_BANK_NAME || 'Voxera AI c/o Umut Yildirim';

        await fetch('https://hook.eu1.make.com/4hlkpn5t6i3m9wsvu5mbpqggygq4yc6s', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mail_type: 'overage_email',
            recipient_name: recipientName,
            customer_email: c.email,
            customer_name: c.customer_name,
            period_label: periodLabel,
            invoice_number: invoice.invoice_number || '—',
            included_minutes: body.included_minutes || '—',
            used_minutes: body.used_minutes || '—',
            overage_minutes: mailOverageMinutes,
            overage_rate: mailOverageRate.toFixed(4),
            total_amount: totalAmountMail,
            // Banküberweisung statt Stripe Link
            payment_method: 'bank_transfer',
            payment_iban: voxeraIban,
            payment_bank: voxeraBank,
            payment_reference: invoice.invoice_number || '—',
            payment_due_days: 7
          })
        });
      }
    } catch (mailErr) {
      // Mail-Fehler darf die Invoice-Response nicht blockieren
      console.error('[overage-mail] webhook error:', mailErr.message);
    }
    // ── Ende Überzugs-Mail ─────────────────────────────────────────

    return response(200, { success: true, action, invoice, created: true });
  }

  if ([
    'send_payment_link',
    'mark_paid',
    'send_monthly_payment_link',
    'send_yearly_payment_link',
    'mark_subscription_paid'
  ].includes(action)) {
    const blocked = legacyActionBlocked(action);
    return response(blocked.statusCode, blocked.payload);
  }
  return response(400, { error: 'Unbekannte action.' });
};
