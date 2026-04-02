// netlify/functions/create-customer.js
// Erstellt: Auth User + public.customers + UPDATE public.users (Trigger erstellt users-Eintrag automatisch)
// Benötigt Env-Variablen: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: 'Server-Konfiguration unvollständig. SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.' })
    };
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

  const { customer_id, customer_name, email, password, voxera_number, plan, start_date } = body;

  if (!customer_id || !customer_name || !email || !password || !voxera_number) {
    return {
      statusCode: 400, headers,
      body: JSON.stringify({ error: 'Pflichtfelder fehlen: customer_id, customer_name, email, password, voxera_number' })
    };
  }

  try {
    // 1. Auth User erstellen
    // HINWEIS: Der Trigger "on_auth_user_created_ensure_public_user" erstellt
    // automatisch einen Eintrag in public.users mit customer_id = NULL
    const { data: authData, error: authError } = await sbAdmin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: { customer_id: customer_id }
    });

    if (authError) {
      throw new Error('Auth User erstellen fehlgeschlagen: ' + authError.message);
    }

    const authUserId = authData.user.id;

    // 2. Dashboard-ID generieren
    const dashboardId = 'vx-' + customer_id + '-' + Date.now().toString(36);

    // 3. Customer in public.customers erstellen
    const { error: custError } = await sbAdmin.from('customers').insert({
      id: customer_id,
      customer_name: customer_name,
      email: email,
      voxera_number: voxera_number,
      plan: plan || 'Business',
      dashboard_id: dashboardId,
      status: 'active',
      start_date: start_date || new Date().toISOString().split('T')[0],
      invite_status: 'active',
      welcome_sent: false,
      notification_active: true,
      new_log_email_active: true,
      missed_call_email_active: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    if (custError) {
      // Rollback: Auth User löschen
      await sbAdmin.auth.admin.deleteUser(authUserId);
      throw new Error('Customer erstellen fehlgeschlagen: ' + custError.message);
    }

    // 4. public.users UPDATE (nicht INSERT — der Trigger hat den Eintrag bereits erstellt)
    // Warte kurz damit der Trigger Zeit hat
    await new Promise(r => setTimeout(r, 500));

    const { error: userError } = await sbAdmin.from('users').update({
      email: email,
      customer_id: customer_id,
      role: 'customer',
      is_admin: false
    }).eq('id', authUserId);

    if (userError) {
      console.error('Users update failed:', userError.message);
      // Kein Rollback — Customer und Auth User sind korrekt erstellt
      // Der Trigger hat den users-Eintrag schon, nur ohne customer_id
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        customer_id: customer_id,
        auth_user_id: authUserId,
        dashboard_id: dashboardId,
        email: email
      })
    };

  } catch (e) {
    return {
      statusCode: 400, headers,
      body: JSON.stringify({ error: e.message })
    };
  }
};
