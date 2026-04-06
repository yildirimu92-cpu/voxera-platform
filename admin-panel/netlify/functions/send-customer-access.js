const { createClient } = require('@supabase/supabase-js');
const { STATUS, normalizeCustomerStatus, assertCustomerTransition } = require('./_lib/status-model');
const { requireAdminCaller } = require('./_lib/require-admin');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const REQUIRED_FIELDS = ['customer_name', 'email', 'street', 'zip', 'city', 'country', 'plan'];

function response(statusCode, payload) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(payload)
  };
}

async function deliverCustomerAccess({ sbAdmin, customer, activationLink }) {
  const webhookUrl = process.env.MAKE_WELCOME_WEBHOOK;
  if (!webhookUrl) {
    return {
      ok: false,
      statusCode: 500,
      error: 'Versand-Infrastruktur fehlt: MAKE_WELCOME_WEBHOOK ist nicht gesetzt.',
      limitation: 'Aktivierungslink wurde erstellt, aber kein E-Mail-Versand ausgelöst.'
    };
  }

  let webhookResponse;
  try {
    webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: customer.customer_name,
        email: customer.email,
        activation_link: activationLink,
        plan: customer.plan,
        voxera_number: customer.voxera_number,
        customer_id: customer.id,
        dashboard_url: process.env.DASHBOARD_URL || 'https://dashboard.voxera.ch'
      })
    });
  } catch (error) {
    console.error('Webhook call failed', error);
    return {
      ok: false,
      statusCode: 500,
      error: 'Versand der Zugangsdaten ist fehlgeschlagen.',
      details: error.message
    };
  }

  if (!webhookResponse.ok) {
    console.error('Webhook returned non-OK status', webhookResponse.status);
    return {
      ok: false,
      statusCode: 500,
      error: `Versand der Zugangsdaten ist fehlgeschlagen (HTTP ${webhookResponse.status}).`
    };
  }

  return { ok: true };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { error: 'Method not allowed' });
  }

  console.log('ENV:', process.env.SUPABASE_URL ? 'OK' : 'MISSING');

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbServiceKey || !sbAnonKey) {
    console.error('Missing Supabase environment variables', {
      SUPABASE_URL: !!sbUrl,
      SUPABASE_SERVICE_ROLE_KEY: !!sbServiceKey,
      SUPABASE_ANON_KEY: !!sbAnonKey
    });
    return response(500, {
      error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.'
    });
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
    return response(caller.statusCode, caller.body);
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    console.error('Invalid JSON request body', error);
    return response(400, { error: 'Ungueltiger Request Body' });
  }

  const customerId = String(body.customer_id || '').trim();
  if (!customerId) {
    console.error('Validation failed: customer_id missing');
    return response(400, { error: 'customer_id fehlt' });
  }
  const action = String(body.action || '').trim().toLowerCase();

  try {
    const { data: customer, error: customerError } = await sbAdmin
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      console.error('Customer lookup failed', customerError);
      return response(400, { error: 'Kunde nicht gefunden' });
    }

    if (action === 'mark_activated') {
      const currentStatus = normalizeCustomerStatus(customer.status);
      if (currentStatus !== STATUS.customer.ACTIVATED) {
        assertCustomerTransition(currentStatus, STATUS.customer.ACTIVATED);
      }
      const nowIso = new Date().toISOString();
      const { data: activatedCustomer, error: activatedUpdateError } = await sbAdmin
        .from('customers')
        .update({
          status: STATUS.customer.ACTIVATED,
          invite_status: STATUS.access.ACTIVATED,
          updated_at: nowIso
        })
        .eq('id', customerId)
        .select('*')
        .single();

      if (activatedUpdateError) {
        console.error('Customer activation hook failed', activatedUpdateError);
        return response(500, {
          error: 'Kundenstatus konnte nicht auf aktiviert gesetzt werden.',
          details: activatedUpdateError.message
        });
      }

      return response(200, {
        success: true,
        message: 'Customer lifecycle status auf aktiviert gesetzt.',
        customer: activatedCustomer
      });
    }

    const missingFields = REQUIRED_FIELDS.filter((field) => !String(customer[field] || '').trim());
    if (missingFields.length > 0) {
      console.error('Validation failed: required customer fields missing', { customerId, missingFields });
      return response(400, {
        error: 'Pflichtdaten fehlen. Zugang kann nicht gesendet werden.',
        missing_fields: missingFields
      });
    }

    const { data: onboardingRow, error: onboardingLookupError } = await sbAdmin
      .from('onboarding')
      .select('id, status, progress')
      .eq('customer_id', customerId)
      .maybeSingle();

    if (onboardingLookupError) {
      console.error('Onboarding lookup failed', onboardingLookupError);
      return response(500, {
        error: 'Onboarding-Daten konnten nicht geladen werden.',
        details: onboardingLookupError.message
      });
    }

    if (
      onboardingRow &&
      String(onboardingRow.status || '').toLowerCase() === 'ready' &&
      missingFields.length === 0 &&
      normalizeCustomerStatus(customer.status) !== STATUS.customer.READY
    ) {
      const nowIso = new Date().toISOString();
      const { data: readyCustomer, error: readyUpdateError } = await sbAdmin
        .from('customers')
        .update({
          status: 'ready',
          updated_at: nowIso
        })
        .eq('id', customerId)
        .select('*')
        .single();

      if (readyUpdateError) {
        console.error('Customer readiness lifecycle sync failed', readyUpdateError);
      } else if (readyCustomer) {
        customer.status = readyCustomer.status;
      }
    }

    const currentStatus = normalizeCustomerStatus(customer.status);
    if (currentStatus !== STATUS.customer.READY) {
      console.error('Customer lifecycle status not ready – access send blocked', {
        customerId,
        customer_status: customer.status || null
      });
      return response(409, {
        error: 'Zugang kann erst gesendet werden, wenn der Kundenstatus auf ready steht.',
        customer_status: customer.status || null
      });
    }

    const activateUrl = process.env.ACTIVATE_URL || 'https://dashboard.voxera.ch/activate';
    const { data: linkData, error: linkError } = await sbAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: customer.email,
      options: { redirectTo: activateUrl }
    });

    const activationLink = linkData?.properties?.action_link;
    if (linkError || !activationLink) {
      console.error('Activation link generation failed', linkError);
      return response(500, {
        error: 'Aktivierungslink konnte nicht erstellt werden.',
        details: linkError?.message || 'Kein action_link von Supabase erhalten.'
      });
    }

    const deliveryResult = await deliverCustomerAccess({ sbAdmin, customer, activationLink });
    if (!deliveryResult.ok) {
      console.error('Access delivery failed', deliveryResult);
      return response(deliveryResult.statusCode || 500, {
        error: deliveryResult.error,
        details: deliveryResult.details || null,
        limitation: deliveryResult.limitation || null
      });
    }

    assertCustomerTransition(currentStatus, STATUS.customer.INVITED);

    const nowIso = new Date().toISOString();
    const { data: updatedCustomer, error: updateError } = await sbAdmin
      .from('customers')
      .update({
        invite_status: STATUS.access.SENT,
        welcome_sent: true,
        welcome_sent_at: nowIso,
        status: STATUS.customer.INVITED,
        updated_at: nowIso
      })
      .eq('id', customerId)
      .select('*')
      .single();

    if (updateError) {
      console.error('Customer update after access send failed', updateError);
      return response(500, {
        error: 'Kundenstatus konnte nach Versand nicht aktualisiert werden.',
        details: updateError.message
      });
    }

    let onboardingUpdated = false;
    if (onboardingRow?.id) {
      const currentProgress = Number(onboardingRow.progress || 0);
      const nextProgress = Math.min(90, Math.max(currentProgress, currentProgress + 10));
      const { error: onboardingUpdateError } = await sbAdmin
        .from('onboarding')
        .update({
          next_step: 'Kunde aktiviert Zugang',
          progress: nextProgress,
          updated_at: nowIso
        })
        .eq('id', onboardingRow.id);

      if (onboardingUpdateError) {
        console.error('Onboarding update failed', onboardingUpdateError);
      } else {
        onboardingUpdated = true;
      }
    }

    return response(200, {
      success: true,
      message: 'Zugangsdaten wurden versendet.',
      customer: updatedCustomer,
      onboarding_updated: onboardingUpdated,
      next_step: onboardingUpdated ? 'Kunde aktiviert Zugang' : null
    });
  } catch (error) {
    console.error('Unhandled error in send-customer-access', error);
    return response(500, {
      error: 'Fehler beim Senden des Zugangs',
      details: error.message
    });
  }
};
