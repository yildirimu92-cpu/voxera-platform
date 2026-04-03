// netlify/functions/delete-customer.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!sbUrl || !sbServiceKey) {
    console.error('[delete-customer] SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server-Konfiguration unvollständig.' }) };
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungültiger Request Body' }) };
  }

  const { customer_id } = body;

  if (!customer_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'customer_id fehlt' }) };
  }

  console.log(`[delete-customer] Starte Löschung für customer_id: ${customer_id}`);

  // Ergebnisse für die Response sammeln
  const result = {
    customer_id,
    auth_user_deleted: false,
    steps_completed: []
  };

  try {
    // ──────────────────────────────────────────────
    // 1. Auth User ID ermitteln über public.users
    // ──────────────────────────────────────────────
    const { data: userRow, error: userLookupErr } = await sbAdmin
      .from('users')
      .select('id')
      .eq('customer_id', customer_id)
      .single();

    if (userLookupErr) {
      console.warn(`[delete-customer] Kein User-Mapping gefunden für ${customer_id}: ${userLookupErr.message}`);
    } else {
      console.log(`[delete-customer] Auth User ID gefunden: ${userRow.id}`);
    }

    // ──────────────────────────────────────────────
    // 2. contracts löschen (hängt an subscription_id UND customer_id)
    // ──────────────────────────────────────────────
    const { error: contractsErr, count: contractsCount } = await sbAdmin
      .from('contracts')
      .delete({ count: 'exact' })
      .eq('customer_id', customer_id);

    if (contractsErr) throw new Error('Contracts löschen fehlgeschlagen: ' + contractsErr.message);
    console.log(`[delete-customer] ${contractsCount ?? 0} Contracts gelöscht`);
    result.steps_completed.push('contracts');

    // ──────────────────────────────────────────────
    // 3. subscriptions löschen
    // ──────────────────────────────────────────────
    const { error: subsErr, count: subsCount } = await sbAdmin
      .from('subscriptions')
      .delete({ count: 'exact' })
      .eq('customer_id', customer_id);

    if (subsErr) throw new Error('Subscriptions löschen fehlgeschlagen: ' + subsErr.message);
    console.log(`[delete-customer] ${subsCount ?? 0} Subscriptions gelöscht`);
    result.steps_completed.push('subscriptions');

    // ──────────────────────────────────────────────
    // 4. calls löschen
    // ──────────────────────────────────────────────
    const { error: callsErr, count: callsCount } = await sbAdmin
      .from('calls')
      .delete({ count: 'exact' })
      .eq('customer_id', customer_id);

    if (callsErr) throw new Error('Calls löschen fehlgeschlagen: ' + callsErr.message);
    console.log(`[delete-customer] ${callsCount ?? 0} Calls gelöscht`);
    result.steps_completed.push('calls');

    // ──────────────────────────────────────────────
    // 5. public.users löschen (Mapping-Tabelle)
    // ──────────────────────────────────────────────
    if (userRow) {
      const { error: usersErr } = await sbAdmin
        .from('users')
        .delete()
        .eq('customer_id', customer_id);

      if (usersErr) throw new Error('Users löschen fehlgeschlagen: ' + usersErr.message);
      console.log(`[delete-customer] User-Mapping gelöscht`);
    }
    result.steps_completed.push('users');

    // ──────────────────────────────────────────────
    // 6. customers löschen
    // ──────────────────────────────────────────────
    const { error: custErr, count: custCount } = await sbAdmin
      .from('customers')
      .delete({ count: 'exact' })
      .eq('id', customer_id);

    if (custErr) throw new Error('Customer löschen fehlgeschlagen: ' + custErr.message);
    if (custCount === 0) {
      console.warn(`[delete-customer] Kein Customer mit id ${customer_id} gefunden`);
    }
    console.log(`[delete-customer] Customer gelöscht`);
    result.steps_completed.push('customers');

    // ──────────────────────────────────────────────
    // 7. Auth User komplett löschen via SQL-Funktion
    //    Löscht auth.sessions, auth.identities und auth.users
    //    in einem Schritt — umgeht das Problem, dass
    //    auth.admin.deleteUser() an internen FKs scheitert.
    //    Voraussetzung: SQL-Funktion "delete_auth_user_data"
    //    muss in Supabase existieren (siehe SKILL.md / Setup).
    // ──────────────────────────────────────────────
    if (userRow) {
      const { error: rpcErr } = await sbAdmin.rpc('delete_auth_user_data', {
        target_user_id: userRow.id
      });
      if (rpcErr) throw new Error('Auth User löschen (RPC) fehlgeschlagen: ' + rpcErr.message);
      console.log(`[delete-customer] Auth User ${userRow.id} komplett gelöscht (sessions + identities + auth.users)`);
      result.auth_user_deleted = true;
    }
    result.steps_completed.push('auth');

    // ──────────────────────────────────────────────
    // Erfolg
    // ──────────────────────────────────────────────
    console.log(`[delete-customer] ✅ Löschung komplett für ${customer_id}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, ...result })
    };

  } catch (e) {
    console.error(`[delete-customer] ❌ Fehler bei ${customer_id}: ${e.message}`);
    console.error(`[delete-customer] Abgeschlossene Schritte: ${result.steps_completed.join(', ') || 'keine'}`);

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: e.message,
        customer_id,
        steps_completed: result.steps_completed
      })
    };
  }
};
