// netlify/functions/send-welcome.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbServiceKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server-Konfiguration unvollständig.' }) };
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungültiger Request Body' }) }; }

  const { customer_id } = body;
  if (!customer_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'customer_id fehlt' }) };
  }

  try {
    // Kundendaten laden
    const { data: customer, error: custErr } = await sbAdmin.from('customers')
      .select('*').eq('id', customer_id).single();
    if (custErr || !customer) throw new Error('Kunde nicht gefunden');

    // Supabase Recovery-Link generieren (zeitgebunden, kein eigener Token-Mechanismus)
    // Der Link führt den Kunden auf die /activate-Seite, wo er sein Passwort selbst setzt
    // Redirect-URL für den Aktivierungslink (muss in Supabase Auth als erlaubte Redirect-URL eingetragen sein)
    const activateUrl = process.env.ACTIVATE_URL || 'https://dashboard.voxera.ch/activate';
    const { data: linkData, error: linkErr } = await sbAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: customer.email,
      options: { redirectTo: activateUrl }
    });
    if (linkErr || !linkData?.properties?.action_link) {
      throw new Error('Aktivierungslink konnte nicht generiert werden: ' + (linkErr?.message || 'Unbekannter Fehler'));
    }
    const activationLink = linkData.properties.action_link;

    // Make Webhook aufrufen (activation_link statt password)
    const webhookUrl = process.env.MAKE_WELCOME_WEBHOOK || 'https://hook.eu1.make.com/3nqavrb751n3l1dd7qqib6ugp0pslxxj';
    const webhookRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: customer.customer_name,
        email: customer.email,
        activation_link: activationLink,
        plan: customer.plan || 'Business',
        voxera_number: customer.voxera_number,
        customer_id: customer.id,
        dashboard_url: 'https://dashboard.voxera.ch'
      })
    });

    if (!webhookRes.ok) throw new Error('Make Webhook fehlgeschlagen (Status ' + webhookRes.status + ')');

    // Status updaten
    const now = new Date().toISOString();
    await sbAdmin.from('customers').update({
      welcome_sent: true,
      welcome_sent_at: now,
      updated_at: now
    }).eq('id', customer_id);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, customer_id, welcome_sent_at: now })
    };

  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: e.message }) };
  }
};
