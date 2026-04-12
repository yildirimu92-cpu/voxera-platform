const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { normalizePlanCode, loadPlanByCode } = require('./_lib/plan-config');
const { createSetupFeeInvoice, createSubscriptionInvoice, markInvoicePaid } = require('./_lib/invoice-service');

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

      return response(200, {
        success: true,
        action,
        invoice: updatedInvoice,
        customer,
        access_readiness: {
          state: setupPaid ? 'ready_to_send' : deriveAccessInviteState(customer),
          can_send_access: setupPaid || deriveAccessInviteState(customer) === 'ready_to_send',
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
    const invoiceId = String(body.invoice_id || '').trim();
    if (!invoiceId) return response(400, { error: 'invoice_id fehlt' });
    const reminderLevel = Math.max(1, Math.min(3, Number(body.reminder_level || 1) || 1));

    const { data: invoice, error: invoiceLookupError } = await sbAdmin
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .maybeSingle();
    if (invoiceLookupError) return response(500, { error: 'Invoice lookup failed', details: invoiceLookupError.message });
    if (!invoice) return response(404, { error: 'Rechnung nicht gefunden.' });
    if (String(invoice.customer_id) !== customerId) return response(409, { error: 'Rechnung gehört nicht zu diesem Kunden.' });

    const notePrefix = `[REMINDER L${reminderLevel} ${nowIso}]`;
    const userNote = String(body.notes || '').trim();
    const mergedNotes = [notePrefix, userNote].filter(Boolean).join(' · ');
    const patch = {
      notes: [String(invoice.notes || '').trim(), mergedNotes].filter(Boolean).join('\n'),
      updated_at: nowIso
    };
    const { data: updatedInvoice, error: updateErr } = await sbAdmin
      .from('invoices')
      .update(patch)
      .eq('id', invoiceId)
      .select('*')
      .single();
    if (updateErr) return response(500, { error: 'Reminder konnte nicht gespeichert werden.', details: updateErr.message });
    return response(200, { success: true, action, invoice: updatedInvoice });
  }

  if (action === 'create_manual_setup_invoice') {
    const { data: contract } = await sbAdmin
      .from('contracts')
      .select('id')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!contract?.id) {
      return response(409, { error: 'Keine Vertragsbasis gefunden. Setup-Rechnung muss aus Vertrag/Offerte orchestriert werden.' });
    }
    const amount = Number(body.amount ?? customer.setup_fee_amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return response(400, { error: 'Gültiger setup fee Betrag fehlt.' });
    try {
      const invoice = await createSetupFeeInvoice({
        sbAdmin,
        customer,
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
    const { data: subscription, error: subscriptionError } = await sbAdmin
      .from('subscriptions')
      .select('*')
      .eq('customer_id', customerId)
      .maybeSingle();

    if (subscriptionError) return response(500, { error: 'Subscription lookup failed', details: subscriptionError.message });
    if (!subscription) return response(404, { error: 'Subscription nicht gefunden' });

    const planCode = normalizePlanCode(subscription.plan_code || customer.plan_code || customer.plan);
    const { plan: planConfig, error: planConfigError } = await loadPlanByCode(sbAdmin, planCode);
    if (planConfigError) return response(500, { error: 'Plan-Konfiguration konnte nicht geladen werden.', details: planConfigError.message });
    if (!planConfig) return response(400, { error: `plan_config für ${planCode} fehlt.` });
    try {
      const invoice = await createSubscriptionInvoice({
        sbAdmin,
        customer,
        subscription,
        planConfig,
        billingProvider: 'invoice',
        status: 'sent',
        dueAt: body.due_at || null,
        notes: body.notes || null
      });
      return response(200, { success: true, action, customer, subscription, invoice });
    } catch (err) {
      return response(500, { error: 'Subscription-Invoice konnte nicht erstellt werden.', details: err.message });
    }
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
