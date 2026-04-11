'use strict';

const { createClient } = require('@supabase/supabase-js');
const { STATUS, normalizeCustomerStatus, normalizeOnboardingStatus, assertOnboardingTransition } = require('./_lib/status-model');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function parseBody(event) {
  try { return JSON.parse(event.body || '{}'); } catch (_e) { return null; }
}

function isOfferExpired(offer) {
  const expiry = offer.public_expires_at || (offer.valid_until ? `${String(offer.valid_until).slice(0, 10)}T23:59:59.999Z` : null);
  if (!expiry) return false;
  return new Date(expiry).getTime() < Date.now();
}

function offerAddressLine(offer) {
  return [offer.street, offer.postal_code, offer.city, offer.country].map(v => String(v || '').trim()).filter(Boolean).join(', ');
}

function planLabel(plan) {
  const key = String(plan || '').toLowerCase();
  if (key === 'starter') return 'Starter';
  if (key === 'business') return 'Business';
  if (key === 'professional') return 'Professional';
  return plan || 'Plan';
}

function generateContractText({ offer, startDate, cancellationDate }) {
  const customerName = offer.company_name || 'Kunde';
  const customerAddress = offerAddressLine(offer) || '[Adresse]';
  return [
    'DIENSTLEISTUNGSVERTRAG',
    '',
    `Kunde: ${customerName}`,
    `Adresse: ${customerAddress}`,
    `Plan: ${planLabel(offer.plan)}`,
    `Vertragsbeginn: ${startDate}`,
    `Kündigung bis: ${cancellationDate}`,
    `Offerte: ${offer.offer_number}`,
    '',
    'Dieser Vertrag wurde aus einer digital akzeptierten Voxera-Offerte erstellt.'
  ].join('\n');
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbServiceKey) return response(500, { error: 'Supabase config missing.' });

  const body = parseBody(event);
  if (!body) return response(400, { error: 'Ungültiger Request Body.' });

  const token = String(body.token || '').trim();
  const signerName = String(body.signer_name || '').trim();
  const signerEmail = String(body.signer_email || '').trim();
  const confirmAccepted = body.confirm_accepted === true;

  if (!token) return response(400, { error: 'token fehlt.' });
  if (!signerName) return response(400, { error: 'signer_name fehlt.' });
  if (!confirmAccepted) return response(400, { error: 'Bestätigung ist erforderlich.' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: offer, error: offerErr } = await sbAdmin
    .from('offers')
    .select('*')
    .eq('public_token', token)
    .maybeSingle();

  if (offerErr) return response(500, { error: 'Offer lookup failed.', details: offerErr.message });
  if (!offer) return response(404, { error: 'Offerte nicht gefunden.' });

  const status = String(offer.status || '').toLowerCase();
  if (status === 'rejected') return response(409, { error: 'Offerte wurde bereits abgelehnt.' });
  if (status === 'expired' || isOfferExpired(offer)) return response(409, { error: 'Offerte ist abgelaufen.' });
  if (!offer.customer_id) return response(409, { error: 'Diese Offerte ist noch keinem Kunden zugeordnet und kann nicht automatisch verarbeitet werden.' });

  if (offer.accepted_at && offer.contract_id) {
    return response(200, {
      success: true,
      duplicate: true,
      offer_id: offer.id,
      contract_id: offer.contract_id,
      accepted_at: offer.accepted_at
    });
  }

  const nowIso = new Date().toISOString();
  const ip = String(event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;

  const offerPatch = {
    status: 'accepted',
    accepted_at: offer.accepted_at || nowIso,
    accepted_by_name: signerName,
    accepted_by_email: signerEmail || null,
    accepted_ip: ip,
    updated_at: nowIso
  };

  const { data: acceptedOffer, error: acceptErr } = await sbAdmin
    .from('offers')
    .update(offerPatch)
    .eq('id', offer.id)
    .select('*')
    .single();

  if (acceptErr) return response(500, { error: 'Offerte konnte nicht akzeptiert werden.', details: acceptErr.message });

  let contractId = acceptedOffer.contract_id || null;
  if (!contractId) {
    const startDate = nowIso.slice(0, 10);
    const endDate = addMonths(startDate, 12);
    const cancellationDate = addMonths(startDate, 11);

    const existingContractRes = await sbAdmin
      .from('contracts')
      .select('*')
      .eq('offer_id', offer.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingContractRes.error) {
      return response(500, { error: 'Contract lookup failed.', details: existingContractRes.error.message });
    }

    if (existingContractRes.data) {
      contractId = existingContractRes.data.id;
    } else {
      const contractPayload = {
        customer_id: offer.customer_id || null,
        customer_name: offer.company_name || '',
        offer_id: offer.id,
        plan: offer.plan,
        months: 12,
        start_date: startDate,
        end_date: endDate,
        cancellation_date: cancellationDate,
        discount: Math.round(Number(offer.discount_percent || 0)),
        cancellation_notice: '1 Monat',
        notes: `Automatisch erstellt aus Offerte ${offer.offer_number}`,
        status: 'draft',
        contract_text: generateContractText({ offer, startDate, cancellationDate })
      };
      const { data: createdContract, error: contractErr } = await sbAdmin
        .from('contracts')
        .insert(contractPayload)
        .select('*')
        .single();
      if (contractErr) return response(500, { error: 'Contract create failed.', details: contractErr.message });
      contractId = createdContract.id;
    }

    await sbAdmin
      .from('offers')
      .update({ contract_id: contractId, updated_at: nowIso })
      .eq('id', offer.id);
  }

  if (offer.customer_id) {
    const { data: customer } = await sbAdmin
      .from('customers')
      .select('id, status')
      .eq('id', offer.customer_id)
      .maybeSingle();

    if (customer) {
      const currentStatus = normalizeCustomerStatus(customer.status);
      if (!currentStatus || currentStatus === 'pending') {
        await sbAdmin.from('customers').update({ status: STATUS.customer.ONBOARDING, updated_at: nowIso }).eq('id', offer.customer_id);
      }
    }

    const { data: onboarding } = await sbAdmin
      .from('onboarding')
      .select('*')
      .eq('customer_id', offer.customer_id)
      .maybeSingle();

    if (!onboarding) {
      await sbAdmin.from('onboarding').insert({
        customer_id: offer.customer_id,
        status: STATUS.onboarding.IN_PROGRESS,
        progress: 10,
        next_step: 'Vertrag prüfen und Zugang vorbereiten',
        owner: 'Ops',
        updated_at: nowIso
      });
    } else {
      const current = normalizeOnboardingStatus(onboarding.status);
      let next = current;
      if (current === STATUS.onboarding.NOT_STARTED || current === STATUS.onboarding.BLOCKED) {
        try {
          assertOnboardingTransition(current, STATUS.onboarding.IN_PROGRESS);
          next = STATUS.onboarding.IN_PROGRESS;
        } catch (_e) {
          next = current;
        }
      }
      await sbAdmin.from('onboarding').update({
        status: next,
        progress: Math.max(Number(onboarding.progress || 0), 10),
        next_step: onboarding.next_step || 'Vertrag prüfen und Zugang vorbereiten',
        updated_at: nowIso
      }).eq('id', onboarding.id);
    }
  }

  return response(200, {
    success: true,
    offer_id: offer.id,
    contract_id: contractId,
    accepted_at: acceptedOffer.accepted_at || nowIso
  });
};
