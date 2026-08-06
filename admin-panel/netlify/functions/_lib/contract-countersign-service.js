'use strict';

// Core Gegenzeichnung-Logik, geteilt zwischen contract-countersign.js (manueller
// Mail-Fall: Admin bestätigt einen per Link digital signierten Vertrag) und
// contract-onsite-complete.js (Vor-Ort-Fall: gleicher Schritt läuft als Teil
// einer einzigen serverseitigen Kette). Gates/Verhalten bleiben unverändert -
// nur der Aufrufer ändert sich.

function trimOrNull(value) {
  const normalized = String(value == null ? '' : value).trim();
  return normalized || null;
}

function generatePublicToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 48; i += 1) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
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

class CountersignError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'CountersignError';
    this.statusCode = Number(statusCode) || 500;
  }
}

async function countersignContract({ sbAdmin, contractId, countersignName, countersignatureData, actorUserId }) {
  if (!contractId) throw new CountersignError(400, 'contract_id fehlt.');
  if (!countersignName) throw new CountersignError(400, 'countersign_name fehlt.');
  if (!countersignatureData) throw new CountersignError(400, 'countersignature_data fehlt.');

  const { data: contract, error: loadError } = await sbAdmin
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .single();

  if (loadError || !contract) {
    throw new CountersignError(404, 'Vertrag nicht gefunden.');
  }
  if (contract.countersigned_at) {
    throw new CountersignError(409, 'Vertrag wurde bereits gegengezeichnet.');
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
    const wrapped = new CountersignError(500, 'Gegenzeichnung konnte nicht gespeichert werden.');
    wrapped.details = updateError.message;
    throw wrapped;
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
      requested_by: actorUserId || null,
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

  return {
    contract_id: contractId,
    countersigned_at: nowIso,
    public_token: publicToken,
    signed_page_url: signedPageUrl,
    signed_pdf_url: signedPdfUrl,
    mail_delivery: mailDelivery
  };
}

module.exports = {
  CountersignError,
  countersignContract,
  generatePublicToken,
  resolveSignedPdfUrl,
  contractFilename,
  dispatchContractMail,
  trimOrNull
};
