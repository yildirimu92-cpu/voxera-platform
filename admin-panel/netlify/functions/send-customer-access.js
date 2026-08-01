const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { createOutboxEvent, markOutboxSent, markOutboxFailed } = require('./_lib/webhook-outbox');
const { STATUS, normalizeCustomerStatus, normalizeOnboardingStatus } = require('./_lib/status-model');
const { normalizePlanCode } = require('./_lib/plan-config');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const REQUIRED_FIELDS = ['customer_name', 'email', 'street', 'zip', 'city', 'country', 'plan'];
const ACCESS_INVITE_REQUIRED_FIELDS = ['email'];
const AI_REQUIRED_FIELDS = ['ai_business_description', 'ai_services', 'ai_instructions', 'ai_fallback_escalation'];
const ACCESS_ENABLED_CONTRACT_STATUSES = new Set(['active', 'signed']);
const ACCESS_INVITE_CUSTOMER_STATUSES = new Set([STATUS.customer.ONBOARDING, STATUS.customer.READY]);

function response(statusCode, payload) {
  return { statusCode, headers: corsHeaders, body: JSON.stringify(payload) };
}

function hasAssistantBasics(customer) {
  return AI_REQUIRED_FIELDS.every((field) => String(customer?.[field] || '').trim());
}

function hasAssignedNumber(customer) {
  const value = String(customer?.voxera_number || '').trim();
  return Boolean(value && !/zuweisung offen|pending|nicht zugewiesen/i.test(value));
}

function missingRequiredCustomerFields(customer) {
  return REQUIRED_FIELDS.filter((field) => {
    if (field === 'customer_name') return !String(customer?.customer_name || customer?.name || '').trim();
    if (field === 'plan') return !normalizePlanCode(customer?.plan_code || customer?.plan || '');
    return !String(customer?.[field] || '').trim();
  });
}

function missingAccessInviteFields(customer) {
  return ACCESS_INVITE_REQUIRED_FIELDS.filter((field) => !String(customer?.[field] || '').trim());
}

async function findAuthUserByEmail(sbAdmin, email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;

  let page = 1;
  const perPage = 200;
  while (page <= 50) {
    const { data, error } = await sbAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = Array.isArray(data?.users) ? data.users : [];
    const match = users.find((u) => String(u?.email || '').trim().toLowerCase() === target);
    if (match) return match;
    if (users.length < perPage) break;
    page += 1;
  }
  return null;
}

async function ensureAuthAndUserMapping({ sbAdmin, customer }) {
  const email = String(customer?.email || '').trim().toLowerCase();
  if (!email) {
    return { ok: false, statusCode: 400, error: 'Kunden-E-Mail fehlt.' };
  }

  let authUser = null;
  const customerAuthUserId = String(customer?.auth_user_id || '').trim();

  if (customerAuthUserId) {
    const { data: authById, error: authByIdErr } = await sbAdmin.auth.admin.getUserById(customerAuthUserId);
    if (!authByIdErr && authById?.user) {
      authUser = authById.user;
    } else {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'send_customer_access_auth_user_id_not_found',
        customer_id: customer.id,
        auth_user_id: customerAuthUserId,
        error_message: authByIdErr?.message || null
      }));
    }
  }

  if (!authUser) {
    authUser = await findAuthUserByEmail(sbAdmin, email);
  }

  let authResolution = 'existing';
  if (!authUser) {
    const { data: createdAuth, error: createAuthErr } = await sbAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        customer_id: customer.id,
        customer_name: customer.customer_name || null,
        role: 'customer'
      }
    });
    if (createAuthErr) {
      return {
        ok: false,
        statusCode: 500,
        error: 'Auth-Konto konnte nicht erstellt werden.',
        details: createAuthErr.message
      };
    }
    authUser = createdAuth?.user || null;
    authResolution = 'created';
  }

  if (!authUser?.id) {
    return { ok: false, statusCode: 500, error: 'Auth-User konnte nicht aufgelöst werden.' };
  }

  const authUserId = authUser.id;
  const nowIso = new Date().toISOString();

  if (customerAuthUserId !== authUserId) {
    const { error: customerLinkErr } = await sbAdmin
      .from('customers')
      .update({ auth_user_id: authUserId, updated_at: nowIso })
      .eq('id', customer.id);
    if (customerLinkErr) {
      return {
        ok: false,
        statusCode: 500,
        error: 'Kunden-Auth-Verknüpfung konnte nicht aktualisiert werden.',
        details: customerLinkErr.message
      };
    }
  }

  const normalizedEmail = String(authUser.email || email).trim().toLowerCase();
  const usersPayload = {
    id: authUserId,
    email: normalizedEmail,
    customer_id: customer.id,
    role: 'customer',
    is_admin: false,
    created_at: nowIso
  };
  const { error: usersUpsertErr } = await sbAdmin
    .from('users')
    .upsert(usersPayload, { onConflict: 'id' });
  if (usersUpsertErr) {
    return {
      ok: false,
      statusCode: 500,
      error: 'users-Profil konnte nicht sichergestellt werden.',
      details: usersUpsertErr.message
    };
  }

  return {
    ok: true,
    authUserId,
    authResolution
  };
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

async function resolveContractGate(sbAdmin, customerId) {
  const [contractsResult, offersResult] = await Promise.all([
    sbAdmin
      .from('contracts')
      .select('id, status, updated_at')
      .eq('customer_id', customerId)
      .order('updated_at', { ascending: false })
      .limit(50),
    sbAdmin
      .from('offers')
      .select('id, status, accepted_at, contract_id, updated_at')
      .eq('customer_id', customerId)
      .order('updated_at', { ascending: false })
      .limit(50)
  ]);

  if (contractsResult.error) {
    return { ok: false, statusCode: 500, payload: { error: 'Contract lookup failed', details: contractsResult.error.message } };
  }
  if (offersResult.error) {
    return { ok: false, statusCode: 500, payload: { error: 'Offer lookup failed', details: offersResult.error.message } };
  }

  const contracts = Array.isArray(contractsResult.data) ? contractsResult.data : [];
  const offers = Array.isArray(offersResult.data) ? offersResult.data : [];
  const activeContracts = contracts.filter((contract) =>
    ACCESS_ENABLED_CONTRACT_STATUSES.has(String(contract?.status || '').trim().toLowerCase())
  );
  const acceptedOffers = offers.filter((offer) => {
    const status = String(offer?.status || '').trim().toLowerCase();
    return status === 'accepted' || Boolean(offer?.accepted_at);
  });
  const linkedOffer = acceptedOffers.find((offer) =>
    activeContracts.some((contract) => String(contract.id) === String(offer.contract_id || ''))
  ) || null;

  const hardBlockers = [];
  if (!acceptedOffers.length) hardBlockers.push('Keine akzeptierte Offerte vorhanden.');
  if (!activeContracts.length) hardBlockers.push('Kein startbereiter Vertrag vorhanden (active/signed).');
  if (acceptedOffers.length && activeContracts.length && !linkedOffer) {
    hardBlockers.push('Akzeptierte Offerte ist nicht mit einem startbereiten Vertrag verknüpft.');
  }

  return {
    ok: hardBlockers.length === 0,
    statusCode: hardBlockers.length ? 409 : 200,
    payload: {
      error: hardBlockers.length ? 'Commercial→Access Gate ist nicht erfüllt.' : null,
      hard_blockers: hardBlockers,
      warnings: []
    },
    contractId: linkedOffer ? String(linkedOffer.contract_id || '') : '',
    contracts,
    acceptedOffers,
    linkedOffer
  };
}

async function buildCommercialAccessGate({ sbAdmin, customer, customerId, onboardingRow }) {
  const hardBlockers = [];
  const warnings = [];
  const missingFields = missingAccessInviteFields(customer);
  const missingSetupFields = missingRequiredCustomerFields(customer).filter((field) => !missingFields.includes(field));

  if (missingFields.length) {
    hardBlockers.push(`Für den Zugangsversand fehlt: ${missingFields.join(', ')}`);
  }
  if (missingSetupFields.length) {
    warnings.push(`Setup-Stammdaten noch offen: ${missingSetupFields.join(', ')}`);
  }

  const contractGate = await resolveContractGate(sbAdmin, customerId);
  if (!contractGate.ok) {
    warnings.push(...(contractGate.payload?.hard_blockers || []));
  }

  const customerStatus = normalizeCustomerStatus(customer.status);
  if (!ACCESS_INVITE_CUSTOMER_STATUSES.has(customerStatus)) {
    hardBlockers.push(`Zugang kann im Kundenstatus „${customerStatus || 'unklar'}“ nicht erstmalig gesendet werden.`);
  } else if (customerStatus === STATUS.customer.ONBOARDING) {
    warnings.push('Einrichtung läuft noch. Der Portalzugang kann bereits gesendet werden.');
  }

  if (!customer.go_live_approved_at || !customer.go_live_approved_by) {
    warnings.push('Admin-Freigabe für den späteren Go-live fehlt noch.');
  }

  if (!onboardingRow) {
    warnings.push('Onboarding-Datensatz fehlt noch.');
  } else {
    const onboardingStatus = normalizeOnboardingStatus(onboardingRow.status);
    if (onboardingStatus === STATUS.onboarding.BLOCKED) {
      warnings.push('Onboarding ist derzeit blockiert; der Portalzugang darf trotzdem gesendet werden.');
    } else if (onboardingStatus !== STATUS.onboarding.READY && onboardingStatus !== STATUS.onboarding.COMPLETED) {
      warnings.push(`Onboarding ist noch nicht bereit (aktuell: ${onboardingStatus}).`);
    }
  }

  if (!hasAssignedNumber(customer)) warnings.push('Voxera-Rufnummer ist noch nicht zugewiesen.');
  if (!String(customer.elevenlabs_agent_id || '').trim()) warnings.push('ElevenLabs Agent-ID fehlt noch.');
  if (!hasAssistantBasics(customer)) {
    const missingAi = AI_REQUIRED_FIELDS.filter((field) => !String(customer?.[field] || '').trim());
    warnings.push(`AI-Konfiguration noch offen: ${missingAi.join(', ')}`);
  }

  const setupFeeState = await loadSetupFeeState(sbAdmin, customerId);
  if (setupFeeState.message) warnings.push(setupFeeState.message);

  return {
    allow: hardBlockers.length === 0,
    hard_blockers: hardBlockers,
    warnings: [...new Set(warnings.filter(Boolean))],
    missing_fields: missingFields,
    setup_fee_state: setupFeeState,
    contract_gate: contractGate
  };
}

async function loadSetupFeeState(sbAdmin, customerId) {
  const { data, error } = await sbAdmin
    .from('invoices')
    .select('id, status, invoice_type, due_at, paid_at')
    .eq('customer_id', customerId);
  if (error) {
    return {
      warningOnly: true,
      hasAnySetupFee: false,
      hasUnpaidSetupFee: false,
      message: 'Setup-Fee-Status konnte nicht geladen werden. Der Zugangsversand bleibt trotzdem erlaubt.',
      diagnostics: { db_message: error.message || null, db_code: error.code || null }
    };
  }
  const rows = Array.isArray(data) ? data : [];
  const setupRows = rows.filter((row) => String(row.invoice_type || '').toLowerCase().includes('setup'));
  const hasAnySetupFee = setupRows.length > 0;
  const hasUnpaidSetupFee = setupRows.some((row) => String(row.status || '').toLowerCase() !== 'paid');
  return {
    warningOnly: hasUnpaidSetupFee || !hasAnySetupFee,
    hasAnySetupFee,
    hasUnpaidSetupFee,
    message: hasUnpaidSetupFee
      ? 'Warnung: Setup-Fee-Rechnung ist noch offen. Der Zugangsversand bleibt erlaubt.'
      : (!hasAnySetupFee ? 'Warnung: Keine Setup-Fee-Rechnung gefunden. Der Zugangsversand bleibt erlaubt.' : null),
    diagnostics: null
  };
}

async function sendViaWebhook({ sbAdmin, customer, activationLink, isPasswordReset = false }) {
  const customerPlanCode = normalizePlanCode(customer.plan_code || customer.plan || '');
  const eventType = isPasswordReset ? 'customer_password_reset_email' : 'customer_welcome_access_email';
  const payload = {
    customer_id: customer.id,
    customer_name: customer.customer_name,
    customer_email: customer.email,
    plan: customerPlanCode || null,
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
        plan: customerPlanCode || null,
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
    const currentStatus = normalizeCustomerStatus(customer.status);
    if ([STATUS.customer.ACTIVATED, STATUS.customer.LIVE].includes(currentStatus)) {
      return response(200, {
        success: true,
        duplicate: true,
        message: 'Kundenzugang ist bereits aktiviert.',
        customer
      });
    }
    if (!customer.go_live_approved_at || !customer.go_live_approved_by) {
      return response(409, { error: 'Dokumentierte Admin-Freigabe fehlt.' });
    }
    if (currentStatus !== STATUS.customer.INVITED || !customer.welcome_sent || customer.invite_status !== STATUS.access.SENT) {
      return response(409, {
        error: 'Der versendete Kundenzugang muss zuerst aktiviert werden.',
        customer_status: currentStatus,
        invite_status: customer.invite_status || null,
        welcome_sent: Boolean(customer.welcome_sent)
      });
    }

    const contractGate = await resolveContractGate(sbAdmin, customerId);
    if (!contractGate.ok) return response(contractGate.statusCode, contractGate.payload);
    const setupFeeState = await loadSetupFeeState(sbAdmin, customerId);
    const nowIso = new Date().toISOString();
    const { data: updatedCustomer, error: updateErr } = await sbAdmin
      .from('customers')
      .update({
        status: STATUS.customer.ACTIVATED,
        invite_status: STATUS.access.ACTIVATED,
        activated_at: customer.activated_at || nowIso,
        updated_at: nowIso
      })
      .eq('id', customerId)
      .eq('status', STATUS.customer.INVITED)
      .eq('invite_status', STATUS.access.SENT)
      .select('*')
      .single();

    if (updateErr) {
      return response(409, {
        error: 'Aktivierung konnte nicht exklusiv gespeichert werden. Bitte Status neu laden.',
        details: updateErr.message
      });
    }

    return response(200, {
      success: true,
      message: 'Kundenzugang aktiviert. Go-live bleibt ein separater Admin-Schritt.',
      warning: setupFeeState.message || null,
      setup_fee_state: setupFeeState,
      customer: updatedCustomer,
      lifecycle_separated: true
    });
  }

  // Passwort-Reset und Erstzugang benötigen nur eine erreichbare Kunden-E-Mail.
  // Einrichtung und Go-live-Readiness werden separat geprüft und blockieren die Einladung nicht.
  const missingFields = String(customer.email || '').trim() ? [] : ['email'];

  if (missingFields.length > 0) {
    return response(400, {
      error: 'Pflichtdaten fehlen.',
      missing_fields: missingFields
    });
  }

  // ─── ACTION: reset_password ───────────────────────────────────────────────
  // Schickt einen Passwort-Reset-Link an den Kunden (manuell ausgelöst durch Admin)
  if (action === 'reset_password') {
    const authProvision = await ensureAuthAndUserMapping({ sbAdmin, customer });
    if (!authProvision.ok) {
      return response(authProvision.statusCode || 500, {
        error: authProvision.error,
        details: authProvision.details || null
      });
    }

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
      message: `Passwort-Reset-Link wurde an ${customer.email} gesendet.`,
      auth_user_id: authProvision.authUserId,
      auth_resolution: authProvision.authResolution
    });
  }

  // ─── ACTION: send_access (Standard-Welcome-Mail) ──────────────────────────
  const normalizedCustomerStatus = normalizeCustomerStatus(customer.status);
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

  const gate = await buildCommercialAccessGate({ sbAdmin, customer, customerId, onboardingRow });
  if (!gate.allow) {
    return response(409, {
      error: 'Commercial→Access Gate blockiert den Versand.',
      hard_blockers: gate.hard_blockers,
      warnings: gate.warnings,
      missing_fields: gate.missing_fields
    });
  }

  console.info(JSON.stringify({
    level: 'info',
    event: 'send_customer_access_gate_passed',
    idempotency_scope: idempotencyScope,
    customer_id: customerId,
    assistant_ready: hasAssistantBasics(customer),
    customer_status: normalizedCustomerStatus,
    admin_approved: Boolean(customer.go_live_approved_at && customer.go_live_approved_by)
  }));

  const setupFeeState = gate.setup_fee_state || await loadSetupFeeState(sbAdmin, customerId);
  if (setupFeeState.warningOnly) {
    console.info(JSON.stringify({
      level: 'warn',
      event: 'send_customer_access_payment_warning_only',
      idempotency_scope: idempotencyScope,
      customer_id: customerId,
      has_any_setup_fee: setupFeeState.hasAnySetupFee,
      has_unpaid_setup_fee: setupFeeState.hasUnpaidSetupFee,
      setup_fee_diag: setupFeeState.diagnostics || null
    }));
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

  // Fetch fresh state just before claim to avoid stale reads.
  const { data: freshCustomer, error: freshCustomerError } = await sbAdmin
    .from('customers')
    .select('id, status, invite_status, welcome_sent')
    .eq('id', customerId)
    .single();

  if (freshCustomerError || !freshCustomer) {
    return response(500, {
      error: 'Kundenstatus konnte vor dem Versand nicht erneut geladen werden.',
      details: freshCustomerError?.message || null
    });
  }

  const freshInviteStatus = String(freshCustomer.invite_status || '').trim().toLowerCase();
  const freshStatus = normalizeCustomerStatus(freshCustomer.status);

  if (freshCustomer.welcome_sent || freshInviteStatus === 'sent' || freshInviteStatus === 'sending' || freshInviteStatus === 'activated') {
    return response(200, {
      success: true,
      duplicate: true,
      reason: 'already_sent',
      message: 'Zugang wurde bereits versendet.',
      customer: freshCustomer
    });
  }
  if (!ACCESS_INVITE_CUSTOMER_STATUSES.has(freshStatus)) {
    return response(409, {
      error: 'Zugang kann in diesem Lifecycle-Status nicht erstmalig gesendet werden.',
      customer_status: freshStatus,
      allowed_statuses: [...ACCESS_INVITE_CUSTOMER_STATUSES]
    });
  }

  const claimTs = new Date().toISOString();
  let claimQuery = sbAdmin
    .from('customers')
    .update({ invite_status: 'sending', updated_at: claimTs })
    .eq('id', customerId)
    .eq('status', freshCustomer.status);

  claimQuery = freshCustomer.invite_status == null
    ? claimQuery.is('invite_status', null)
    : claimQuery.eq('invite_status', freshCustomer.invite_status);

  const { data: claimRows, error: claimError } = await claimQuery.select('id');

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
  const authProvision = await ensureAuthAndUserMapping({ sbAdmin, customer });
  if (!authProvision.ok) {
    await sbAdmin
      .from('customers')
      .update({ invite_status: 'not_sent', updated_at: new Date().toISOString() })
      .eq('id', customerId)
      .eq('invite_status', 'sending');
    return response(authProvision.statusCode || 500, {
      error: authProvision.error,
      details: authProvision.details || null
    });
  }

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
    warning: setupFeeState.message || null,
    warnings: gate.warnings || [],
    setup_fee_state: setupFeeState,
    auth_user_id: authProvision.authUserId,
    auth_resolution: authProvision.authResolution,
    customer: updatedCustomer || customer
  });
};
