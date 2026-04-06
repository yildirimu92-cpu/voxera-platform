const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('node:crypto');
const { STATUS } = require('./_lib/status-model');
const { requireAdminCaller } = require('./_lib/require-admin');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
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
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!sbUrl || !sbServiceKey || !sbAnonKey) {
    console.error('Missing Supabase environment variables', {
      SUPABASE_URL: !!sbUrl,
      SUPABASE_SERVICE_ROLE_KEY: !!sbServiceKey,
      SUPABASE_ANON_KEY: !!sbAnonKey
    });

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.'
      })
    };
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // admin-only action
  const caller = await requireAdminCaller({
    event,
    supabaseUrl: sbUrl,
    supabaseAnonKey: sbAnonKey,
    sbAdmin
  });
  if (!caller.ok) {
    return {
      statusCode: caller.statusCode,
      headers,
      body: JSON.stringify(caller.body)
    };
  }

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

  const requiredFields = [
    'customer_name',
    'email',
    'tel_nr',
    'street',
    'zip',
    'city',
    'country',
    'plan'
  ];

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

    const email = String(body.email).trim().toLowerCase();

    const { data: existingCustomer, error: existingCustomerError } = await sbAdmin
      .from('customers')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingCustomerError) {
      console.error('Failed to check existing customer by email', existingCustomerError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Failed to check existing customer',
          details: existingCustomerError.message
        })
      };
    }

    if (existingCustomer) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          error: 'Customer already exists',
          existing_customer_id: existingCustomer.id,
          message: 'Ein Kunde mit dieser E-Mail existiert bereits'
        })
      };
    }

    const contactFirstName = body.contact_first_name
      ? String(body.contact_first_name).trim()
      : null;

    const contactLastName = body.contact_last_name
      ? String(body.contact_last_name).trim()
      : null;

    const contactNameParts = [contactFirstName, contactLastName].filter(Boolean);
    const contactName = contactNameParts.length > 0 ? contactNameParts.join(' ') : null;

    const customerPayload = {
      id: customerId,
      customer_name: String(body.customer_name).trim(),
      email,
      tel_nr: String(body.tel_nr).trim(),
      plan: String(body.plan).trim(),
      street: String(body.street).trim(),
      zip: String(body.zip).trim(),
      city: String(body.city).trim(),
      country: String(body.country).trim(),
      invite_status: STATUS.access.NOT_SENT,
      welcome_sent: false,
      status: STATUS.customer.ONBOARDING,
      forwarding_setup_completed: false,
      voxera_number: body.voxera_number ? String(body.voxera_number).trim() : null,
      dashboard_id: body.dashboard_id ? String(body.dashboard_id).trim() : null,
      notes: body.notes ? String(body.notes).trim() : null,
      contact_first_name: contactFirstName,
      contact_last_name: contactLastName,
      contact_name: contactName,
      created_at: nowIso,
      updated_at: nowIso
    };

    if (body.start_date) {
      customerPayload.start_date = body.start_date;
    }

    const { data: createdCustomer, error: customerError } = await sbAdmin
      .from('customers')
      .insert(customerPayload)
      .select('*')
      .single();

    if (customerError) {
      if (customerError.code === '23505') {
        let conflictId = null;
        const { data: conflictCustomer } = await sbAdmin
          .from('customers')
          .select('id')
          .eq('email', email)
          .maybeSingle();

        if (conflictCustomer) {
          conflictId = conflictCustomer.id;
        }

        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({
            error: 'Customer already exists',
            existing_customer_id: conflictId,
            message: 'Ein Kunde mit dieser E-Mail existiert bereits'
          })
        };
      }

      console.error('Customer insert failed', customerError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Customer insert failed',
          details: customerError.message
        })
      };
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
      console.error('Onboarding insert failed', onboardingError);

      const { error: rollbackError } = await sbAdmin
        .from('customers')
        .delete()
        .eq('id', customerId);

      if (rollbackError) {
        console.error('Rollback failed', rollbackError);
      }

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Onboarding insert failed',
          details: onboardingError.message,
          rollback_applied: !rollbackError,
          rollback_error: rollbackError ? rollbackError.message : null
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        customer: createdCustomer,
        onboarding: createdOnboarding
      })
    };
  } catch (error) {
    console.error('Failed to create customer', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to create customer',
        details: error && error.message ? error.message : 'Unknown error'
      })
    };
  }
};
