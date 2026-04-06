const { createClient } = require('@supabase/supabase-js');

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

async function deliverCustomerAccess({ customer, activateUrl }) {
  const webhookUrl = process.env.MAKE_WELCOME_WEBHOOK;
  if (!webhookUrl) {
    console.error('Missing MAKE_WELCOME_WEBHOOK environment variable');
    return {
      ok: false,
      statusCode: 500,
      error: 'MAKE_WELCOME_WEBHOOK ist nicht gesetzt.'
    };
  }

  const payload = {
    customer_id: customer.id,
    customer_name: customer.customer_name,
    email: customer.email,
    plan: customer.plan,
    contact_name: String(customer.contact_name || '').trim() || null,
    activate_url: activateUrl
  };

  let webhookResponse;
  try {
    webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
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

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const webhookUrl = process.env.MAKE_WELCOME_WEBHOOK;
  console.log('ENV presence', {
    SUPABASE_URL: !!sbUrl,
    SUPABASE_SERVICE_ROLE_KEY: !!sbServiceKey,
    MAKE_WELCOME_WEBHOOK: !!webhookUrl,
    ACTIVATE_URL: !!process.env.ACTIVATE_URL
  });

  if (!sbUrl || !sbServiceKey) {
    console.error('Missing Supabase environment variables', {
      SUPABASE_URL: !!sbUrl,
      SUPABASE_SERVICE_ROLE_KEY: !!sbServiceKey
    });
    return response(500, {
      error: 'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.'
    });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

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
      const nowIso = new Date().toISOString();
      const { data: activatedCustomer, error: activatedUpdateError } = await sbAdmin
        .from('customers')
        .update({
          status: 'activated',
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

    const onboardingStatus = String(onboardingRow?.status || '').trim().toLowerCase();
    if (!onboardingRow || onboardingStatus !== 'ready') {
      console.error('Onboarding status not ready – access send blocked', {
        customerId,
        onboarding_status: onboardingRow?.status || null
      });
      return response(409, {
        error: 'Zugang kann erst gesendet werden, wenn onboarding.status auf ready steht.',
        onboarding_status: onboardingRow?.status || null
      });
    }

    if (!webhookUrl) {
      console.error('MAKE_WELCOME_WEBHOOK missing - cannot send access');
      return response(500, {
        error: 'MAKE_WELCOME_WEBHOOK ist nicht gesetzt.'
      });
    }

    const activateUrlBase = process.env.ACTIVATE_URL || 'https://dashboard.voxera.ch/activate';
    const activateUrl = `${activateUrlBase}${activateUrlBase.includes('?') ? '&' : '?'}customer_id=${encodeURIComponent(customer.id)}`;
    const deliveryResult = await deliverCustomerAccess({ customer, activateUrl });
    if (!deliveryResult.ok) {
      console.error('Access delivery failed', deliveryResult);
      return response(deliveryResult.statusCode || 500, {
        error: deliveryResult.error,
        details: deliveryResult.details || null,
        limitation: deliveryResult.limitation || null
      });
    }

    const nowIso = new Date().toISOString();
    const { data: updatedCustomer, error: updateError } = await sbAdmin
      .from('customers')
      .update({
        invite_status: 'sent',
        welcome_sent: true,
        welcome_sent_at: nowIso,
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
      onboarding: onboardingUpdated
        ? {
            id: onboardingRow.id,
            next_step: 'Kunde aktiviert Zugang',
            progress: Math.min(90, Math.max(Number(onboardingRow.progress || 0), Number(onboardingRow.progress || 0) + 10)),
            updated_at: nowIso
          }
        : null,
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
