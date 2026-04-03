// netlify/functions/delete-customer.js
const { createClient } = require('@supabase/supabase-js');

async function deleteAuthUserWithFallback(sbAdmin, userId) {
  // Primär: harte Löschung über SQL RPC (inkl. sessions + identities)
  const { error: rpcErr } = await sbAdmin.rpc('delete_auth_user_data', {
    target_user_id: userId
  });

  if (!rpcErr) {
    return { deleted: true, method: 'rpc' };
  }

  console.warn(`[delete-customer] RPC delete_auth_user_data fehlgeschlagen: ${rpcErr.message}`);

  // Fallback 1: offizielle Admin API harte Löschung
  const { error: deleteErr } = await sbAdmin.auth.admin.deleteUser(userId, false);
  if (!deleteErr) {
    return { deleted: true, method: 'admin.deleteUser' };
  }

  console.warn(`[delete-customer] auth.admin.deleteUser hard delete fehlgeschlagen: ${deleteErr.message}`);

  // Fallback 2: Soft Delete als letzter Schutz, damit Login/Recovery nicht mehr greift
  const { error: softDeleteErr } = await sbAdmin.auth.admin.deleteUser(userId, true);
  if (!softDeleteErr) {
    return { deleted: true, method: 'admin.deleteUser(soft)' };
  }

  throw new Error(`Auth User löschen fehlgeschlagen (RPC + API): ${softDeleteErr.message}`);
}

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

  const result = {
    customer_id,
    auth_user_deleted: false,
    auth_delete_method: null,
    steps_completed: []
  };

  try {
    // 1. Auth User ID über public.users ermitteln
    const { data: userRow, error: userLookupErr } = await sbAdmin
      .from('users')
      .select('id')
      .eq('customer_id', customer_id)
      .maybeSingle();

    if (userLookupErr) {
      throw new Error('User-Mapping Lookup fehlgeschlagen: ' + userLookupErr.message);
    }

    if (userRow?.id) {
      console.log(`[delete-customer] Auth User ID gefunden: ${userRow.id}`);

      // 2. Auth User zuerst löschen, damit kein Recovery/Login mehr möglich ist
      const authDeleteResult = await deleteAuthUserWithFallback(sbAdmin, userRow.id);
      result.auth_user_deleted = authDeleteResult.deleted;
      result.auth_delete_method = authDeleteResult.method;
      result.steps_completed.push('auth');
      console.log(`[delete-customer] Auth User ${userRow.id} gelöscht via ${authDeleteResult.method}`);
    } else {
      console.warn(`[delete-customer] Kein User-Mapping für customer_id ${customer_id} gefunden`);
    }

    // 3. contracts löschen
    const { error: contractsErr, count: contractsCount } = await sbAdmin
      .from('contracts')
      .delete({ count: 'exact' })
      .eq('customer_id', customer_id);

    if (contractsErr) throw new Error('Contracts löschen fehlgeschlagen: ' + contractsErr.message);
    console.log(`[delete-customer] ${contractsCount ?? 0} Contracts gelöscht`);
    result.steps_completed.push('contracts');

    // 4. subscriptions löschen
    const { error: subsErr, count: subsCount } = await sbAdmin
      .from('subscriptions')
      .delete({ count: 'exact' })
      .eq('customer_id', customer_id);

    if (subsErr) throw new Error('Subscriptions löschen fehlgeschlagen: ' + subsErr.message);
    console.log(`[delete-customer] ${subsCount ?? 0} Subscriptions gelöscht`);
    result.steps_completed.push('subscriptions');

    // 5. calls löschen
    const { error: callsErr, count: callsCount } = await sbAdmin
      .from('calls')
      .delete({ count: 'exact' })
      .eq('customer_id', customer_id);

    if (callsErr) throw new Error('Calls löschen fehlgeschlagen: ' + callsErr.message);
    console.log(`[delete-customer] ${callsCount ?? 0} Calls gelöscht`);
    result.steps_completed.push('calls');

    // 6. public.users löschen (Mapping-Tabelle)
    const { error: usersErr, count: usersCount } = await sbAdmin
      .from('users')
      .delete({ count: 'exact' })
      .eq('customer_id', customer_id);

    if (usersErr) throw new Error('Users löschen fehlgeschlagen: ' + usersErr.message);
    console.log(`[delete-customer] ${usersCount ?? 0} User-Mappings gelöscht`);
    result.steps_completed.push('users');

    // 7. customers löschen
    const { error: custErr, count: custCount } = await sbAdmin
      .from('customers')
      .delete({ count: 'exact' })
      .eq('id', customer_id);

    if (custErr) throw new Error('Customer löschen fehlgeschlagen: ' + custErr.message);
    if (custCount === 0) {
      console.warn(`[delete-customer] Kein Customer mit id ${customer_id} gefunden`);
    }
    console.log('[delete-customer] Customer gelöscht');
    result.steps_completed.push('customers');

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
        steps_completed: result.steps_completed,
        auth_user_deleted: result.auth_user_deleted,
        auth_delete_method: result.auth_delete_method
      })
    };
  }
};
