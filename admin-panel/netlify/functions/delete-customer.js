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

  const steps_completed = [];

  try {
    // A) public.users per customer_id laden → authUserId ermitteln
    const { data: userRow, error: userLookupErr } = await sbAdmin
      .from('users')
      .select('id')
      .eq('customer_id', customer_id)
      .maybeSingle();

    if (userLookupErr) {
      throw new Error('User-Lookup fehlgeschlagen: ' + userLookupErr.message);
    }

    const authUserId = userRow?.id ?? null;
    console.log(`[delete-customer] authUserId: ${authUserId ?? 'nicht gefunden'}`);

    // B) Datenbank-Einträge in der gewünschten Reihenfolge löschen
    // (VOR Auth User Löschung, um FK-Constraints zu vermeiden)

    // 1. contracts
    const { error: contractsErr, count: contractsCount } = await sbAdmin
      .from('contracts')
      .delete({ count: 'exact' })
      .eq('customer_id', customer_id);

    if (contractsErr) throw new Error('Contracts löschen fehlgeschlagen: ' + contractsErr.message);
    console.log(`[delete-customer] ✅ ${contractsCount ?? 0} Contracts gelöscht`);
    steps_completed.push('contracts');

    // 2. subscriptions
    const { error: subsErr, count: subsCount } = await sbAdmin
      .from('subscriptions')
      .delete({ count: 'exact' })
      .eq('customer_id', customer_id);

    if (subsErr) throw new Error('Subscriptions löschen fehlgeschlagen: ' + subsErr.message);
    console.log(`[delete-customer] ✅ ${subsCount ?? 0} Subscriptions gelöscht`);
    steps_completed.push('subscriptions');

    // 3. calls
    const { error: callsErr, count: callsCount } = await sbAdmin
      .from('calls')
      .delete({ count: 'exact' })
      .eq('customer_id', customer_id);

    if (callsErr) throw new Error('Calls löschen fehlgeschlagen: ' + callsErr.message);
    console.log(`[delete-customer] ✅ ${callsCount ?? 0} Calls gelöscht`);
    steps_completed.push('calls');

    // 4. public.users (WICHTIG: vor Auth User löschen, um FK-Constraint zu vermeiden)
    const { error: usersErr, count: usersCount } = await sbAdmin
      .from('users')
      .delete({ count: 'exact' })
      .eq('customer_id', customer_id);

    if (usersErr) throw new Error('Users löschen fehlgeschlagen: ' + usersErr.message);
    console.log(`[delete-customer] ✅ ${usersCount ?? 0} User-Einträge gelöscht`);
    steps_completed.push('users');

    // 5. public.customers
    const { error: custErr, count: custCount } = await sbAdmin
      .from('customers')
      .delete({ count: 'exact' })
      .eq('id', customer_id);

    if (custErr) throw new Error('Customer löschen fehlgeschlagen: ' + custErr.message);
    if (custCount === 0) {
      console.warn(`[delete-customer] Kein Customer mit id ${customer_id} gefunden`);
    }
    console.log(`[delete-customer] ✅ Customer ${customer_id} gelöscht`);
    steps_completed.push('customers');

    // C) Auth User löschen (JETZT, nachdem public.users gelöscht wurde)
    if (authUserId) {
      const { error: authErr } = await sbAdmin.auth.admin.deleteUser(authUserId);

      if (authErr) {
        if (authErr.status === 404) {
          console.warn(`[delete-customer] Auth User ${authUserId} nicht gefunden – übersprungen`);
        } else {
          throw new Error(`Auth User ${authUserId} löschen fehlgeschlagen: ${authErr.message}`);
        }
      } else {
        console.log(`[delete-customer] ✅ Auth User ${authUserId} gelöscht`);
        steps_completed.push('auth');
      }
    } else {
      console.warn(`[delete-customer] Kein Auth User für customer_id ${customer_id} – übersprungen`);
    }

    console.log(`[delete-customer] ✅ Löschung komplett für customer_id: ${customer_id}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, customer_id, steps_completed })
    };
  } catch (e) {
    console.error(`[delete-customer] ❌ Fehler bei customer_id ${customer_id}: ${e.message}`);
    console.error(`[delete-customer] Abgeschlossene Schritte: ${steps_completed.join(', ') || 'keine'}`);

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: e.message, customer_id, steps_completed })
    };
  }
};