// netlify/functions/activate-subscription.js
//
// Activates a subscription for an existing customer and transitions
// customer lifecycle status to 'live' (if transition is legal).
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
const { STATUS, normalizeCustomerStatus, assertCustomerTransition } = require('./_lib/status-model');
const { requireAdminCaller } = require('./_lib/require-admin');

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
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbServiceKey || !sbAnonKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.' }) };
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  // admin-only action
  const caller = await requireAdminCaller({
    event,
    supabaseUrl: sbUrl,
    supabaseAnonKey: sbAnonKey,
    sbAdmin
  });
  if (!caller.ok) {
    return { statusCode: caller.statusCode, headers, body: JSON.stringify(caller.body) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungueltiger Request Body' }) }; }

  const { customer_id, plan, billing_cycle, start_date } = body;
  if (!customer_id || !plan || !billing_cycle || !start_date) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Pflichtfelder fehlen: customer_id, plan, billing_cycle, start_date' }) };
  }

  try {
    // 1. Verify customer exists and transition to live is allowed
    const { data: customer, error: custErr } = await sbAdmin
      .from('customers')
      .select('id, status')
      .eq('id', customer_id)
      .single();
    if (custErr || !customer) throw new Error('Kunde nicht gefunden');

    const currentStatus = normalizeCustomerStatus(customer.status);
    if (currentStatus !== STATUS.customer.LIVE) {
      assertCustomerTransition(currentStatus, STATUS.customer.LIVE);
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

    // 3. Update customer: status → 'live', link subscription, set activated_at
    const now = new Date().toISOString();
    const { error: updateErr } = await sbAdmin
      .from('customers')
      .update({
        status: STATUS.customer.LIVE,
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

    let welcome_email_sent = false;
    let welcome_email_error = null;

    try {
      const welcomeRes = await fetch(welcomeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id })
      });
      if (!welcomeRes.ok) {
        const err = await welcomeRes.json().catch(() => ({}));
        welcome_email_error = err.error || `HTTP ${welcomeRes.status}`;
        console.error('send-welcome fehlgeschlagen:', welcome_email_error);
      } else {
        welcome_email_sent = true;
      }
    } catch (welcomeErr) {
      // Log but do not fail activation if welcome email encounters a transient error
      welcome_email_error = welcomeErr.message;
      console.error('send-welcome Ausnahme:', welcomeErr.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, subscription_id: subscriptionId, customer_id, welcome_email_sent, welcome_email_error })
    };

  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: e.message }) };
  }
};
