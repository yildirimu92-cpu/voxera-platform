// netlify/functions/create-customer.js
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
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.' }) };
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungueltiger Request Body' }) }; }

  const { customer_id, customer_name, email, password, voxera_number, plan, start_date } = body;

  if (!customer_id || !customer_name || !email || !password || !voxera_number) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Pflichtfelder fehlen' }) };
  }

  try {
    // 1. Auth User erstellen
    const { data: authData, error: authError } = await sbAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { customer_id }
    });
    if (authError) throw new Error('Auth: ' + authError.message);
    const authUserId = authData.user.id;

    // 2. Customer erstellen
    const dashboardId = 'vx-' + customer_id + '-' + Date.now().toString(36);
    const { error: custError } = await sbAdmin.from('customers').insert({
      id: customer_id, customer_name, email, voxera_number,
      plan: plan || 'Business', dashboard_id: dashboardId,
      status: 'active', start_date: start_date || new Date().toISOString().split('T')[0],
      invite_status: 'active', welcome_sent: false,
      notification_active: true, new_log_email_active: true, missed_call_email_active: false,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
    if (custError) {
      await sbAdmin.auth.admin.deleteUser(authUserId);
      throw new Error('Customer: ' + custError.message);
    }

    // 3. public.users UPSERT (INSERT oder UPDATE falls Trigger noch existiert)
    await new Promise(r => setTimeout(r, 300));
    const { error: userError } = await sbAdmin.from('users').upsert({
      id: authUserId, email, customer_id, role: 'customer', is_admin: false,
      created_at: new Date().toISOString()
    }, { onConflict: 'id' });

    if (userError) {
      console.error('Users upsert failed:', userError.message);
    }

    // 4. Welcome-E-Mail via Make Webhook
    let emailSent = false;
    try {
      const webhookUrl = process.env.MAKE_WELCOME_WEBHOOK || 'https://hook.eu1.make.com/3nqavrb751n3l1dd7qqib6ugp0pslxxj';
      const webhookRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name,
          email,
          password,
          plan: plan || 'Business',
          voxera_number,
          customer_id,
          dashboard_url: 'https://dashboard.voxera.ch'
        })
      });
      emailSent = webhookRes.ok;
      if (emailSent) {
        await sbAdmin.from('customers').update({ welcome_sent: true }).eq('id', customer_id);
      }
    } catch (webhookErr) {
      console.error('Welcome webhook failed:', webhookErr.message);
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true, customer_id, auth_user_id: authUserId,
        dashboard_id: dashboardId, email, email_sent: emailSent
      })
    };

  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: e.message }) };
  }
};
