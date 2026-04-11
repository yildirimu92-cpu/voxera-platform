'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { createOutboxEvent, markOutboxSent, markOutboxFailed } = require('./_lib/webhook-outbox');
const { normalizePlanCode, loadPlanByCode, isSalesPlanCode } = require('./_lib/plan-config');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function log(level, event, payload = {}) {
  console.log(JSON.stringify({ level, event, ...payload }));
}

function parseBody(event) {
  try {
    return { ok: true, body: JSON.parse(event.body || '{}') };
  } catch (_err) {
    return { ok: false, error: 'Ungültiger Request Body.' };
  }
}

function trimOrNull(value) {
  const v = String(value || '').trim();
  return v || null;
}

function pickOfferRecipientEmail(offer, overrides) {
  return trimOrNull(overrides?.to_email) || trimOrNull(offer?.sent_to_email) || trimOrNull(offer?.email);
}

async function loadOfferPayload(sbAdmin, body) {
  const offerId = trimOrNull(body.offer_id);
  if (!offerId) return { ok: false, statusCode: 400, error: 'offer_id fehlt.' };

  const { data: offer, error } = await sbAdmin
    .from('offers')
    .select('*')
    .eq('id', offerId)
    .maybeSingle();

  if (error) return { ok: false, statusCode: 500, error: 'Offer lookup failed.', details: error.message };
  if (!offer) return { ok: false, statusCode: 404, error: 'Offerte nicht gefunden.' };

  const recipientEmail = pickOfferRecipientEmail(offer, body.overrides || {});
  if (!recipientEmail) {
    return { ok: false, statusCode: 400, error: 'Offerte hat keine Empfänger-E-Mail.' };
  }

  const payload = {
    event_type: 'offer_email',
    mail_type: 'offer_email',
    recipient: {
      email: recipientEmail,
      name: trimOrNull(offer.contact_name) || trimOrNull(offer.company_name)
    },
    offer: {
      id: offer.id,
      offer_number: offer.offer_number,
      status: offer.status,
      valid_until: offer.valid_until,
      plan: offer.plan,
      billing_cycle: offer.billing_cycle,
      setup_fee: Number(offer.setup_fee || 0),
      monthly_price: Number(offer.monthly_price || 0),
      yearly_price: Number(offer.yearly_price || 0),
      discount_amount: Number(offer.discount_amount || 0),
      discount_percent: Number(offer.discount_percent || 0),
      total: Number(offer.total || 0),
      add_ons: offer.add_ons || {}
    },
    customer: {
      id: offer.customer_id || null,
      company_name: offer.company_name || null,
      contact_name: offer.contact_name || null,
      email: offer.email || null,
      phone: offer.phone || null,
      address: offer.address || null,
      street: offer.street || null,
      postal_code: offer.postal_code || null,
      city: offer.city || null,
      country: offer.country || null
    },
    meta: {
      source: 'admin_panel',
      sent_to_email: recipientEmail,
      requested_at: new Date().toISOString()
    }
  };

  return {
    ok: true,
    eventType: 'offer_email',
    payload,
    payloadSummary: `offer_email -> ${recipientEmail}`,
    dedupeKey: `offer_email:${offer.id}:${Date.now()}`,
    responseData: {
      offer_id: offer.id,
      sent_to_email: recipientEmail,
      offer_number: offer.offer_number
    }
  };
}

async function loadSubscriptionPaymentPayload(sbAdmin, body) {
  const explicitCustomerId = trimOrNull(body.customer_id);
  const explicitSubscriptionId = trimOrNull(body.subscription_id);
  if (!explicitCustomerId && !explicitSubscriptionId) {
    return { ok: false, statusCode: 400, error: 'Für subscription_payment_email ist customer_id oder subscription_id erforderlich.' };
  }

  let subscription = null;
  if (explicitSubscriptionId) {
    const { data, error } = await sbAdmin
      .from('subscriptions')
      .select('*')
      .eq('id', explicitSubscriptionId)
      .maybeSingle();
    if (error) return { ok: false, statusCode: 500, error: 'Subscription lookup failed.', details: error.message };
    if (!data) return { ok: false, statusCode: 404, error: 'Subscription nicht gefunden.' };
    subscription = data;
  } else {
    const { data, error } = await sbAdmin
      .from('subscriptions')
      .select('*')
      .eq('customer_id', explicitCustomerId)
      .maybeSingle();
    if (error) return { ok: false, statusCode: 500, error: 'Subscription lookup failed.', details: error.message };
    if (!data) return { ok: false, statusCode: 404, error: 'Subscription nicht gefunden.' };
    subscription = data;
  }

  if (explicitCustomerId && String(subscription.customer_id) !== explicitCustomerId) {
    return { ok: false, statusCode: 409, error: 'subscription_id gehört nicht zur customer_id.' };
  }

  const customerId = String(subscription.customer_id || explicitCustomerId || '');
  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();

  if (customerError) return { ok: false, statusCode: 500, error: 'Customer lookup failed.', details: customerError.message };
  if (!customer) return { ok: false, statusCode: 404, error: 'Kunde nicht gefunden.' };

  const recipientEmail = trimOrNull(body?.overrides?.to_email) || trimOrNull(customer.email);
  if (!recipientEmail) {
    return { ok: false, statusCode: 400, error: 'Kunde hat keine Empfänger-E-Mail.' };
  }

  const planCode = normalizePlanCode(subscription.plan_code || customer.plan_code || customer.plan || subscription.plan);
  const { plan: planConfig, error: planConfigError } = await loadPlanByCode(sbAdmin, planCode);
  if (planConfigError) {
    return { ok: false, statusCode: 500, error: 'Plan-Konfiguration konnte nicht geladen werden.', details: planConfigError.message };
  }
  if (!planConfig) {
    return { ok: false, statusCode: 400, error: `plan_config für ${planCode} fehlt.` };
  }

  const billingCycle = String(subscription.billing_cycle || 'monthly').trim().toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
  const linkField = billingCycle === 'yearly' ? 'yearly_payment_link' : 'monthly_payment_link';
  const paymentLink = trimOrNull(planConfig[linkField]);

  if (!paymentLink) {
    return { ok: false, statusCode: 400, error: `${linkField} fehlt in plan_config.` };
  }
  if (!/^https?:\/\//i.test(paymentLink)) {
    return { ok: false, statusCode: 400, error: `${linkField} muss mit http:// oder https:// beginnen.` };
  }

  const payload = {
    event_type: 'subscription_payment_email',
    mail_type: 'subscription_payment_email',
    recipient: {
      email: recipientEmail,
      name: trimOrNull(customer.contact_name) || trimOrNull(customer.customer_name)
    },
    customer: {
      id: customer.id,
      customer_name: customer.customer_name || null,
      email: customer.email || null,
      plan_code: normalizePlanCode(customer.plan_code || customer.plan || null)
    },
    subscription: {
      id: subscription.id,
      customer_id: subscription.customer_id,
      plan_code: planCode,
      billing_cycle: billingCycle,
      subscription_status: subscription.subscription_status || null,
      renews_at: subscription.renews_at || null,
      payment_status: subscription.payment_status || null,
      billing_state: subscription.billing_state || null,
      payment_link: paymentLink
    },
    pricing: {
      price_monthly: Number(planConfig.price_monthly || 0),
      price_yearly: Number(planConfig.price_yearly || 0),
      currency: 'CHF'
    },
    plan: {
      id: planConfig.id || planCode,
      plan_label: planConfig.plan_label || planConfig.name || planCode
    },
    meta: {
      source: 'admin_panel',
      requested_at: new Date().toISOString()
    }
  };

  return {
    ok: true,
    eventType: 'subscription_payment_email',
    payload,
    payloadSummary: `subscription_payment_email -> ${recipientEmail}`,
    dedupeKey: `subscription_payment_email:${subscription.id}:${Date.now()}`,
    responseData: {
      customer_id: customer.id,
      subscription_id: subscription.id,
      sent_to_email: recipientEmail,
      billing_cycle: billingCycle
    }
  };
}

function customerRecipientName(customer) {
  return trimOrNull(customer?.contact_name)
    || trimOrNull(customer?.customer_name)
    || trimOrNull(customer?.company_name)
    || null;
}

async function loadSetupFeePayload(sbAdmin, body) {
  const customerId = trimOrNull(body.customer_id);
  if (!customerId) return { ok: false, statusCode: 400, error: 'Für setup_fee_email ist customer_id erforderlich.' };

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();
  if (customerError) return { ok: false, statusCode: 500, error: 'Customer lookup failed.', details: customerError.message };
  if (!customer) return { ok: false, statusCode: 404, error: 'Kunde nicht gefunden.' };

  const recipientEmail = trimOrNull(body?.overrides?.to_email) || trimOrNull(customer.email);
  if (!recipientEmail) {
    return { ok: false, statusCode: 400, error: 'Kunde hat keine Empfänger-E-Mail.' };
  }

  const planCode = normalizePlanCode(customer.plan_code || customer.plan);
  if (!isSalesPlanCode(planCode)) {
    return { ok: false, statusCode: 409, error: 'Für diesen Plan kann kein Setup-Fee-Link versendet werden.' };
  }

  const { plan: planConfig, error: planConfigError } = await loadPlanByCode(sbAdmin, planCode);
  if (planConfigError) {
    return { ok: false, statusCode: 500, error: 'Plan-Konfiguration konnte nicht geladen werden.', details: planConfigError.message };
  }
  if (!planConfig) {
    return { ok: false, statusCode: 400, error: `plan_config für ${planCode} fehlt.` };
  }

  const paymentLink = trimOrNull(customer.payment_link) || trimOrNull(planConfig.setup_fee_payment_link);
  if (!paymentLink) {
    return { ok: false, statusCode: 400, error: 'setup_fee_payment_link fehlt in plan_config.' };
  }
  if (!/^https?:\/\//i.test(paymentLink)) {
    return { ok: false, statusCode: 400, error: 'setup_fee_payment_link muss mit http:// oder https:// beginnen.' };
  }

  const setupFeeAmount = Number(
    customer.setup_fee_amount != null ? customer.setup_fee_amount : planConfig.setup_fee_amount
  );
  if (!Number.isFinite(setupFeeAmount) || setupFeeAmount < 0) {
    return { ok: false, statusCode: 400, error: 'setup_fee_amount ist ungültig.' };
  }

  const payload = {
    event_type: 'setup_fee_email',
    mail_type: 'setup_fee_email',
    recipient: {
      email: recipientEmail,
      name: customerRecipientName(customer)
    },
    customer: {
      id: customer.id,
      customer_name: customer.customer_name || null,
      contact_name: customer.contact_name || null,
      email: customer.email || null,
      plan_code: planCode,
      payment_status: customer.payment_status || null
    },
    setup_fee: {
      amount: Number(setupFeeAmount.toFixed(2)),
      currency: 'CHF',
      payment_link: paymentLink
    },
    plan: {
      id: planConfig.id || planCode,
      plan_label: planConfig.plan_label || planConfig.name || planCode
    },
    meta: {
      source: 'admin_panel',
      requested_at: new Date().toISOString()
    }
  };

  return {
    ok: true,
    eventType: 'setup_fee_email',
    payload,
    payloadSummary: `setup_fee_email -> ${recipientEmail}`,
    dedupeKey: `setup_fee_email:${customer.id}:${Date.now()}`,
    responseData: {
      customer_id: customer.id,
      sent_to_email: recipientEmail,
      plan_code: planCode
    }
  };
}

async function loadInvoicePayload(sbAdmin, body) {
  const invoiceId = trimOrNull(body.invoice_id);
  if (!invoiceId) return { ok: false, statusCode: 400, error: 'Für invoice_email ist invoice_id erforderlich.' };

  const { data: invoice, error: invoiceError } = await sbAdmin
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle();
  if (invoiceError) return { ok: false, statusCode: 500, error: 'Invoice lookup failed.', details: invoiceError.message };
  if (!invoice) return { ok: false, statusCode: 404, error: 'Rechnung nicht gefunden.' };

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('*')
    .eq('id', String(invoice.customer_id))
    .maybeSingle();
  if (customerError) return { ok: false, statusCode: 500, error: 'Customer lookup failed.', details: customerError.message };
  if (!customer) return { ok: false, statusCode: 404, error: 'Kunde für Rechnung nicht gefunden.' };

  const recipientEmail = trimOrNull(body?.overrides?.to_email) || trimOrNull(customer.email);
  if (!recipientEmail) {
    return { ok: false, statusCode: 400, error: 'Kunde hat keine Empfänger-E-Mail.' };
  }

  let subscription = null;
  if (invoice.subscription_id) {
    const { data: subData, error: subError } = await sbAdmin
      .from('subscriptions')
      .select('*')
      .eq('id', invoice.subscription_id)
      .maybeSingle();
    if (subError) return { ok: false, statusCode: 500, error: 'Subscription lookup failed.', details: subError.message };
    subscription = subData || null;
  }

  const payload = {
    event_type: 'invoice_email',
    mail_type: 'invoice_email',
    recipient: {
      email: recipientEmail,
      name: customerRecipientName(customer)
    },
    customer: {
      id: customer.id,
      customer_name: customer.customer_name || null,
      contact_name: customer.contact_name || null,
      email: customer.email || null
    },
    invoice: {
      id: invoice.id,
      invoice_number: invoice.invoice_number || null,
      invoice_type: invoice.invoice_type || null,
      status: invoice.status || null,
      amount: Number(invoice.total_amount || 0),
      due_at: invoice.due_at || null,
      currency: invoice.currency || 'CHF',
      pdf_url: trimOrNull(invoice.pdf_url),
      payment_link: trimOrNull(invoice.external_reference),
      issued_at: invoice.issued_at || null,
      paid_at: invoice.paid_at || null
    },
    subscription: subscription ? {
      id: subscription.id,
      billing_cycle: subscription.billing_cycle || null,
      plan_code: normalizePlanCode(subscription.plan_code || customer.plan_code || customer.plan)
    } : null,
    meta: {
      source: 'admin_panel',
      requested_at: new Date().toISOString()
    }
  };

  return {
    ok: true,
    eventType: 'invoice_email',
    payload,
    payloadSummary: `invoice_email -> ${recipientEmail}`,
    dedupeKey: `invoice_email:${invoice.id}:${Date.now()}`,
    responseData: {
      invoice_id: invoice.id,
      customer_id: customer.id,
      sent_to_email: recipientEmail,
      invoice_number: invoice.invoice_number || null
    }
  };
}

async function buildDispatchPayload(sbAdmin, body) {
  const eventType = trimOrNull(body.event_type);
  if (!eventType) return { ok: false, statusCode: 400, error: 'event_type fehlt.' };

  if (eventType === 'offer_email') {
    return loadOfferPayload(sbAdmin, body);
  }

  if (eventType === 'subscription_payment_email') {
    return loadSubscriptionPaymentPayload(sbAdmin, body);
  }

  if (eventType === 'setup_fee_email') {
    return loadSetupFeePayload(sbAdmin, body);
  }

  if (eventType === 'invoice_email') {
    return loadInvoicePayload(sbAdmin, body);
  }

  return { ok: false, statusCode: 400, error: `Unbekannter event_type: ${eventType}` };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, { error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  const parsed = parseBody(event);
  if (!parsed.ok) return response(400, { error: parsed.error });

  const dispatch = await buildDispatchPayload(sbAdmin, parsed.body);
  if (!dispatch.ok) return response(dispatch.statusCode || 400, {
    error: dispatch.error,
    details: dispatch.details || null
  });

  const eventType = dispatch.eventType;
  let outbox;

  try {
    outbox = await createOutboxEvent(sbAdmin, {
      eventType,
      payload: dispatch.payload,
      payloadSummary: dispatch.payloadSummary,
      dedupeKey: dispatch.dedupeKey
    });
  } catch (outboxErr) {
    const msg = outboxErr && outboxErr.message ? outboxErr.message : 'outbox insert failed';
    log('error', 'outbox_insert_failed', { event_type: eventType, error: msg });
    return response(500, { error: 'Webhook-Outbox konnte nicht gespeichert werden.', details: msg });
  }

  log('info', 'webhook_send_attempt', { event_type: eventType, outbox_id: outbox.id, requested_by: caller.userId || null });

  const webhookUrl = process.env.MAKE_MAIL_WEBHOOK;
  if (!webhookUrl) {
    await markOutboxFailed(sbAdmin, outbox.id, 'MAKE_MAIL_WEBHOOK not configured');
    log('error', 'webhook_send_failed', { event_type: eventType, outbox_id: outbox.id, reason: 'missing_webhook_env' });
    return response(500, { error: 'MAKE_MAIL_WEBHOOK not configured', outbox_id: outbox.id });
  }

  let failureAlreadyMarked = false;
  try {
    const makeRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dispatch.payload)
    });

    if (!makeRes.ok) {
      const errMsg = `Make webhook failed: ${makeRes.status}`;
      await markOutboxFailed(sbAdmin, outbox.id, errMsg);
      failureAlreadyMarked = true;
      log('error', 'webhook_send_failed', { event_type: eventType, outbox_id: outbox.id, status: makeRes.status });
      return response(500, { error: errMsg, outbox_id: outbox.id });
    }

    await markOutboxSent(sbAdmin, outbox.id);
    log('info', 'webhook_send_succeeded', { event_type: eventType, outbox_id: outbox.id });

    return response(200, {
      success: true,
      event_type: eventType,
      outbox_id: outbox.id,
      data: dispatch.responseData
    });
  } catch (err) {
    const msg = err && err.message ? err.message : 'Webhook request failed';
    if (!failureAlreadyMarked) {
      await markOutboxFailed(sbAdmin, outbox.id, msg);
    }
    log('error', 'webhook_send_failed', { event_type: eventType, outbox_id: outbox.id, error: msg });
    return response(500, { error: 'Webhook konnte nicht erreicht werden.', details: msg, outbox_id: outbox.id });
  }
};
