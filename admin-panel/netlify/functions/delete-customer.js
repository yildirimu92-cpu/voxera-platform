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
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server-Konfiguration unvollständig.' }) };
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungültiger Request Body' }) }; }

  const { customer_id } = body;

  if (!customer_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'customer_id fehlt' }) };
  }

  try {
    // 1. Auth User ID finden über public.users
    const { data: userRow } = await sbAdmin.from('users')
      .select('id')
      .eq('customer_id', customer_id)
      .single();

    // 2. public.users löschen (vor customers wegen FK)
    if (userRow) {
      await sbAdmin.from('users').delete().eq('customer_id', customer_id);
    }

    // 3. Calls löschen die zum Kunden gehören
    await sbAdmin.from('calls').delete().eq('customer_id', customer_id);

    // 4. Customer löschen
    const { error: custErr } = await sbAdmin.from('customers').delete().eq('id', customer_id);
    if (custErr) throw new Error('Customer löschen: ' + custErr.message);

    // 5. Auth User löschen
    if (userRow) {
      const { error: authErr } = await sbAdmin.auth.admin.deleteUser(userRow.id);
      if (authErr) {
        console.error('Auth User löschen fehlgeschlagen:', authErr.message);
        // Kein throw — Daten sind schon gelöscht
      }
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, customer_id, auth_user_deleted: !!userRow })
    };

  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: e.message }) };
  }
};
