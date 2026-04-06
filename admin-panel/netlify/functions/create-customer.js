const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

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
  try {
    body = JSON.parse(event.body);
  } catch (_e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ungueltiger Request Body' }) };
  }

  const requiredFields = ['customer_name', 'email', 'tel_nr', 'street', 'zip', 'city', 'country', 'plan'];
  const missingFields = requiredFields.filter((field) => !String(body[field] || '').trim());
  if (missingFields.length > 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Pflichtfelder fehlen', missing_fields: missingFields })
    };
  }

  try {
    const nowIso = new Date().toISOString();
    const customerId = String(body.customer_id || `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    const onboardingId = randomUUID();
    const contactFirstName = String(body.contact_first_name || '').trim();
    const contactLastName = String(body.contact_last_name || '').trim();
    const contactName = [contactFirstName, contactLastName].filter(Boolean).join(' ').trim() || null;

    const customerPayload = {
      id: customerId,
      customer_name: String(body.customer_name).trim(),
      plan: String(body.plan).trim(),
      voxera_number: body.voxera_number ? String(body.voxera_number).trim() : null,
      dashboard_id: body.dashboard_id ? String(body.dashboard_id).trim() : null,
      tel_nr: String(body.tel_nr).trim(),
      email: String(body.email).trim().toLowerCase(),
      invite_status: 'not_sent',
      welcome_sent: false,
      forwarding_setup_completed: false,
      status: 'onboarding',
      start_date: body.start_date || new Date().toISOString().slice(0, 10),
      created_at: nowIso,
      updated_at: nowIso,
      street: String(body.street).trim(),
      zip: String(body.zip).trim(),
      city: String(body.city).trim(),
      country: String(body.country).trim(),
      contact_name: contactName,
      contact_first_name: contactFirstName || null,
      contact_last_name: contactLastName || null,
      notes: body.notes ? String(body.notes).trim() : null
    };

    const { data: createdCustomer, error: customerError } = await sbAdmin
      .from('customers')
      .insert(customerPayload)
      .select('*')
      .single();

    if (customerError) {
      throw new Error(`Customer insert failed: ${customerError.message}`);
    }

    const onboardingPayload = {
      id: onboardingId,
      customer_id: customerId,
      status: 'not_started',
      progress: 0,
      next_step: 'Zugang senden',
      blocker: null,
      owner: null,
      created_at: nowIso,
      updated_at: nowIso
    };

    const { data: createdOnboarding, error: onboardingError } = await sbAdmin
      .from('onboarding')
      .insert(onboardingPayload)
      .select('*')
      .single();

    if (onboardingError) {
      const { error: rollbackError } = await sbAdmin.from('customers').delete().eq('id', customerId);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: `Onboarding insert failed: ${onboardingError.message}`,
          rollback_applied: !rollbackError,
          rollback_error: rollbackError ? rollbackError.message : null,
          limitation: 'No transaction is used in this function. Rollback is best-effort only.'
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        customer: createdCustomer,
        onboarding: createdOnboarding,
        transactional: false
      })
    };
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: e.message }) };
  }
};
