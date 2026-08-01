'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const respond = (status, payload) => ({
  statusCode: status,
  headers: corsHeaders,
  body: JSON.stringify(payload)
});

function generatePublicToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 48; i += 1) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

function trimOrNull(value) {
  const normalized = String(value == null ? '' : value).trim();
  return normalized || null;
}

function resolveSignedPdfUrl(contract) {
  return trimOrNull(
    contract?.signed_pdf_url
      || contract?.contract_pdf_url
      || contract?.pdf_url
  );
}

function contractFilename(contract) {
  const customerName = trimOrNull(contract?.customer_name) || 'Kunde';
  const safeName = customerName
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'Kunde';
  return `Voxera-Vertrag-${safeName}.pdf`;
}

async function dispatchContractMail({ webhookUrl, payload }) {
  if (!webhookUrl) {
    return {
      attempted: false,
      accepted: false,
      status: null,
      error: 'MAKE_MAIL_WEBHOOK ist nicht konfiguriert.'
    };
  }

  try {
    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!webhookResponse.ok) {
      const responseText = await webhookResponse.text().catch(() => '');
      return {
        attempted: true,
        accepted: false,
        status: webhookResponse.status,
        error: `Make webhook failed: ${webhookResponse.status}`,
        response_excerpt: responseText.slice(0, 300) || null
      };
    }

    return {
      attempted: true,
      accepted: true,
      status: webhookResponse.status,
      error: null
    };
  } catch (error) {
    return {
      attempted: true,
      accepted: false,
      status: null,
      error: error?.message || 'Make webhook request failed.'
    };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbServiceKey || !sbAnonKey) {
    return respond(500, { error: 'Supabase-Konfiguration fehlt.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const caller = await requireAdminCaller({
    event,
    supabaseUrl: sbUrl,
    supabaseAnonKey: sbAnonKey,
    sbAdmin
  });
  if (!caller.ok) return respond(caller.statusCode, caller.body);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_error) {
    return respond(400, { error: 'Ungültiger Request Body.' });
  }

  const contractId = trimOrNull(body.contract_id);
  const countersignName = trimOrNull(body.countersign_name);
  const countersignatureData = trimOrNull(body.countersignature_data);

  if (!contractId) return respond(400, { error: 'contract_id fehlt.' });
  if (!countersignName) return respond(400, { error: 'countersign_name fehlt.' });
  if (!countersignatureData) {
    return respond(400, { error: 'countersignature_data fehlt.' });
  }

  const { data: contract, error: loadError } = await sbAdmin
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .single();

  if (loadError || !contract) {
    return respond(404, { error: 'Vertrag nicht gefunden.' });
  }
  if (contract.countersigned_at) {
    return respond(409, { error: 'Vertrag wurde bereits gegengezeichnet.' });
  }

  const nowIso = new Date().toISOString();
  const publicToken = generatePublicToken();

  const { error: updateError } = await sbAdmin
    .from('contracts')
    .update({
      countersigned_at: nowIso,
      countersign_name: countersignName,
      countersignature_data: countersignatureData,
      contract_public_token: publicToken,
      updated_at: nowIso
    })
    .eq('id', contractId);

  if (updateError) {
    return respond(500, {
      error: 'Gegenzeichnung konnte nicht gespeichert werden.',
      details: updateError.message
    });
  }

  if (contract.offer_id) {
    const { error: offerUpdateError } = await sbAdmin
      .from('offers')
      .update({ countersigned_at: nowIso, updated_at: nowIso })
      .eq('id', contract.offer_id);

    if (offerUpdateError) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'contract_countersign_offer_update_failed',
        contract_id: contractId,
        offer_id: contract.offer_id,
        error_message: offerUpdateError.message
      }));
    }
  }

  let customerEmail = null;
  let customerName = null;
  if (contract.customer_id) {
    const { data: customer, error: customerError } = await sbAdmin
      .from('customers')
      .select('email, customer_name, contact_name')
      .eq('id', contract.customer_id)
      .maybeSingle();

    if (customerError) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'contract_countersign_customer_lookup_failed',
        contract_id: contractId,
        customer_id: contract.customer_id,
        error_message: customerError.message
      }));
    } else if (customer) {
      customerEmail = trimOrNull(customer.email);
      customerName = trimOrNull(customer.contact_name)
        || trimOrNull(customer.customer_name);
    }
  }

  const publicBaseUrl = String(
    process.env.PUBLIC_SITE_URL || 'https://voxera.ch'
  ).replace(/\/+$/, '');
  const dashboardUrl = process.env.DASHBOARD_URL
    || 'https://dashboard.voxera.ch';
  const signedPageUrl = `${publicBaseUrl}/contract-signed.html?token=${publicToken}`;
  const signedPdfUrl = resolveSignedPdfUrl(contract);

  const payload = {
    event_type: 'contract_signed_email',
    mail_type: 'contract_signed_email',
    recipient: {
      email: customerEmail,
      name: customerName || trimOrNull(contract.customer_name) || 'Kunde'
    },
    dashboard_url: dashboardUrl,
    contract: {
      id: contract.id,
      customer_name: trimOrNull(contract.customer_name),
      plan: trimOrNull(contract.plan),
      start_date: contract.start_date || null,
      end_date: contract.end_date || null,
      duration_months: contract.duration_months || contract.months || null,
      countersigned_at: nowIso,
      countersign_name: countersignName,
      signed_page_url: signedPageUrl,
      signed_pdf_url: signedPdfUrl,
      filename: contractFilename(contract),
      public_token: publicToken
    },
    meta: {
      source: 'admin_panel',
      requested_at: nowIso,
      requested_by: caller.userId || null,
      legacy_mail_type: 'countersign_email'
    }
  };

  let mailDelivery = {
    attempted: false,
    accepted: false,
    status: null,
    error: customerEmail ? null : 'Kunden-E-Mail fehlt.'
  };

  if (customerEmail) {
    const webhookUrl = process.env.MAKE_MAIL_WEBHOOK
      || process.env.MAKE_COUNTERSIGN_WEBHOOK;
    mailDelivery = await dispatchContractMail({ webhookUrl, payload });
  }

  if (!mailDelivery.accepted) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'contract_signed_mail_not_accepted',
      contract_id: contractId,
      customer_id: contract.customer_id || null,
      mail_delivery: mailDelivery
    }));
  }

  return respond(200, {
    success: true,
    contract_id: contractId,
    countersigned_at: nowIso,
    public_token: publicToken,
    signed_page_url: signedPageUrl,
    signed_pdf_url: signedPdfUrl,
    mail_delivery: mailDelivery
  });
};
