const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { createOutboxEvent, markOutboxSent, markOutboxFailed } = require('./_lib/webhook-outbox');
const { STATUS, normalizeCustomerStatus, normalizeOnboardingStatus } = require('./_lib/status-model');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const REQUIRED_FIELDS = ['customer_name', 'email', 'street', 'zip', 'city', 'country', 'plan'];

function response(statusCode, payload) {
  return { statusCode, headers: corsHeaders, body: JSON.stringify(payload) };
}

function resolveDuplicateReason(customerRow) {
  const inviteStatus = String(customerRow?.invite_status || '').trim().toLowerCase();
  const welcomeSent = Boolean(customerRow?.welcome_sent);
  const customerStatus = normalizeCustomerStatus(customerRow?.status);

  if (inviteStatus === 'sending') return 'in_progress';
  if (welcomeSent || inviteStatus === STATUS.access.SENT || inviteStatus === STATUS.access.ACTIVATED) return 'already_sent';
  if (customerStatus === STATUS.customer.ACTIVATED || customerStatus === STATUS.customer.LIVE) return 'already_processed';
  return 'retry_allowed';
}

async function sendViaWebhook({ sbAdmin, customer, activationLink, isPasswordReset = false }) {
  const eventType = isPasswordReset ? 'customer_password_reset_email' : 'customer_welcome_access_email';
  const payload = {
    customer_id: customer.id,
    customer_name: customer.customer_name,
    customer_email: customer.email,
    plan: customer.plan || null,
    voxera_number: customer.voxera_number || null,
    dashboard_url: process.env.DASHBOARD_URL || 'https://dashboard.voxera.ch',
    activation_link_present: Boolean(activationLink),
    mail_type: isPasswordReset ? 'password_reset' : 'welcome'
  };
  let outbox;
  try {
    outbox = await createOutboxEvent(sbAdmin, {
      eventType,
      payload,
      payloadSummary: `${eventType} -> ${customer.email}`
    });
  } catch (outboxErr) {
    const msg = outboxErr && outboxErr.message ? outboxErr.message : 'outbox insert failed';
    console.error(JSON.stringify({
      level: 'error',
      event: 'outbox_insert_failed',
      event_type: eventType,
      customer_id: customer.id,
      error_code: outboxErr && outboxErr.code ? outboxErr.code : null,
      error_message: outboxErr && outboxErr.message ? outboxErr.message : msg,
      error_details: outboxErr && outboxErr.details ? outboxErr.details : null,
      error_hint: outboxErr && outboxErr.hint ? outboxErr.hint : null
    }));
    return { ok: false, statusCode: 500, error: 'Webhook-Outbox konnte nicht gespeichert werden.', details: msg };
  }
  console.log(JSON.stringify({ level: 'info', event: 'webhook_send_attempt', event_type: eventType, outbox_id: outbox.id, customer_id: customer.id }));

  const webhookUrl = process.env.MAKE_WELCOME_WEBHOOK;
  if (!webhookUrl) {
    await markOutboxFailed(sbAdmin, outbox.id, 'MAKE_WELCOME_WEBHOOK ist nicht gesetzt.');
    console.error(JSON.stringify({ level: 'error', event: 'webhook_send_failed', event_type: eventType, outbox_id: outbox.id, reason: 'missing_webhook_env' }));
    return {
      ok: false,
      statusCode: 500,
      error: 'MAKE_WELCOME_WEBHOOK ist nicht gesetzt.',
      limitation: 'Link wurde erstellt, aber kein E-Mail ausgelöst.',
      outbox_id: outbox.id
    };
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: customer.customer_name,
        email: customer.email,
        activation_link: activationLink,
        plan: customer.plan,
        voxera_number: customer.voxera_number || null,
        customer_id: customer.id,
        dashboard_url: process.env.DASHBOARD_URL || 'https://dashboard.voxera.ch',
        // Make kann damit unterscheiden ob Welcome- oder Passwort-Reset-Mail
        mail_type: isPasswordReset ? 'password_reset' : 'welcome',
        ai_business_description: customer.ai_business_description || null,
        ai_instructions: customer.ai_instructions || null
      })
    });
    if (!res.ok) {
      const errMsg = `Webhook fehlgeschlagen (HTTP ${res.status}).`;
      await markOutboxFailed(sbAdmin, outbox.id, errMsg);
      console.error(JSON.stringify({ level: 'error', event: 'webhook_send_failed', event_type: eventType, outbox_id: outbox.id, status: res.status }));
      return { ok: false, statusCode: 500, error: errMsg, outbox_id: outbox.id };
    }
    await markOutboxSent(sbAdmin, outbox.id);
    console.log(JSON.stringify({ level: 'info', event: 'webhook_send_succeeded', event_type: eventType, outbox_id: outbox.id }));
    return { ok: true };
  } catch (err) {
    const msg = err && err.message ? err.message : 'Webhook konnte nicht erreicht werden.';
    await markOutboxFailed(sbAdmin, outbox.id, msg);
    console.error(JSON.stringify({ level: 'error', event: 'webhook_send_failed', event_type: eventType, outbox_id: outbox.id, error: msg }));
    return { ok: false, statusCode: 500, error: 'Webhook konnte nicht erreicht werden.', details: msg, outbox_id: outbox.id };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!sbUrl || !sbServiceKey || !sbAnonKey) {
    console.error('Missing Supabase env vars');
    return response(500, { error: 'Supabase-Konfiguration fehlt auf dem Server.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Admin-Authentifizierung
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: 'Ungültiger Request Body.' });
  }

  const customerId = String(body.customer_id || '').trim();
  if (!customerId) return response(400, { error: 'customer_id fehlt.' });

  // action: 'send_access' (Standard) | 'reset_password' | 'mark_activated'
  const action = String(body.action || 'send_access').trim().toLowerCase();

  const idempotencyScope = `customer:${customerId}:action:${action}`;

  // Kunden laden
  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single();

  if (customerError || !customer) {
    return response(400, { error: 'Kunde nicht gefunden.' });
  }

  const { data: onboardingRow } = await sbAdmin
    .from('onboarding')
    .select('id, status, progress')
    .eq('customer_id', customerId)
    .maybeSingle();

  // ─── ACTION: mark_activated ───────────────────────────────────────────────
  if (action === 'mark_activated') {
    const nowIso = new Date().toISOString();
    const { data: updated, error: updateErr } = await sbAdmin
      .from('customers')
      .update({ status: 'activated', invite_status: 'activated', updated_at: nowIso })
      .eq('id', customerId)
      .select('*')
      .single();

    if (updateErr) return response(500, { error: 'Status konnte nicht gesetzt werden.', details: updateErr.message });
    return response(200, { success: true, message: 'Kunde auf aktiviert gesetzt.', customer: updated });
  }

  // ─── Pflichtfelder prüfen (für send_access + reset_password) ─────────────
  const missingFields = REQUIRED_FIELDS.filter(f => {
    if (f === 'customer_name') return !String(customer.customer_name || customer.name || '').trim();
    return !String(customer[f] || '').trim();
  });

  if (missingFields.length > 0) {
    return response(400, {
      error: 'Pflichtdaten fehlen.',
      missing_fields: missingFields
    });
  }

  // ─── ACTION: reset_password ───────────────────────────────────────────────
  // Schickt einen Passwort-Reset-Link an den Kunden (manuell ausgelöst durch Admin)
  if (action === 'reset_password') {
    const redirectUrl = process.env.DASHBOARD_URL || 'https://dashboard.voxera.ch';
    const { data: linkData, error: linkErr } = await sbAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: customer.email,
      options: { redirectTo: redirectUrl }
    });

    const resetLink = linkData?.properties?.action_link;
    if (linkErr || !resetLink) {
      console.error('Reset link generation failed', linkErr);
      return response(500, { error: 'Passwort-Reset-Link konnte nicht erstellt werden.', details: linkErr?.message });
    }

    const delivery = await sendViaWebhook({ sbAdmin, customer, activationLink: resetLink, isPasswordReset: true });
    if (!delivery.ok) return response(delivery.statusCode || 500, {
      error: delivery.error,
      details: delivery.details || null,
      outbox_id: delivery.outbox_id || null
    });

    return response(200, {
      success: true,
      message: `Passwort-Reset-Link wurde an ${customer.email} gesendet.`
    });
  }

  // ─── ACTION: send_access (Standard-Welcome-Mail) ──────────────────────────
  const normalizedCustomerStatus = normalizeCustomerStatus(customer.status);
  const normalizedOnboardingStatus = normalizeOnboardingStatus(onboardingRow?.status);
  const paymentStatus = String(customer.payment_status || 'none').trim().toLowerCase();
  const assistantReady = Boolean(
    String(customer.ai_business_description || '').trim() ||
    String(customer.ai_instructions || '').trim()
  );

  // Log AI readiness but do NOT block – frontend already guards this
  console.info(JSON.stringify({
    level: 'info',
    event: 'send_customer_access_ai_check',
    idempotency_scope: idempotencyScope,
    customer_id: customerId,
    assistant_ready: assistantReady,
    customer_status: normalizedCustomerStatus
  }));

  if (customer.welcome_sent || customer.invite_status === STATUS.access.SENT || customer.invite_status === STATUS.access.ACTIVATED) {
    console.info(JSON.stringify({
      level: 'info',
      event: 'send_customer_access_duplicate_ignored',
      reason: 'already_sent',
      idempotency_scope: idempotencyScope,
      customer_id: customerId,
      invite_status: customer.invite_status
    }));
    return response(200, {
      success: true,
      duplicate: true,
      reason: 'already_sent',
      message: 'Zugang wurde bereits versendet. Kein weiterer Versand ausgelöst.',
      customer
    });
  }

  if (paymentStatus !== 'paid') {
    return response(409, {
      error: 'Setup Fee ist noch nicht als bezahlt markiert. Zugang darf erst nach Zahlung versendet werden.',
      payment_status: paymentStatus,
      customer_status: normalizedCustomerStatus
    });
  }

  // Idempotenz-Claim: Nur ein Request darf gleichzeitig den Versand auslösen.
  console.info(JSON.stringify({
    level: 'info',
    event: 'send_customer_access_claim_attempt',
    idempotency_scope: idempotencyScope,
    customer_id: customerId,
    customer_status_raw: customer.status ?? null,
    customer_status_normalized: normalizeCustomerStatus(customer.status),
    invite_status_raw: customer.invite_status ?? null,
    welcome_sent: Boolean(customer.welcome_sent)
  }));

  // Fetch fresh state just before claim to avoid stale reads
  const { data: freshCustomer } = await sbAdmin
    .from('customers')
    .select('id, status, invite_status, welcome_sent')
    .eq('id', customerId)
    .single();

  const freshInviteStatus = String(freshCustomer?.invite_status || '').trim().toLowerCase();
  const freshStatus = String(freshCustomer?.status || '').trim().toLowerCase();
  const claimableStatuses = [String(STATUS.customer.ONBOARDING).toLowerCase(), 'pending', 'onboarding'];
  const claimableInviteStatuses = ['not_sent', 'null', '', 'undefined'];

  // Guard: skip claim if already sent/sending
  if (freshCustomer?.welcome_sent || freshInviteStatus === 'sent' || freshInviteStatus === 'sending' || freshInviteStatus === 'activated') {
    return response(200, {
      success: true,
      duplicate: true,
      reason: 'already_sent',
      message: 'Zugang wurde bereits versendet.',
      customer: freshCustomer
    });
  }

  const claimTs = new Date().toISOString();

  // Use simple eq filters – no .or() to avoid PostgREST combination issues
  let claimQuery = sbAdmin
    .from('customers')
    .update({ invite_status: 'sending', updated_at: claimTs })
    .eq('id', customerId)
    .select('id');

  // Only add status filter if status is actually a claimable value
  if (claimableStatuses.includes(freshStatus)) {
    claimQuery = sbAdmin
      .from('customers')
      .update({ invite_status: 'sending', updated_at: claimTs })
      .eq('id', customerId)
      .in('status', [STATUS.customer.ONBOARDING, 'pending', 'onboarding'])
      .select('id');
  }

  const { data: claimRows, error: claimError } = await claimQuery;

  if (claimError) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'send_customer_access_claim_failed',
      reason: 'claim_update_error',
      idempotency_scope: idempotencyScope,
      customer_id: customerId,
      error_message: claimError.message || 'unknown error',
      error_code: claimError.code || null
    }));
    return response(500, { error: 'Idempotenz-Claim fehlgeschlagen.', details: claimError.message });
  }

  if (!Array.isArray(claimRows) || claimRows.length === 0) {
    const { data: latestCustomer } = await sbAdmin
      .from('customers')
      .select('id, status, invite_status, welcome_sent, welcome_sent_at')
      .eq('id', customerId)
      .single();

    console.warn(JSON.stringify({
      level: 'warn',
      event: 'send_customer_access_claim_miss_state',
      idempotency_scope: idempotencyScope,
      customer_id: customerId,
      latest_customer_status_raw: latestCustomer?.status ?? null,
      latest_customer_status_normalized: normalizeCustomerStatus(latestCustomer?.status),
      latest_invite_status_raw: latestCustomer?.invite_status ?? null,
      latest_welcome_sent: Boolean(latestCustomer?.welcome_sent)
    }));

    const duplicateReason = resolveDuplicateReason(latestCustomer || customer);
    if (duplicateReason === 'retry_allowed') {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'send_customer_access_claim_retry',
        reason: 'claim_lost_without_final_state',
        idempotency_scope: idempotencyScope,
        customer_id: customerId,
        invite_status: latestCustomer?.invite_status || null,
        welcome_sent: Boolean(latestCustomer?.welcome_sent),
        customer_status: normalizeCustomerStatus(latestCustomer?.status)
      }));

      return response(409, {
        error: 'Versand konnte nicht exklusiv gestartet werden. Bitte erneut versuchen.',
        duplicate: false,
        reason: 'claim_retry_required',
        customer: latestCustomer || customer
      });
    }

    console.info(JSON.stringify({
      level: 'info',
      event: 'send_customer_access_duplicate_ignored',
      reason: duplicateReason,
      idempotency_scope: idempotencyScope,
      customer_id: customerId,
      invite_status: latestCustomer?.invite_status || null,
      welcome_sent: Boolean(latestCustomer?.welcome_sent)
    }));
    return response(200, {
      success: true,
      duplicate: true,
      reason: duplicateReason,
      message: duplicateReason === 'in_progress'
        ? 'Zugang wird bereits versendet. Kein zweiter Versand ausgelöst.'
        : duplicateReason === 'already_sent'
          ? 'Zugang wurde bereits versendet. Kein weiterer Versand ausgelöst.'
          : 'Zugang wurde bereits verarbeitet. Kein weiterer Versand ausgelöst.',
      customer: latestCustomer || customer
    });
  }

  const activateUrl = process.env.ACTIVATE_URL || 'https://dashboard.voxera.ch';
  const { data: linkData, error: linkErr } = await sbAdmin.auth.admin.generateLink({
    type: 'recovery',
    email: customer.email,
    options: { redirectTo: activateUrl }
  });

  const activationLink = linkData?.properties?.action_link;
  if (linkErr || !activationLink) {
    console.error('Activation link generation failed', linkErr);
    return response(500, { error: 'Aktivierungslink konnte nicht erstellt werden.', details: linkErr?.message });
  }

  const delivery = await sendViaWebhook({ sbAdmin, customer, activationLink });
  if (!delivery.ok) {
    await sbAdmin
      .from('customers')
      .update({ invite_status: 'not_sent', updated_at: new Date().toISOString() })
      .eq('id', customerId)
      .eq('invite_status', 'sending');

    return response(delivery.statusCode || 500, {
      error: delivery.error,
      details: delivery.details || null,
      limitation: delivery.limitation || null,
      outbox_id: delivery.outbox_id || null
    });
  }

  // Kundenstatus nach Versand aktualisieren
  const nowIso = new Date().toISOString();
  const { data: updatedCustomer, error: updateErr } = await sbAdmin
    .from('customers')
    .update({
      invite_status: 'sent',
      welcome_sent: true,
      welcome_sent_at: nowIso,
      status: 'invited',
      updated_at: nowIso
    })
    .eq('id', customerId)
    .eq('invite_status', 'sending')
    .select('*')
    .single();

  if (updateErr) {
    console.error('Customer update after send failed', updateErr);
    // Nicht fatal – E-Mail wurde bereits gesendet
  }

  // Onboarding-Progress aktualisieren falls vorhanden
  const { data: onboardingProgressRow } = await sbAdmin
    .from('onboarding')
    .select('id, progress')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (onboardingProgressRow?.id) {
    const nextProgress = Math.min(90, Math.max(Number(onboardingProgressRow.progress || 0), Number(onboardingProgressRow.progress || 0) + 10));
    await sbAdmin
      .from('onboarding')
      .update({ next_step: 'Kunde aktiviert Zugang', progress: nextProgress, updated_at: nowIso })
      .eq('id', onboardingProgressRow.id);
  }

  return response(200, {
    success: true,
    message: 'Zugangsdaten wurden versendet.',
    customer: updatedCustomer || customer
  });
};
