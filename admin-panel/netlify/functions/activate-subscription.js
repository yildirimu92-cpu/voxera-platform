// netlify/functions/activate-subscription.js
//
// Activates a subscription for an existing customer.
//
// NOTE: subscriptions.customer_id is currently UNIQUE (PR 1), meaning one
// subscription per customer. This is intentional for the initial release.
// Future PRs will support subscription history by adding an end_date column
// to subscriptions and querying active subscriptions via:
//   status = 'active' AND (end_date IS NULL OR end_date > now())
// At that point the UNIQUE constraint on customer_id should be removed.
//
// Accepts (POST JSON):
//   customer_id   – existing customer id
//   plan          – e.g. "Business", "Professional"
//   billing_cycle – "monthly" | "yearly"
//   start_date    – ISO date string (YYYY-MM-DD)
//
// Returns:
//   { success, subscription_id, customer_id }
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
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.' }) };
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungueltiger Request Body' }) }; }

  const { customer_id, plan, billing_cycle, start_date } = body;
  if (!customer_id || !plan || !billing_cycle || !start_date) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Pflichtfelder fehlen: customer_id, plan, billing_cycle, start_date' }) };
  }

  try {
    // 1. Verify customer exists and is in 'pending' status
    const { data: customer, error: custErr } = await sbAdmin
      .from('customers')
      .select('id, status')
      .eq('id', customer_id)
      .single();
    if (custErr || !customer) throw new Error('Kunde nicht gefunden');

    // Only 'pending' customers can be activated
    if (customer.status !== 'pending') {
      throw new Error(`Kunde kann nicht aktiviert werden. Status ist '${customer.status}', erwartet wird 'pending'.`);
    }

    // 2. Upsert subscription record (status always 'active' on activation).
    //
    // NOTE: customer_id is UNIQUE for PR 1. An existing subscription row may be
    // present if a customer was previously activated and then set back to 'pending'
    // (e.g. via the admin pause action). In that case we update the existing row
    // rather than inserting a new one, so the UNIQUE constraint is respected.
    // Future PRs will replace this upsert with a plain INSERT once the UNIQUE
    // constraint is removed and subscription history is supported.
    const { data: subscription, error: subErr } = await sbAdmin
      .from('subscriptions')
      .upsert({
        customer_id,
        plan,
        billing_cycle,
        start_date,
        status: 'active',
        updated_at: new Date().toISOString()
      }, { onConflict: 'customer_id' })
      .select('id')
      .single();
    if (subErr) throw new Error('Subscription erstellen: ' + subErr.message);
    const subscriptionId = subscription.id;

    // 3. Update customer: status → 'active', link subscription, set activated_at
    const now = new Date().toISOString();
    const { error: updateErr } = await sbAdmin
      .from('customers')
      .update({
        status: 'active',
        subscription_id: subscriptionId,
        activated_at: now,
        updated_at: now
      })
      .eq('id', customer_id);
    if (updateErr) throw new Error('Customer update: ' + updateErr.message);

    // 4. Trigger welcome email via send-welcome function
    const baseUrl = process.env.URL || process.env.DEPLOY_URL || '';
    const welcomeUrl = baseUrl
      ? `${baseUrl.replace(/\/$/, '')}/.netlify/functions/send-welcome`
      : '/.netlify/functions/send-welcome';

    try {
      const welcomeRes = await fetch(welcomeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id })
      });
      if (!welcomeRes.ok) {
        const err = await welcomeRes.json().catch(() => ({}));
        console.error('send-welcome fehlgeschlagen:', err.error || welcomeRes.status);
      }
    } catch (welcomeErr) {
      // Log but do not fail activation if welcome email encounters a transient error
      console.error('send-welcome Ausnahme:', welcomeErr.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, subscription_id: subscriptionId, customer_id })
    };

  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: e.message }) };
  }
};
