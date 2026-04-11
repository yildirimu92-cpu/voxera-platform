const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { normalizePlanCode, loadPlanByCode, isSalesPlanCode } = require('./_lib/plan-config');
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
    'mark_invoice_paid'
  ].includes(action)) {
    return response(400, { error: 'Unbekannte action.' });
  }

  const nowIso = new Date().toISOString();
  const plusMonthsIso = (baseIso, months) => {
    const start = baseIso ? new Date(baseIso) : new Date();
    if (Number.isNaN(start.getTime())) return null;
    const next = new Date(start);
    next.setMonth(next.getMonth() + months);
    return next.toISOString();
  };

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
      const updatedInvoice = await markInvoicePaid(sbAdmin, invoiceId, {
        paidAt: nowIso,
        paidSource,
        stripePaymentIntentId: body.stripe_payment_intent_id,
        stripeCheckoutSessionId: body.stripe_checkout_session_id,
        stripeInvoiceId: body.stripe_invoice_id,
        notes: body.notes
      });
      return response(200, { success: true, action, invoice: updatedInvoice });
    } catch (err) {
      return response(500, { error: 'Invoice konnte nicht als bezahlt markiert werden.', details: err.message });
    }
  }

  const nextPatch = { updated_at: nowIso };

  if (action === 'send_payment_link') {
    const planCode = normalizePlanCode(customer.plan_code || customer.plan);
    if (!isSalesPlanCode(planCode)) {
      return response(409, { error: 'Für diesen Plan kann kein Setup-Fee-Link gesendet werden.' });
    }

    const { plan: planConfig, error: planConfigError } = await loadPlanByCode(sbAdmin, planCode);
    if (planConfigError) {
      return response(500, { error: 'Plan-Konfiguration konnte nicht geladen werden.', details: planConfigError.message });
    }
    if (!planConfig) {
      return response(400, { error: `plan_config für ${planCode} fehlt.` });
    }

    const paymentLink = String(planConfig.setup_fee_payment_link || '').trim();
    if (!paymentLink) {
      return response(400, { error: 'setup_fee_payment_link fehlt in plan_config.' });
    }
    if (!/^https?:\/\//i.test(paymentLink)) {
      return response(400, { error: 'setup_fee_payment_link muss mit http:// oder https:// beginnen.' });
    }

    const setupFeeAmount = Number(planConfig.setup_fee_amount);
    if (!Number.isFinite(setupFeeAmount) || setupFeeAmount < 0) {
      return response(400, { error: 'setup_fee_amount in plan_config ist ungültig.' });
    }

    nextPatch.plan = planCode;
    nextPatch.plan_code = planCode;
    nextPatch.setup_fee_amount = setupFeeAmount;
    nextPatch.payment_link = paymentLink;
    nextPatch.payment_status = 'pending';
    nextPatch.payment_sent_at = nowIso;
    nextPatch.payment_received_at = null;

    if (billingProvider === 'invoice') {
      try {
        const { data: updatedCustomer, error: updateErr } = await sbAdmin
          .from('customers')
          .update(nextPatch)
          .eq('id', customerId)
          .select('*')
          .single();
        if (updateErr) {
          return response(500, { error: 'Billing-Status konnte nicht gespeichert werden.', details: updateErr.message });
        }
        const manualSetupInvoice = await createSetupFeeInvoice({
          sbAdmin,
          customer: updatedCustomer,
          setupFeeAmount,
          billingProvider: 'invoice',
          status: 'sent',
          dueAt: body.due_at || null,
          notes: body.notes || 'Manual setup invoice'
        });
        return response(200, {
          success: true,
          action,
          customer: updatedCustomer,
          invoice: manualSetupInvoice
        });
      } catch (err) {
        return response(500, { error: 'Setup-Invoice konnte nicht erstellt werden.', details: err.message });
      }
    }
  }

  if (action === 'mark_paid') {
    nextPatch.payment_status = 'paid';
    nextPatch.payment_received_at = nowIso;
    if (!customer.payment_sent_at) nextPatch.payment_sent_at = nowIso;

    const setupFeeAmount = Number(customer.setup_fee_amount || 0);
    if (setupFeeAmount > 0) {
      try {
        await createSetupFeeInvoice({
          sbAdmin,
          customer,
          setupFeeAmount,
          billingProvider,
          status: 'paid',
          paidAt: nowIso,
          paidSource,
          notes: body.notes || null,
          externalReference: body.external_reference || null,
          stripePaymentIntentId: body.stripe_payment_intent_id || null,
          stripeCheckoutSessionId: body.stripe_checkout_session_id || null,
          stripeInvoiceId: body.stripe_invoice_id || null
        });
      } catch (err) {
        return response(500, { error: 'Setup-Invoice konnte nicht erstellt werden.', details: err.message });
      }
    }
  }

  if (action === 'create_manual_setup_invoice') {
    const amount = Number(body.amount ?? customer.setup_fee_amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return response(400, { error: 'Gültiger setup fee Betrag fehlt.' });
    await sbAdmin
      .from('customers')
      .update({ payment_status: 'pending', updated_at: nowIso, payment_sent_at: nowIso })
      .eq('id', customer.id);
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

  if (action === 'send_monthly_payment_link' || action === 'send_yearly_payment_link' || action === 'mark_subscription_paid' || action === 'create_manual_subscription_invoice') {
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

    const subscriptionPatch = { updated_at: nowIso };
    if (action === 'send_monthly_payment_link' || action === 'send_yearly_payment_link') {
      const billingCycle = action === 'send_yearly_payment_link' ? 'yearly' : 'monthly';
      const linkField = billingCycle === 'yearly' ? 'yearly_payment_link' : 'monthly_payment_link';
      const paymentLink = String(planConfig[linkField] || '').trim();
      if (!paymentLink) return response(400, { error: `${linkField} fehlt in plan_config.` });
      if (!/^https?:\/\//i.test(paymentLink)) return response(400, { error: `${linkField} muss mit http:// oder https:// beginnen.` });
      subscriptionPatch.billing_cycle = billingCycle;
      subscriptionPatch.subscription_status = 'active';
      subscriptionPatch.starts_at = subscription.starts_at || nowIso;
      subscriptionPatch.last_billing_sent_at = nowIso;
      subscriptionPatch.last_billing_link = paymentLink;
      const monthsToAdd = billingCycle === 'yearly' ? 12 : 1;
      subscriptionPatch.renews_at = subscription.renews_at || plusMonthsIso(nowIso, monthsToAdd);

      if (billingProvider === 'invoice') {
        try {
          await sbAdmin
            .from('subscriptions')
            .update({ payment_status: 'pending', billing_state: 'invoice_sent', last_billing_sent_at: nowIso, updated_at: nowIso })
            .eq('id', subscription.id);
          const manualSubscriptionInvoice = await createSubscriptionInvoice({
            sbAdmin,
            customer,
            subscription: { ...subscription, billing_cycle: billingCycle },
            planConfig,
            billingProvider: 'invoice',
            status: 'sent',
            dueAt: body.due_at || null,
            notes: body.notes || `Manual ${billingCycle} subscription invoice`
          });
          return response(200, {
            success: true,
            action,
            customer,
            subscription,
            invoice: manualSubscriptionInvoice
          });
        } catch (err) {
          return response(500, { error: 'Subscription-Invoice konnte nicht erstellt werden.', details: err.message });
        }
      }
    }
    if (action === 'mark_subscription_paid') {
      const billingCycle = String(subscription.billing_cycle || 'monthly').toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
      const monthsToAdd = billingCycle === 'yearly' ? 12 : 1;
      subscriptionPatch.subscription_status = 'active';
      subscriptionPatch.last_paid_at = nowIso;
      subscriptionPatch.renews_at = plusMonthsIso(nowIso, monthsToAdd);

      try {
        await createSubscriptionInvoice({
          sbAdmin,
          customer,
          subscription: { ...subscription, billing_cycle: billingCycle },
          planConfig,
          billingProvider,
          status: 'paid',
          paidAt: nowIso,
          paidSource,
          notes: body.notes || null,
          externalReference: body.external_reference || null,
          stripePaymentIntentId: body.stripe_payment_intent_id || null,
          stripeCheckoutSessionId: body.stripe_checkout_session_id || null,
          stripeInvoiceId: body.stripe_invoice_id || null
        });
      } catch (err) {
        return response(500, { error: 'Subscription-Invoice konnte nicht erstellt werden.', details: err.message });
      }
    }

    if (action === 'create_manual_subscription_invoice') {
      try {
        await sbAdmin
          .from('subscriptions')
          .update({ payment_status: 'pending', billing_state: 'invoice_sent', last_billing_sent_at: nowIso, updated_at: nowIso })
          .eq('id', subscription.id);
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

    const { data: updatedSubscription, error: updateSubscriptionError } = await sbAdmin
      .from('subscriptions')
      .update(subscriptionPatch)
      .eq('id', subscription.id)
      .select('*')
      .single();

    if (updateSubscriptionError) {
      return response(500, { error: 'Subscription konnte nicht aktualisiert werden.', details: updateSubscriptionError.message });
    }

    return response(200, {
      success: true,
      action,
      customer,
      subscription: updatedSubscription
    });
  }

  const { data: updated, error: updateErr } = await sbAdmin
    .from('customers')
    .update(nextPatch)
    .eq('id', customerId)
    .select('*')
    .single();

  if (updateErr) {
    return response(500, { error: 'Billing-Status konnte nicht gespeichert werden.', details: updateErr.message });
  }

  return response(200, {
    success: true,
    action,
    customer: updated
  });
};
