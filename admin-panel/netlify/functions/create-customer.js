import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log('SUPABASE_URL present:', !!sbUrl);
  console.log('SUPABASE_SERVICE_ROLE_KEY present:', !!sbServiceKey);

  if (!sbUrl || !sbServiceKey) {
    console.error('Missing Supabase environment variables', {
      SUPABASE_URL: !!sbUrl,
      SUPABASE_SERVICE_ROLE_KEY: !!sbServiceKey
    });

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.'
      })
    };
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    console.error('Invalid JSON request body', error);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Ungueltiger Request Body' })
    };
  }

  const requiredFields = ['customer_name', 'email', 'tel_nr', 'street', 'zip', 'city', 'country', 'plan'];
  const missingFields = requiredFields.filter((field) => !String(body[field] || '').trim());
  if (missingFields.length > 0) {
    console.error('Validation failed: missing required fields', { missingFields });
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Pflichtfelder fehlen',
        missing_fields: missingFields
      })
    };
  }

  try {
    const nowIso = new Date().toISOString();
    const customerId = `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const onboardingId = randomUUID();
    const contactFirstName = body.contact_first_name ? String(body.contact_first_name).trim() : null;
    const contactLastName = body.contact_last_name ? String(body.contact_last_name).trim() : null;
    const contactNameParts = [contactFirstName, contactLastName].filter((value) => value);
    const contactName = contactNameParts.length > 0 ? contactNameParts.join(' ') : null;

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
      status: 'onboarding',
      forwarding_setup_completed: false,
      street: String(body.street).trim(),
      zip: String(body.zip).trim(),
      city: String(body.city).trim(),
      country: String(body.country).trim(),
      contact_name: contactName,
      notes: body.notes ? String(body.notes).trim() : null,
      contact_first_name: contactFirstName,
      contact_last_name: contactLastName
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
      console.error('Onboarding insert failed', onboardingError);
      if (rollbackError) {
        console.error('Rollback failed', rollbackError);
      }

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: `Onboarding insert failed: ${onboardingError.message}`,
          rollback_applied: !rollbackError,
          rollback_error: rollbackError ? rollbackError.message : null,
          limitation: 'No transaction is used in this function. Rollback is best-effort only.'
        }),
        {
          status: 500,
          headers
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Customer and onboarding created',
        customer: createdCustomer,
        onboarding: createdOnboarding,
        transactional: false
      })
    };
  } catch (error) {
    console.error('Failed to create customer', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to create customer',
        details: error.message
      })
    };
  }
};
