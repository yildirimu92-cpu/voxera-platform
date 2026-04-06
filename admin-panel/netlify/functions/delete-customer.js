const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  // CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // Nur POST erlauben
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Method Not Allowed' }),
    };
  }

  const steps_completed = [];

  try {
    const { customer_id } = JSON.parse(event.body || '{}');

    if (!customer_id) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: 'customer_id ist erforderlich' }),
      };
    }

    console.log(`[delete-customer] 🚀 Starte Hard Delete für customer_id: ${customer_id}`);

    const sbAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const caller = await requireAdminCaller({
      event,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
      sbAdmin
    });
    if (!caller.ok) {
      return {
        statusCode: caller.statusCode,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, ...caller.body }),
      };
    }

    // ──────────────────────────────────────────────
    // 1. authUserId aus public.users laden
    // ──────────────────────────────────────────────
    const { data: userData, error: userErr } = await sbAdmin
      .from('users')
      .select('id')
      .eq('customer_id', customer_id)
      .maybeSingle();

    if (userErr) throw new Error('User-Lookup fehlgeschlagen: ' + userErr.message);

    const authUserId = userData ? userData.id : null;
    console.log(`[delete-customer] 🔍 Auth User ID: ${authUserId || 'NICHT GEFUNDEN'}`);
    steps_completed.push('lookup_auth_user');

    // ──────────────────────────────────────────────
    // 2. contracts löschen
    // ──────────────────────────────────────────────
    const { error: contractsErr } = await sbAdmin
      .from('contracts')
      .delete()
      .eq('customer_id', customer_id);

    if (contractsErr) throw new Error('Contracts löschen fehlgeschlagen: ' + contractsErr.message);
    console.log(`[delete-customer] ✅ Contracts gelöscht`);
    steps_completed.push('delete_contracts');

    // ──────────────────────────────────────────────
    // 3. subscription_id in customers auf null setzen
    //    (FK customers_subscription_id_fkey auflösen)
    // ──────────────────────────────────────────────
    const { error: clearSubsRefErr } = await sbAdmin
      .from('customers')
      .update({ subscription_id: null })
      .eq('id', customer_id);

    if (clearSubsRefErr) throw new Error('subscription_id Referenz löschen fehlgeschlagen: ' + clearSubsRefErr.message);
    console.log(`[delete-customer] ✅ subscription_id Referenz in customers gelöscht`);
    steps_completed.push('clear_subscription_ref');

    // ──────────────────────────────────────────────
    // 4. subscriptions löschen
    // ──────────────────────────────────────────────
    const { error: subsErr } = await sbAdmin
      .from('subscriptions')
      .delete()
      .eq('customer_id', customer_id);

    if (subsErr) throw new Error('Subscriptions löschen fehlgeschlagen: ' + subsErr.message);
    console.log(`[delete-customer] ✅ Subscriptions gelöscht`);
    steps_completed.push('delete_subscriptions');

    // ──────────────────────────────────────────────
    // 5. calls löschen
    // ──────────────────────────────────────────────
    const { error: callsErr } = await sbAdmin
      .from('calls')
      .delete()
      .eq('customer_id', customer_id);

    if (callsErr) throw new Error('Calls löschen fehlgeschlagen: ' + callsErr.message);
    console.log(`[delete-customer] ✅ Calls gelöscht`);
    steps_completed.push('delete_calls');

    // ──────────────────────────────────────────────
    // 6. public.users löschen
    // ──────────────────────────────────────────────
    const { error: deleteUserErr } = await sbAdmin
      .from('users')
      .delete()
      .eq('customer_id', customer_id);

    if (deleteUserErr) throw new Error('User löschen fehlgeschlagen: ' + deleteUserErr.message);
    console.log(`[delete-customer] ✅ public.users Eintrag gelöscht`);
    steps_completed.push('delete_public_user');

    // ──────────────────────────────────────────────
    // 7. public.customers löschen
    // ──────────────────────────────────────────────
    const { error: deleteCustomerErr } = await sbAdmin
      .from('customers')
      .delete()
      .eq('id', customer_id);

    if (deleteCustomerErr) throw new Error('Customer löschen fehlgeschlagen: ' + deleteCustomerErr.message);
    console.log(`[delete-customer] ✅ public.customers Eintrag gelöscht`);
    steps_completed.push('delete_customer');

    // ──────────────────────────────────────────────
    // 8. Auth User löschen (ganz am Schluss)
    // ──────────────────────────────────────────────
    if (authUserId) {
      const { error: authDeleteErr } = await sbAdmin.auth.admin.deleteUser(authUserId);

      if (authDeleteErr) {
        const errMsg = (authDeleteErr.message || '').toLowerCase();
        const errStatus = authDeleteErr.status || 0;

        if (errStatus === 404 || errMsg.includes('not found') || errMsg.includes('not_found')) {
          console.warn(`[delete-customer] ⚠️ Auth User ${authUserId} existiert bereits nicht mehr – übersprungen`);
          steps_completed.push('delete_auth_user_skipped_not_found');
        } else {
          throw new Error('Auth User löschen fehlgeschlagen: ' + authDeleteErr.message);
        }
      } else {
        console.log(`[delete-customer] ✅ Auth User ${authUserId} gelöscht`);
        steps_completed.push('delete_auth_user');
      }
    } else {
      console.warn(`[delete-customer] ⚠️ Kein Auth User für customer_id ${customer_id} gefunden – übersprungen`);
      steps_completed.push('delete_auth_user_skipped_no_user');
    }

    // ──────────────────────────────────────────────
    // Erfolg
    // ──────────────────────────────────────────────
    console.log(`[delete-customer] 🏁 Hard Delete abgeschlossen für customer_id: ${customer_id}`);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, customer_id, steps_completed }),
    };

  } catch (err) {
    console.error(`[delete-customer] ❌ Fehler: ${err.message}`);

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: err.message,
        steps_completed,
      }),
    };
  }
};
