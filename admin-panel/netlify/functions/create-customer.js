const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('node:crypto');
const { STATUS } = require('./_lib/status-model');
const { requireAdminCaller } = require('./_lib/require-admin');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function logEvent(level, eventName, payload = {}) {
  const base = { level, event: eventName, ts: new Date().toISOString() };
  if (level === 'error') {
    console.error(JSON.stringify({ ...base, ...payload }));
    return;
  }
  console.log(JSON.stringify({ ...base, ...payload }));
}

async function rollbackCreateCustomer({ sbAdmin, authUserId, customerId, onboardingId }) {
  const rollbackState = {
    onboarding_deleted: onboardingId ? false : null,
    customer_deleted: customerId ? false : null,
    auth_user_deleted: authUserId ? false : null
  };

  if (onboardingId) {
    const { error } = await sbAdmin.from('onboarding').delete().eq('id', onboardingId);
    rollbackState.onboarding_deleted = !error;
    if (error) {
      logEvent('error', 'create_customer_rollback_onboarding_failed', {
        onboarding_id: onboardingId,
        error_code: error.code || null,
        error_message: error.message || 'unknown error'
      });
    }
  }

  if (customerId) {
    const { error } = await sbAdmin.from('customers').delete().eq('id', customerId);
    rollbackState.customer_deleted = !error;
    if (error) {
      logEvent('error', 'create_customer_rollback_customer_failed', {
        customer_id: customerId,
        error_code: error.code || null,
        error_message: error.message || 'unknown error'
      });
    }
  }

  if (authUserId) {
    const { error } = await sbAdmin.auth.admin.deleteUser(authUserId);
    rollbackState.auth_user_deleted = !error;
    if (error) {
      logEvent('error', 'create_customer_rollback_auth_failed', {
        auth_user_id: authUserId,
        error_code: error.code || null,
        error_message: error.message || 'unknown error'
      });
    }
  }

  const rollbackApplied = Object.values(rollbackState).every(v => v === null || v === true);
  return { rollbackApplied, rollbackState };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
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

  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: 'Ungültiger Request Body.' });
  }

  const requiredFields = ['customer_name', 'email', 'tel_nr', 'street', 'zip', 'city', 'country', 'plan'];
  const missingFields = requiredFields.filter(f => !String(body[f] || '').trim());
  if (missingFields.length > 0) {
    return response(400, { error: 'Pflichtfelder fehlen', missing_fields: missingFields });
  }

  const email = String(body.email).trim().toLowerCase();

  // ─── Duplikat-Check in customers-Tabelle ─────────────────────────────────
  const { data: existingCustomer, error: existingErr } = await sbAdmin
    .from('customers')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existingErr) return response(500, { error: 'Duplikat-Prüfung fehlgeschlagen.', details: existingErr.message });
  if (existingCustomer) {
    return response(409, {
      error: 'Ein Kunde mit dieser E-Mail existiert bereits.',
      existing_customer_id: existingCustomer.id
    });
  }

  const nowIso = new Date().toISOString();
  const customerId = `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const onboardingId = randomUUID();

  // ─── Supabase Auth User anlegen ───────────────────────────────────────────
  // email_confirm: true → User ist sofort bestätigt, kein separater Confirm-Mail
  // Kein Passwort gesetzt → Kunde setzt es selbst via "Zugang senden"-Link
  const { data: authData, error: authError } = await sbAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      customer_id: customerId,
      customer_name: String(body.customer_name).trim(),
      role: 'customer'
    }
  });

  if (authError) {
    // Auth-User existiert evtl. schon (z.B. früherer fehlgeschlagener Versuch)
    if (authError.message?.toLowerCase().includes('already') || authError.status === 422) {
      return response(409, {
        error: 'Ein Supabase-Auth-Account mit dieser E-Mail existiert bereits. Bitte zuerst löschen.',
        details: authError.message
      });
    }
    logEvent('error', 'create_customer_auth_user_create_failed', {
      email,
      error_code: authError.code || null,
      error_message: authError.message || 'unknown error',
      error_status: authError.status || null
    });
    return response(500, { error: 'Auth-Konto konnte nicht angelegt werden.', details: authError.message });
  }

  const authUserId = authData.user.id;
  logEvent('info', 'create_customer_auth_user_created', { auth_user_id: authUserId, email });

  // ─── Customer-Tabellen-Eintrag ────────────────────────────────────────────
  const contactFirstName = body.contact_first_name ? String(body.contact_first_name).trim() : null;
  const contactLastName  = body.contact_last_name  ? String(body.contact_last_name).trim()  : null;
  const contactName = [contactFirstName, contactLastName].filter(Boolean).join(' ') || null;

  const customerPayload = {
    id: customerId,
    auth_user_id: authUserId,       // ← Verknüpfung zum Auth-User
    customer_name: String(body.customer_name).trim(),
    email,
    tel_nr: String(body.tel_nr).trim(),
    plan: String(body.plan).trim(),
    street: String(body.street).trim(),
    zip: String(body.zip).trim(),
    city: String(body.city).trim(),
    country: String(body.country).trim(),
    invite_status: STATUS.access.NOT_SENT,
    welcome_sent: false,
    status: STATUS.customer.ONBOARDING,
    forwarding_setup_completed: false,
    voxera_number: body.voxera_number ? String(body.voxera_number).trim() : null,
    dashboard_id: body.dashboard_id  ? String(body.dashboard_id).trim()  : null,
    notes: body.notes ? String(body.notes).trim() : null,
    contact_first_name: contactFirstName,
    contact_last_name:  contactLastName,
    contact_name: contactName,
    ...(body.start_date ? { start_date: body.start_date } : {}),
    created_at: nowIso,
    updated_at: nowIso
  };

  const { data: createdCustomer, error: customerError } = await sbAdmin
    .from('customers')
    .insert(customerPayload)
    .select('*')
    .single();

  if (customerError) {
    logEvent('error', 'create_customer_customer_insert_failed', {
      customer_id: customerId,
      auth_user_id: authUserId,
      email,
      error_code: customerError.code || null,
      error_message: customerError.message || 'unknown error'
    });
    const rollback = await rollbackCreateCustomer({ sbAdmin, authUserId });

    if (customerError.code === '23505') {
      return response(409, {
        error: 'Ein Kunde mit dieser E-Mail existiert bereits.',
        rollback_applied: rollback.rollbackApplied,
        rollback_state: rollback.rollbackState
      });
    }
    return response(500, {
      error: 'Kunden-Datensatz konnte nicht angelegt werden.',
      details: customerError.message,
      rollback_applied: rollback.rollbackApplied,
      rollback_state: rollback.rollbackState
    });
  }

  // ─── Onboarding-Eintrag ───────────────────────────────────────────────────
  const { data: createdOnboarding, error: onboardingError } = await sbAdmin
    .from('onboarding')
    .insert({
      id: onboardingId,
      customer_id: customerId,
      status: 'not_started',
      progress: 0,
      next_step: 'Zugang senden',
      blocker: null,
      owner: null,
      created_at: nowIso,
      updated_at: nowIso
    })
    .select('*')
    .single();

  if (onboardingError) {
    logEvent('error', 'create_customer_onboarding_insert_failed', {
      onboarding_id: onboardingId,
      customer_id: customerId,
      auth_user_id: authUserId,
      error_code: onboardingError.code || null,
      error_message: onboardingError.message || 'unknown error'
    });
    const rollback = await rollbackCreateCustomer({ sbAdmin, authUserId, customerId });

    return response(500, {
      error: 'Onboarding-Eintrag konnte nicht angelegt werden.',
      details: onboardingError.message,
      rollback_applied: rollback.rollbackApplied,
      rollback_state: rollback.rollbackState
    });
  }

  // ─── users-Tabellen-Eintrag anlegen ─────────────────────────────────────────
  // Das Dashboard liest users.customer_id um den Kunden zu identifizieren.
  // Ohne diesen Eintrag schlägt ensure_user_profile fehl und der User wird ausgeloggt.
  const { error: usersError } = await sbAdmin
    .from('users')
    .insert({
      id: authUserId,
      email,
      customer_id: customerId,
      role: 'customer',
      is_admin: false,
      created_at: nowIso
    });

  if (usersError) {
    logEvent('error', 'create_customer_users_insert_failed', {
      customer_id: customerId,
      onboarding_id: onboardingId,
      auth_user_id: authUserId,
      email,
      error_code: usersError.code || null,
      error_message: usersError.message || 'unknown error'
    });
    const rollback = await rollbackCreateCustomer({ sbAdmin, authUserId, customerId, onboardingId });
    return response(500, {
      error: 'users-Profil konnte nicht angelegt werden. Kunde wurde nicht erstellt.',
      details: usersError.message,
      rollback_applied: rollback.rollbackApplied,
      rollback_state: rollback.rollbackState
    });
  } else {
    logEvent('info', 'create_customer_users_insert_created', { auth_user_id: authUserId, customer_id: customerId });
  }

  logEvent('info', 'create_customer_succeeded', { customer_id: customerId, auth_user_id: authUserId, email });

  return response(200, {
    success: true,
    customer: createdCustomer,
    onboarding: createdOnboarding,
    auth_user_id: authUserId
  });
};
