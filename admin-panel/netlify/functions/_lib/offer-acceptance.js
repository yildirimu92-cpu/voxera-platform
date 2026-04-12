'use strict';

const { STATUS, normalizeCustomerStatus, normalizeOnboardingStatus, assertOnboardingTransition } = require('./status-model');
const { createInitialContractInvoice } = require('./invoice-service');

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

function normalizeText(raw) {
  const value = String(raw || '').trim();
  return value || null;
}

function normalizeEmail(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return value || null;
}

function prospectNameFromOffer(offer) {
  const companyName = normalizeText(offer.company_name);
  if (companyName) return companyName;
  const contactName = normalizeText(offer.contact_name);
  if (contactName) return contactName;
  const firstName = normalizeText(offer.first_name || offer.contact_first_name);
  const lastName = normalizeText(offer.last_name || offer.contact_last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;
  return `Prospect ${String(offer.offer_number || offer.id || '').trim() || 'Offerte'}`;
}

function generateCustomerId() {
  return `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function findExistingCustomerForOffer({ sbAdmin, offer }) {
  const email = normalizeEmail(offer.email);
  if (email) {
    const byEmail = await sbAdmin.from('customers').select('*').ilike('email', email).limit(2);
    if (byEmail.error) throw new OfferAcceptanceError(500, 'Kunde konnte nicht aufgelöst werden (E-Mail Lookup).', byEmail.error.message);
    if (Array.isArray(byEmail.data) && byEmail.data.length > 1) {
      throw new OfferAcceptanceError(409, 'Mehrdeutiger Duplikat-Treffer per E-Mail. Bitte Kunde manuell zuordnen.');
    }
    if (Array.isArray(byEmail.data) && byEmail.data[0]) return byEmail.data[0];
  }

  const companyName = normalizeText(offer.company_name);
  if (companyName) {
    const byCompany = await sbAdmin.from('customers').select('*').ilike('customer_name', companyName).limit(2);
    if (byCompany.error) throw new OfferAcceptanceError(500, 'Kunde konnte nicht aufgelöst werden (Firmenname Lookup).', byCompany.error.message);
    if (Array.isArray(byCompany.data) && byCompany.data.length > 1) {
      throw new OfferAcceptanceError(409, 'Mehrdeutiger Duplikat-Treffer per Firmenname. Bitte Kunde manuell zuordnen.');
    }
    if (Array.isArray(byCompany.data) && byCompany.data[0]) return byCompany.data[0];
  }

  return null;
}

async function resolveOrCreateCustomerForOffer({ sbAdmin, offer, nowIso }) {
  if (offer.customer_id) return offer;

  const existingCustomer = await findExistingCustomerForOffer({ sbAdmin, offer });
  let customerId = existingCustomer?.id ? String(existingCustomer.id) : null;

  if (!customerId) {
    const customerName = prospectNameFromOffer(offer);
    const street = normalizeText(offer.street);
    const zip = normalizeText(offer.zip || offer.postal_code);
    const city = normalizeText(offer.city);
    const country = normalizeText(offer.country);
    if (!street || !zip || !city || !country) {
      throw new OfferAcceptanceError(409, 'Kunde kann nicht automatisch erstellt werden: Adressdaten in der Offerte unvollständig.');
    }

    const insertPayload = {
      id: generateCustomerId(),
      customer_name: customerName,
      email: normalizeEmail(offer.email),
      tel_nr: normalizeText(offer.phone),
      plan: normalizeText(offer.plan) || 'professional',
      street,
      zip,
      city,
      country,
      contact_first_name: normalizeText(offer.first_name || offer.contact_first_name),
      contact_last_name: normalizeText(offer.last_name || offer.contact_last_name),
      contact_name: normalizeText(offer.contact_name),
      status: STATUS.customer.ONBOARDING,
      invite_status: STATUS.access.NOT_SENT,
      welcome_sent: false,
      created_at: nowIso,
      updated_at: nowIso
    };
    const created = await sbAdmin.from('customers').insert(insertPayload).select('id').single();
    if (created.error) {
      if (String(created.error.code || '') === '23505') {
        const retry = await findExistingCustomerForOffer({ sbAdmin, offer });
        customerId = retry?.id ? String(retry.id) : null;
        if (!customerId) {
          throw new OfferAcceptanceError(409, 'Kunde existiert bereits, konnte aber nicht eindeutig aufgelöst werden.', created.error.message);
        }
      } else {
        throw new OfferAcceptanceError(500, 'Kunde konnte nicht automatisch erstellt werden.', created.error.message);
      }
    } else {
      customerId = String(created.data.id);
    }
  }

  const offerLink = await sbAdmin
    .from('offers')
    .update({ customer_id: customerId, updated_at: nowIso })
    .eq('id', offer.id)
    .select('*')
    .single();
  if (offerLink.error) {
    throw new OfferAcceptanceError(500, 'Offerte konnte nicht mit Kunde verknüpft werden.', offerLink.error.message);
  }
  return offerLink.data;
}

function validateOfferForAcceptance(offer) {
  const required = [
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
      status: 'accepted',
      duration_months: durationMonths,
      months: durationMonths,
      start_date: existing.start_date || startDate,
      end_date: existing.end_date || endDate,
      cancellation_date: existing.cancellation_date || cancellationDate,
      updated_at: nowIso
    };
    const needsPatch = (
      String(existing.plan || '') !== String(offer.plan || '')
      || existingDuration !== durationMonths
      || String(existing.customer_id || '') !== String(offer.customer_id || '')
      || String(existing.offer_id || '') !== String(offer.id || '')
      || String(existing.status || '') !== 'accepted'
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
    duration_months: durationMonths,
    months: durationMonths,
    start_date: startDate,
    end_date: endDate,
    cancellation_date: cancellationDate,
    discount: Math.round(Number(offer.discount_percent || 0)),
    cancellation_notice: '1 Monat',
    notes: `Automatisch erstellt aus Offerte ${offer.offer_number}`,
    status: 'accepted',
    contract_text: generateContractText({ offer, startDate, cancellationDate })
  };
  const createRes = await sbAdmin.from('contracts').insert(contractPayload).select('*').single();
  if (createRes.error) {
    console.error('ensureContractForOffer: contract insert failed', {
      offer_id: offer.id,
      contract_payload: contractPayload,
      db_error: {
        message: createRes.error.message || null,
        code: createRes.error.code || null,
        details: createRes.error.details || null,
        hint: createRes.error.hint || null
      }
    });
    throw new OfferAcceptanceError(
      500,
      `Contract create failed: ${createRes.error.message || 'unknown database error'}`,
      {
        message: createRes.error.message || null,
        code: createRes.error.code || null,
        details: createRes.error.details || null,
        hint: createRes.error.hint || null
      }
    );
  }
  return String(createRes.data.id);
}

function resolveFirstMonthAmount(offer) {
  const monthly = Number(offer.monthly_price || 0);
  if (Number.isFinite(monthly) && monthly > 0) return Number(monthly.toFixed(2));
  const yearly = Number(offer.yearly_price || 0);
  if (Number.isFinite(yearly) && yearly > 0) return Number((yearly / 12).toFixed(2));
  return 0;
}

async function ensureInitialInvoiceForOffer({ sbAdmin, offer, contractId, nowIso }) {
  if (!offer?.customer_id || !contractId) return { invoiceId: null, duplicate: false };

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('*')
    .eq('id', offer.customer_id)
    .maybeSingle();
  if (customerError) throw new OfferAcceptanceError(500, 'Customer lookup for initial invoice failed.', customerError.message);
  if (!customer) throw new OfferAcceptanceError(409, 'Kunde für Offerte konnte nicht geladen werden.');

  const setupFeeAmount = Number(offer.setup_fee || 0);
  const firstMonthAmount = resolveFirstMonthAmount(offer);
  const initial = await createInitialContractInvoice({
    sbAdmin,
    customer,
    contractId,
    subscription: null,
    setupFeeAmount,
    firstMonthAmount,
    dueAt: null,
    notes: `Initial invoice (setup fee + first month) for accepted offer ${offer.offer_number || offer.id}`
  });
  const invoice = initial.invoice || null;
  if (!invoice?.id) return { invoiceId: null, duplicate: Boolean(initial.duplicate) };

  await sbAdmin
    .from('invoices')
    .update({
      offer_id: offer.id,
      contract_id: contractId,
      updated_at: nowIso
    })
    .eq('id', invoice.id);

  await sbAdmin
    .from('offers')
    .update({ invoice_id: invoice.id, updated_at: nowIso })
    .eq('id', offer.id);

  if (String(customer.payment_status || '').trim().toLowerCase() !== 'paid') {
    const customerInviteStatus = String(customer.invite_status || '').trim().toLowerCase();
    const shouldResetInvite = customerInviteStatus !== 'activated' && customerInviteStatus !== 'sent';
    await sbAdmin
      .from('customers')
      .update({
        payment_status: 'pending',
        invite_status: shouldResetInvite ? STATUS.access.NOT_SENT : customer.invite_status,
        welcome_sent: shouldResetInvite ? false : customer.welcome_sent,
        welcome_sent_at: shouldResetInvite ? null : customer.welcome_sent_at,
        payment_received_at: null,
        updated_at: nowIso
      })
      .eq('id', customer.id);
  }

  return { invoiceId: String(invoice.id), duplicate: Boolean(initial.duplicate) };
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
      next_step: 'Rechnung manuell versenden und Zahlungseingang abwarten',
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
    next_step: onboarding.next_step || 'Rechnung manuell versenden und Zahlungseingang abwarten',
    updated_at: nowIso
  }).eq('id', onboarding.id);
}

async function acceptOfferAndEnsureContract({ sbAdmin, offer, nowIso, acceptanceMeta = null, allowContractFailure = false }) {
  const status = String(offer.status || '').toLowerCase();
  if (status === 'rejected') throw new OfferAcceptanceError(409, 'Offerte wurde bereits abgelehnt.');
  if (status === 'expired') throw new OfferAcceptanceError(409, 'Offerte ist abgelaufen.');

  const offerWithCustomer = await resolveOrCreateCustomerForOffer({ sbAdmin, offer, nowIso });

  if (offerWithCustomer.accepted_at && offerWithCustomer.contract_id) {
    return {
      duplicate: true,
      offerId: String(offerWithCustomer.id),
      contractId: String(offerWithCustomer.contract_id),
      acceptedAt: offerWithCustomer.accepted_at
    };
  }

  let contractId = null;
  let contractError = null;
  try {
    contractId = await ensureContractForOffer({ sbAdmin, offer: offerWithCustomer, nowIso });
  } catch (err) {
    if (!allowContractFailure) throw err;
    contractError = err;
    console.error('acceptOfferAndEnsureContract: contract creation/sync failed after acceptance intent', {
      offer_id: offer.id,
      error: err?.message || String(err),
      details: err?.details || null
    });
  }

  const offerPatch = {
    status: 'accepted',
    accepted_at: offer.accepted_at || nowIso,
    updated_at: nowIso
  };
  if (contractId) offerPatch.contract_id = contractId;
  if (acceptanceMeta && typeof acceptanceMeta === 'object') {
    if (Object.prototype.hasOwnProperty.call(acceptanceMeta, 'accepted_by_name')) offerPatch.accepted_by_name = acceptanceMeta.accepted_by_name;
    if (Object.prototype.hasOwnProperty.call(acceptanceMeta, 'accepted_by_email')) offerPatch.accepted_by_email = acceptanceMeta.accepted_by_email;
    if (Object.prototype.hasOwnProperty.call(acceptanceMeta, 'accepted_ip')) offerPatch.accepted_ip = acceptanceMeta.accepted_ip;
  }

  const offerRes = await sbAdmin
    .from('offers')
    .update(offerPatch)
    .eq('id', offerWithCustomer.id)
    .select('*')
    .single();

  if (offerRes.error) throw new OfferAcceptanceError(500, 'Offerte konnte nicht akzeptiert werden.', offerRes.error.message);

  let initialInvoice = { invoiceId: null, duplicate: false };
  let invoiceError = null;
  if (contractId) {
    try {
      initialInvoice = await ensureInitialInvoiceForOffer({
        sbAdmin,
        offer: offerRes.data,
        contractId,
        nowIso
      });
    } catch (err) {
      invoiceError = err;
      console.error('acceptOfferAndEnsureContract: initial invoice creation failed after acceptance commit', {
        offer_id: offer.id,
        contract_id: contractId,
        error: err?.message || String(err),
        details: err?.details || null
      });
    }
  }

  let lifecycleError = null;
  try {
    await syncPostAcceptanceLifecycle({ sbAdmin, offer: offerRes.data, nowIso });
  } catch (err) {
    lifecycleError = err;
    console.error('acceptOfferAndEnsureContract: lifecycle sync failed after acceptance commit', {
      offer_id: offer.id,
      customer_id: offerRes.data?.customer_id || null,
      error: err?.message || String(err)
    });
  }

  return {
    duplicate: false,
    offerId: String(offerWithCustomer.id),
    contractId,
    contractError: contractError
      ? {
        message: contractError.message || 'Contract creation failed.',
        details: contractError.details || null
      }
      : null,
    invoiceError: invoiceError
      ? {
        message: invoiceError.message || 'Initial invoice creation failed.'
      }
      : null,
    lifecycleError: lifecycleError
      ? {
        message: lifecycleError.message || 'Post-acceptance lifecycle sync failed.'
      }
      : null,
    acceptedAt: offerRes.data.accepted_at || nowIso,
    offer: offerRes.data,
    invoiceId: initialInvoice.invoiceId,
    invoiceDuplicate: initialInvoice.duplicate
  };
}

module.exports = {
  OfferAcceptanceError,
  acceptOfferAndEnsureContract
};
