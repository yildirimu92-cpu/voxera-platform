'use strict';

const { createClient } = require('@supabase/supabase-js');
const { createOutboxEvent, markOutboxSent, markOutboxFailed } = require('./_lib/webhook-outbox');
const { normalizePlanCode, loadPlanByCode } = require('./_lib/plan-config');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function addHoursIso(baseDate, hours) {
  const next = new Date(baseDate.getTime());
  next.setTime(next.getTime() + (hours * 60 * 60 * 1000));
  return next.toISOString();
}

function intEnv(name, fallback) {
  const raw = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function computeCurrentPeriodStart(subscription, nowDate) {
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
    .select('duration_seconds, created_at')
    .eq('customer_id', customerId)
    .gte('created_at', periodStartIso);

  if (error) {
    return {
      ok: false,
      error: error.message || 'usage query failed'
    };
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

async function sendBillingWebhook({ sbAdmin, customer, subscription, paymentLink, usageSummary }) {
  const eventType = 'billing_payment_link_email';
  const payload = {
    customer_id: customer.id,
    customer_name: customer.customer_name || customer.name || '',
    customer_email: customer.email,
    plan_code: normalizePlanCode(subscription.plan_code || customer.plan_code || customer.plan || ''),
    billing_cycle: subscription.billing_cycle,
    payment_link: paymentLink,
    renews_at: subscription.renews_at || null,
    usage_summary: usageSummary || null
  };

  let outbox;
  try {
    outbox = await createOutboxEvent(sbAdmin, {
      eventType,
      payload,
      payloadSummary: `${eventType}:${customer.id}:${subscription.billing_cycle}`
    });
  } catch (outboxErr) {
    const msg = outboxErr && outboxErr.message ? outboxErr.message : 'outbox insert failed';
    return { ok: false, statusCode: 500, error: `Outbox insert failed: ${msg}` };
  }

  const webhookUrl = process.env.MAKE_BILLING_WEBHOOK;
  if (!webhookUrl) {
    await markOutboxFailed(sbAdmin, outbox.id, 'MAKE_BILLING_WEBHOOK not configured');
    return { ok: false, statusCode: 500, error: 'MAKE_BILLING_WEBHOOK not configured', outboxId: outbox.id };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: payload.customer_name,
        email: payload.customer_email,
        customer_id: payload.customer_id,
        plan_code: payload.plan_code,
        billing_cycle: payload.billing_cycle,
        payment_link: payload.payment_link,
        renews_at: payload.renews_at,
        usage_summary: payload.usage_summary
      })
    });

    if (!res.ok) {
      const errMsg = `Webhook failed (HTTP ${res.status})`;
      await markOutboxFailed(sbAdmin, outbox.id, errMsg);
      return { ok: false, statusCode: 500, error: errMsg, outboxId: outbox.id };
    }

    await markOutboxSent(sbAdmin, outbox.id);
    return { ok: true, outboxId: outbox.id };
  } catch (err) {
    const errMsg = err && err.message ? err.message : 'Webhook request failed';
    await markOutboxFailed(sbAdmin, outbox.id, errMsg);
    return { ok: false, statusCode: 500, error: errMsg, outboxId: outbox.id };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (!['GET', 'POST'].includes(event.httpMethod)) return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbServiceKey) {
    return response(500, { error: 'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const now = new Date();
  const nowIso = now.toISOString();
  const reminderHours = intEnv('BILLING_REMINDER_HOURS', 72);

  const { data: dueSubscriptions, error: dueError } = await sbAdmin
    .from('subscriptions')
    .select('id, customer_id, plan_code, billing_cycle, subscription_status, renews_at, starts_at, last_billing_sent_at, payment_status, billing_state')
    .eq('subscription_status', 'active')
    .lte('renews_at', nowIso)
    .or('last_billing_sent_at.is.null,last_billing_sent_at.lt.renews_at')
    .order('renews_at', { ascending: true })
    .limit(200);

  if (dueError) return response(500, { error: 'Due subscriptions query failed', details: dueError.message });

  let processed = 0;
  let sent = 0;
  const skipped = [];
  const errors = [];

  for (const subscription of (dueSubscriptions || [])) {
    processed += 1;

    const { data: customer, error: customerError } = await sbAdmin
      .from('customers')
      .select('id, customer_name, name, email, plan_code, plan, payment_status')
      .eq('id', subscription.customer_id)
      .maybeSingle();

    if (customerError || !customer) {
      errors.push({ subscription_id: subscription.id, customer_id: subscription.customer_id, error: customerError ? customerError.message : 'customer not found' });
      continue;
    }

    const planCode = normalizePlanCode(subscription.plan_code || customer.plan_code || customer.plan);
    const { plan: planConfig, error: planError } = await loadPlanByCode(sbAdmin, planCode);
    if (planError || !planConfig) {
      errors.push({ subscription_id: subscription.id, customer_id: customer.id, error: planError ? planError.message : `plan config missing for ${planCode}` });
      continue;
    }

    const billingCycle = String(subscription.billing_cycle || 'monthly').trim().toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
    const linkField = billingCycle === 'yearly' ? 'yearly_payment_link' : 'monthly_payment_link';
    const paymentLink = String(planConfig[linkField] || '').trim();

    if (!paymentLink || !/^https?:\/\//i.test(paymentLink)) {
      skipped.push({ subscription_id: subscription.id, customer_id: customer.id, reason: `${linkField} missing or invalid` });
      continue;
    }

    const includedMinutes = Number(planConfig.minutes || 0);
    const extraRate = Number(planConfig.extra_rate || 0);
    const periodStart = computeCurrentPeriodStart(subscription, now);
    const usageResult = await loadUsageSummary(sbAdmin, {
      customerId: customer.id,
      periodStartIso: periodStart.toISOString(),
      includedMinutes,
      extraRate
    });
    const usageSummary = usageResult.ok ? usageResult.usage : null;

    const sendResult = await sendBillingWebhook({
      sbAdmin,
      customer,
      subscription,
      paymentLink,
      usageSummary
    });

    if (!sendResult.ok) {
      errors.push({ subscription_id: subscription.id, customer_id: customer.id, error: sendResult.error, outbox_id: sendResult.outboxId || null });
      continue;
    }

    const nextReminderAt = addHoursIso(now, reminderHours);
    const subscriptionPatch = {
      payment_status: 'pending',
      billing_state: 'payment_link_sent',
      last_billing_sent_at: nowIso,
      next_reminder_at: nextReminderAt,
      last_billing_link: paymentLink,
      updated_at: nowIso
    };

    const { error: subUpdateError } = await sbAdmin
      .from('subscriptions')
      .update(subscriptionPatch)
      .eq('id', subscription.id);

    if (subUpdateError) {
      errors.push({ subscription_id: subscription.id, customer_id: customer.id, error: subUpdateError.message });
      continue;
    }

    const { error: customerUpdateError } = await sbAdmin
      .from('customers')
      .update({ payment_status: 'pending', updated_at: nowIso })
      .eq('id', customer.id);

    if (customerUpdateError) {
      errors.push({ subscription_id: subscription.id, customer_id: customer.id, error: customerUpdateError.message });
      continue;
    }

    sent += 1;
  }

  return response(200, {
    success: true,
    processed,
    sent,
    skipped,
    errors,
    due_count: Array.isArray(dueSubscriptions) ? dueSubscriptions.length : 0,
    ran_at: nowIso
  });
};
