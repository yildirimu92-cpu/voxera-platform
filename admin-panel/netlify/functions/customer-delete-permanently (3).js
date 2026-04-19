/**
 * customer-delete-permanently.js
 *
 * KANONISCHER Hard-Delete-Endpunkt für Kunden.
 *
 * Governance:
 *   - Nur Admins mit Rolle "owner" dürfen diesen Endpunkt aufrufen.
 *   - Alle anderen Admin-Rollen erhalten 403.
 *
 * Gelöschte Daten (in dieser Reihenfolge, wegen FK-Constraints):
 *   1.  contracts          (FK → customers)
 *   2.  customers.subscription_id → null setzen  (FK-Auflösung)
 *   3.  subscriptions      (FK → customers)
 *   4.  calls              (FK → customers)
 *   5.  cases              (FK → customers)
 *   6.  invoices           (FK → customers)
 *   7.  offers             (FK → customers)
 *   8.  onboarding         (FK → customers)
 *   9.  users              (public.users, FK → customers)
 *   10. customers          (Haupteintrag)
 *   11. auth.users         (Supabase Auth – immer zuletzt)
 *
 * FK-Map verifiziert via:
 *   SELECT tc.table_name FROM information_schema.table_constraints AS tc
 *   JOIN information_schema.constraint_column_usage AS ccu
 *     ON ccu.constraint_name = tc.constraint_name
 *   WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'customers';
 * Ergebnis: users, subscriptions, contracts, onboarding, cases, invoices, calls, offers
 *
 * Auth-User-Lookup (3-stufig, robust):
 *   Stufe 1: public.users.id WHERE customer_id = ?
 *   Stufe 2: customers.auth_user_id (Fallback für neuere Einträge)
 *   Stufe 3: auth.users via E-Mail-Match (letzter Fallback)
 *
 * DEPRECATION-HINWEIS:
 *   Dieser Endpunkt wird direkt aufgerufen. Das Frontend SOLL
 *   mittelfristig auf admin-mutate (action: "customers.delete")
 *   umgestellt werden. Bis dahin bleibt dieser Endpunkt aktiv
 *   und ist der einzig authoritative Delete-Pfad.
 *
 *   delete-customer.js ist deprecated und liefert 410 Gone.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const ALLOWED_ROLES = new Set(['owner']);

function response(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload),
  };
}

/**
 * Sucht die Supabase Auth-User-ID zu einer customer_id.
 * 3-stufiger Lookup – robust gegen fehlende Felder.
 *
 * @param {object} sbAdmin  - Supabase Admin Client (service role)
 * @param {string} customerId
 * @returns {string|null}   - Auth User UUID oder null
 */
async function resolveAuthUserId(sbAdmin, customerId) {
  // Stufe 1: public.users WHERE customer_id = ?
  const { data: userRow, error: userErr } = await sbAdmin
    .from('users')
    .select('id')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (userErr) {
    throw new Error('Auth-User-Lookup (Stufe 1) fehlgeschlagen: ' + userErr.message);
  }
  if (userRow?.id) return userRow.id;

  // Stufe 2: customers.auth_user_id
  const { data: custRow, error: custErr } = await sbAdmin
    .from('customers')
    .select('auth_user_id, email')
    .eq('id', customerId)
    .maybeSingle();

  if (custErr) {
    throw new Error('Auth-User-Lookup (Stufe 2) fehlgeschlagen: ' + custErr.message);
  }
  if (custRow?.auth_user_id) return custRow.auth_user_id;

  // Stufe 3: E-Mail-Match in auth.users (paginiert, max. 10 Seiten à 200)
  if (custRow?.email) {
    const normalizedEmail = custRow.email.toLowerCase().trim();
    let page = 1;
    const perPage = 200;

    while (page <= 10) {
      const { data: listData, error: listErr } = await sbAdmin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (listErr) {
        throw new Error('Auth-User-Lookup (Stufe 3) fehlgeschlagen: ' + listErr.message);
      }
      const users = Array.isArray(listData?.users) ? listData.users : [];
      const match = users.find(
        (u) => String(u?.email || '').toLowerCase().trim() === normalizedEmail
      );
      if (match?.id) return match.id;
      if (users.length < perPage) break;
      page++;
    }
  }

  return null; // Kein Auth-User gefunden – kein Fehler, wird übersprungen
}

/**
 * Löscht einen Kunden vollständig und permanent.
 * Wird sowohl direkt (HTTP) als auch intern (admin-mutate) aufgerufen.
 *
 * @param {object} sbAdmin    - Supabase Admin Client (service role)
 * @param {string} customerId
 * @returns {{ success: boolean, steps: string[], error?: string }}
 */
async function permanentlyDeleteCustomer(sbAdmin, customerId) {
  const steps = [];

  try {
    // ── Auth User ID auflösen (vor dem Löschen, solange Daten noch da sind) ──
    const authUserId = await resolveAuthUserId(sbAdmin, customerId);
    steps.push('lookup_auth_user');

    // ── 1. contracts ──────────────────────────────────────────────────────────
    const { error: contractsErr } = await sbAdmin
      .from('contracts')
      .delete()
      .eq('customer_id', customerId);
    if (contractsErr) throw new Error('contracts löschen fehlgeschlagen: ' + contractsErr.message);
    steps.push('delete_contracts');

    // ── 2. subscription_id FK auflösen (customers → subscriptions) ───────────
    const { error: clearSubRefErr } = await sbAdmin
      .from('customers')
      .update({ subscription_id: null })
      .eq('id', customerId);
    if (clearSubRefErr) {
      throw new Error('subscription_id Referenz auflösen fehlgeschlagen: ' + clearSubRefErr.message);
    }
    steps.push('clear_subscription_ref');

    // ── 3. subscriptions ──────────────────────────────────────────────────────
    const { error: subsErr } = await sbAdmin
      .from('subscriptions')
      .delete()
      .eq('customer_id', customerId);
    if (subsErr) throw new Error('subscriptions löschen fehlgeschlagen: ' + subsErr.message);
    steps.push('delete_subscriptions');

    // ── 4. calls ──────────────────────────────────────────────────────────────
    const { error: callsErr } = await sbAdmin
      .from('calls')
      .delete()
      .eq('customer_id', customerId);
    if (callsErr) throw new Error('calls löschen fehlgeschlagen: ' + callsErr.message);
    steps.push('delete_calls');

    // ── 5. cases ──────────────────────────────────────────────────────────────
    const { error: casesErr } = await sbAdmin
      .from('cases')
      .delete()
      .eq('customer_id', customerId);
    if (casesErr) throw new Error('cases löschen fehlgeschlagen: ' + casesErr.message);
    steps.push('delete_cases');

    // ── 6. invoices ───────────────────────────────────────────────────────────
    const { error: invoicesErr } = await sbAdmin
      .from('invoices')
      .delete()
      .eq('customer_id', customerId);
    if (invoicesErr) throw new Error('invoices löschen fehlgeschlagen: ' + invoicesErr.message);
    steps.push('delete_invoices');

    // ── 7. offers ─────────────────────────────────────────────────────────────
    const { error: offersErr } = await sbAdmin
      .from('offers')
      .delete()
      .eq('customer_id', customerId);
    if (offersErr) throw new Error('offers löschen fehlgeschlagen: ' + offersErr.message);
    steps.push('delete_offers');

    // ── 8. onboarding ─────────────────────────────────────────────────────────
    const { error: onboardingErr } = await sbAdmin
      .from('onboarding')
      .delete()
      .eq('customer_id', customerId);
    if (onboardingErr) throw new Error('onboarding löschen fehlgeschlagen: ' + onboardingErr.message);
    steps.push('delete_onboarding');

    // ── 9. public.users ───────────────────────────────────────────────────────
    const { error: usersErr } = await sbAdmin
      .from('users')
      .delete()
      .eq('customer_id', customerId);
    if (usersErr) throw new Error('public.users löschen fehlgeschlagen: ' + usersErr.message);
    steps.push('delete_public_users');

    // ── 10. customers (Haupteintrag) ──────────────────────────────────────────
    const { error: customerErr } = await sbAdmin
      .from('customers')
      .delete()
      .eq('id', customerId);
    if (customerErr) throw new Error('customers löschen fehlgeschlagen: ' + customerErr.message);
    steps.push('delete_customer');

    // ── 11. auth.users (immer zuletzt) ────────────────────────────────────────
    if (authUserId) {
      const { error: authErr } = await sbAdmin.auth.admin.deleteUser(authUserId);
      if (authErr) {
        const msg = String(authErr.message || '').toLowerCase();
        const status = authErr.status || 0;
        if (status === 404 || msg.includes('not found') || msg.includes('not_found')) {
          // Auth-User bereits gelöscht – kein kritischer Fehler
          steps.push('delete_auth_user_skipped_not_found');
        } else {
          throw new Error('auth.users löschen fehlgeschlagen: ' + authErr.message);
        }
      } else {
        steps.push('delete_auth_user');
      }
    } else {
      steps.push('delete_auth_user_skipped_no_user');
    }

    return { success: true, steps };

  } catch (err) {
    return { success: false, error: err.message, steps };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Handler
// ─────────────────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return response(405, { error: 'Method not allowed' });
  }

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, {
      error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.',
    });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Auth Guard: Admin-Prüfung ──────────────────────────────────────────────
  const caller = await requireAdminCaller({
    event,
    supabaseUrl: sbUrl,
    supabaseAnonKey: sbAnonKey,
    sbAdmin,
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  // ── Role Guard: nur owner ──────────────────────────────────────────────────
  const callerRole = String(caller.role || '').toLowerCase().trim();
  if (!ALLOWED_ROLES.has(callerRole)) {
    return response(403, {
      error: 'Nur Admins mit der Rolle "owner" dürfen Kunden permanent löschen.',
      caller_role: callerRole,
    });
  }

  // ── Request Body ──────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_e) {
    return response(400, { error: 'Ungültiger Request Body.' });
  }

  const customerId = String(body.customer_id || '').trim();
  if (!customerId) {
    return response(400, { error: 'customer_id ist erforderlich.' });
  }

  // ── Delete ausführen ───────────────────────────────────────────────────────
  const result = await permanentlyDeleteCustomer(sbAdmin, customerId);

  if (!result.success) {
    console.error('[customer-delete-permanently] ❌ Fehler:', result.error);
    return response(500, {
      error: result.error,
      steps_completed: result.steps,
    });
  }

  console.log('[customer-delete-permanently] ✅ Abgeschlossen für customer_id:', customerId);
  return response(200, {
    success: true,
    customer_id: customerId,
    steps_completed: result.steps,
  });
};

// Exportiert für interne Nutzung durch admin-mutate.js
exports.permanentlyDeleteCustomer = permanentlyDeleteCustomer;
