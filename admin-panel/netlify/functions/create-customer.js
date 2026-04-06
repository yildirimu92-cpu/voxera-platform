import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

export default async (request) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers
    });
  }

  console.log('ENV:', process.env.SUPABASE_URL ? 'OK' : 'MISSING');

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbServiceKey) {
    console.error('Missing Supabase environment variables', {
      SUPABASE_URL: !!sbUrl,
      SUPABASE_SERVICE_ROLE_KEY: !!sbServiceKey
    });

    return new Response(
      JSON.stringify({
        error: 'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.'
      }),
      {
        status: 500,
        headers
      }
    );
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let body;
  try {
    body = await request.json();
  } catch (error) {
    console.error('Invalid JSON request body', error);
    return new Response(JSON.stringify({ error: 'Ungueltiger Request Body' }), {
      status: 400,
      headers
    });
  }

  const requiredFields = ['customer_name', 'email', 'tel_nr', 'street', 'zip', 'city', 'country', 'plan'];
  const missingFields = requiredFields.filter((field) => !String(body[field] || '').trim());
  if (missingFields.length > 0) {
    console.error('Validation failed: missing required fields', { missingFields });
    return new Response(
      JSON.stringify({ error: 'Pflichtfelder fehlen', missing_fields: missingFields }),
      {
        status: 400,
        headers
      }
    );
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
      forwarding_setup_completed: false,
      status: 'onboarding',
      start_date: body.start_date || new Date().toISOString().slice(0, 10),
      created_at: nowIso,
      updated_at: nowIso,
      street: String(body.street).trim(),
      zip: String(body.zip).trim(),
      city: String(body.city).trim(),
      country: String(body.country).trim(),
      contact_first_name: contactFirstName,
      contact_last_name: contactLastName,
      contact_name: contactName,
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
      console.error('Onboarding insert failed', onboardingError);
      if (rollbackError) {
        console.error('Rollback failed', rollbackError);
      }

      return new Response(
        JSON.stringify({
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
      }),
      {
        status: 200,
        headers
      }
    );
  } catch (error) {
    console.error('Failed to create customer', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to create customer',
        details: error.message
      }),
      {
        status: 500,
        headers
      }
    );
  }
};
