'use strict';

const { STATUS, normalizeCustomerStatus, normalizeOnboardingStatus, assertOnboardingTransition } = require('./status-model');

class OfferAcceptanceError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'OfferAcceptanceError';
    this.statusCode = Number(statusCode) || 500;
    this.details = details || null;
  }
}

function offerAddressLine(offer) {
  return [offer.street, offer.postal_code, offer.city, offer.country]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(', ');
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

function parseDurationMonths(raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.trunc(parsed);
  if (rounded <= 0) return null;
  return rounded;
}

function validateOfferForAcceptance(offer) {
  const required = [
    ['customer_id', offer.customer_id],
    ['plan', offer.plan],
    ['billing_cycle', offer.billing_cycle],
    ['duration_months', offer.duration_months]
  ];
  const missing = required
    .filter(([, value]) => String(value == null ? '' : value).trim() === '')
    .map(([field]) => field);
  if (missing.length) {
    throw new OfferAcceptanceError(409, `Offerte kann nicht akzeptiert werden: Pflichtfelder fehlen (${missing.join(', ')}).`);
  }
  const durationMonths = parseDurationMonths(offer.duration_months);
  if (!durationMonths) {
    throw new OfferAcceptanceError(409, 'Offerte kann nicht akzeptiert werden: duration_months fehlt oder ist ungültig.');
  }
  return { durationMonths };
}

async function ensureContractForOffer({ sbAdmin, offer, nowIso }) {
  const { durationMonths } = validateOfferForAcceptance(offer);
  const startDate = nowIso.slice(0, 10);
  const endDate = addMonths(startDate, durationMonths);
  const cancellationDate = addMonths(startDate, Math.max(durationMonths - 1, 0));

  let existing = null;
  if (offer.contract_id) {
    const byId = await sbAdmin.from('contracts').select('*').eq('id', offer.contract_id).maybeSingle();
    if (byId.error) throw new OfferAcceptanceError(500, 'Contract lookup failed.', byId.error.message);
    existing = byId.data || null;
  }

  if (!existing) {
    const byOffer = await sbAdmin
      .from('contracts')
      .select('*')
      .eq('offer_id', offer.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byOffer.error) throw new OfferAcceptanceError(500, 'Contract lookup failed.', byOffer.error.message);
    existing = byOffer.data || null;
  }

  if (existing) {
    const existingDuration = parseDurationMonths(existing.duration_months ?? existing.months);
    const patch = {
      customer_id: offer.customer_id || null,
      customer_name: offer.company_name || '',
      plan: offer.plan,
      billing_cycle: offer.billing_cycle,
      duration_months: durationMonths,
      months: durationMonths,
      start_date: existing.start_date || startDate,
      end_date: existing.end_date || endDate,
      cancellation_date: existing.cancellation_date || cancellationDate,
      updated_at: nowIso
    };
    const needsPatch = (
      String(existing.plan || '') !== String(offer.plan || '')
      || String(existing.billing_cycle || '') !== String(offer.billing_cycle || '')
      || existingDuration !== durationMonths
      || String(existing.customer_id || '') !== String(offer.customer_id || '')
      || String(existing.offer_id || '') !== String(offer.id || '')
    );
    if (needsPatch) {
      const patchRes = await sbAdmin.from('contracts').update(patch).eq('id', existing.id);
      if (patchRes.error) throw new OfferAcceptanceError(500, 'Contract sync failed.', patchRes.error.message);
    }
    if (String(existing.offer_id || '') !== String(offer.id || '')) {
      const relinkRes = await sbAdmin.from('contracts').update({ offer_id: offer.id, updated_at: nowIso }).eq('id', existing.id);
      if (relinkRes.error) throw new OfferAcceptanceError(500, 'Contract link failed.', relinkRes.error.message);
    }
    return String(existing.id);
  }

  const contractPayload = {
    customer_id: offer.customer_id || null,
    customer_name: offer.company_name || '',
    offer_id: offer.id,
    plan: offer.plan,
    billing_cycle: offer.billing_cycle,
    duration_months: durationMonths,
    months: durationMonths,
    start_date: startDate,
    end_date: endDate,
    cancellation_date: cancellationDate,
    discount: Math.round(Number(offer.discount_percent || 0)),
    cancellation_notice: '1 Monat',
    notes: `Automatisch erstellt aus Offerte ${offer.offer_number}`,
    status: 'draft',
    contract_text: generateContractText({ offer, startDate, cancellationDate })
  };
  const createRes = await sbAdmin.from('contracts').insert(contractPayload).select('*').single();
  if (createRes.error) throw new OfferAcceptanceError(500, 'Contract create failed.', createRes.error.message);
  return String(createRes.data.id);
}

async function syncPostAcceptanceLifecycle({ sbAdmin, offer, nowIso }) {
  if (!offer.customer_id) return;

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
    return;
  }

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

async function acceptOfferAndEnsureContract({ sbAdmin, offer, nowIso, acceptanceMeta = null }) {
  const status = String(offer.status || '').toLowerCase();
  if (status === 'rejected') throw new OfferAcceptanceError(409, 'Offerte wurde bereits abgelehnt.');
  if (status === 'expired') throw new OfferAcceptanceError(409, 'Offerte ist abgelaufen.');

  if (!offer.customer_id) {
    throw new OfferAcceptanceError(409, 'Diese Offerte ist noch keinem Kunden zugeordnet und kann nicht automatisch verarbeitet werden.');
  }

  if (offer.accepted_at && offer.contract_id) {
    return {
      duplicate: true,
      offerId: String(offer.id),
      contractId: String(offer.contract_id),
      acceptedAt: offer.accepted_at
    };
  }

  const contractId = await ensureContractForOffer({ sbAdmin, offer, nowIso });

  const offerPatch = {
    status: 'accepted',
    contract_id: contractId,
    accepted_at: offer.accepted_at || nowIso,
    updated_at: nowIso
  };
  if (acceptanceMeta && typeof acceptanceMeta === 'object') {
    if (Object.prototype.hasOwnProperty.call(acceptanceMeta, 'accepted_by_name')) offerPatch.accepted_by_name = acceptanceMeta.accepted_by_name;
    if (Object.prototype.hasOwnProperty.call(acceptanceMeta, 'accepted_by_email')) offerPatch.accepted_by_email = acceptanceMeta.accepted_by_email;
    if (Object.prototype.hasOwnProperty.call(acceptanceMeta, 'accepted_ip')) offerPatch.accepted_ip = acceptanceMeta.accepted_ip;
  }

  const offerRes = await sbAdmin
    .from('offers')
    .update(offerPatch)
    .eq('id', offer.id)
    .select('*')
    .single();

  if (offerRes.error) throw new OfferAcceptanceError(500, 'Offerte konnte nicht akzeptiert werden.', offerRes.error.message);

  await syncPostAcceptanceLifecycle({ sbAdmin, offer: offerRes.data, nowIso });

  return {
    duplicate: false,
    offerId: String(offer.id),
    contractId,
    acceptedAt: offerRes.data.accepted_at || nowIso,
    offer: offerRes.data
  };
}

module.exports = {
  OfferAcceptanceError,
  acceptOfferAndEnsureContract
};
