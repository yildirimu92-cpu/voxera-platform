'use strict';

const { STATUS, normalizeCustomerStatus, normalizeOnboardingStatus, assertOnboardingTransition } = require('./status-model');
const { orchestrateContractBilling } = require('./contract-billing-orchestrator');

class OfferAcceptanceError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'OfferAcceptanceError';
    this.statusCode = Number(statusCode) || 500;
    this.details = details || null;
  }
}

function diagnosticFromError(step, error, context = {}) {
  return {
    step_failed: step,
    db_message: error?.message || null,
    db_code: error?.code || null,
    db_details: error?.details || null,
    db_hint: error?.hint || null,
    ...context
  };
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

function isInvalidContractStatusError(error) {
  const code = String(error && error.code || '').trim();
  const msg = String(error && error.message || '').toLowerCase();
  return code === '23514' || msg.includes('contracts_status_check') || msg.includes('check constraint');
}

async function updateContractWithPreferredPendingStatus({ sbAdmin, contractId, patchBase }) {
  const pendingReviewPatch = { ...patchBase, status: 'pending_review' };
  const pendingReviewRes = await sbAdmin.from('contracts').update(pendingReviewPatch).eq('id', contractId);
  if (!pendingReviewRes.error) return 'pending_review';
  const err = pendingReviewRes.error;
  if (isInvalidContractStatusError(err)) {
    throw new OfferAcceptanceError(500, 'Contract sync failed: pending_review not allowed by DB constraint.', {
      message: err.message || null,
      code: err.code || null,
      details: err.details || null,
      hint: err.hint || null
    });
  }
  throw new OfferAcceptanceError(500, 'Contract sync failed.', err.message);
}

async function insertContractWithPreferredPendingStatus({ sbAdmin, contractPayload }) {
  const pendingReviewRes = await sbAdmin.from('contracts').insert({ ...contractPayload, status: 'pending_review' }).select('*').single();
  if (!pendingReviewRes.error) return pendingReviewRes.data;
  if (isInvalidContractStatusError(pendingReviewRes.error)) {
    console.error('ensureContractForOffer: pending_review status rejected by DB', {
      offer_id: contractPayload.offer_id || null,
      contract_payload: { ...contractPayload, status: 'pending_review' },
      db_error: {
        message: pendingReviewRes.error.message || null,
        code: pendingReviewRes.error.code || null,
        details: pendingReviewRes.error.details || null,
        hint: pendingReviewRes.error.hint || null
      }
    });
    throw new OfferAcceptanceError(
      500,
      'Contract create failed: pending_review not allowed by DB constraint.',
      {
        message: pendingReviewRes.error.message || null,
        code: pendingReviewRes.error.code || null,
        details: pendingReviewRes.error.details || null,
        hint: pendingReviewRes.error.hint || null
      }
    );
  }
  if (pendingReviewRes.error) {
    console.error('ensureContractForOffer: contract insert fallback failed', {
      offer_id: contractPayload.offer_id || null,
      contract_payload: { ...contractPayload, status: 'pending_review' },
      db_error: {
        message: pendingReviewRes.error.message || null,
        code: pendingReviewRes.error.code || null,
        details: pendingReviewRes.error.details || null,
        hint: pendingReviewRes.error.hint || null
      }
    });
    throw new OfferAcceptanceError(
      500,
      `Contract create failed: ${pendingReviewRes.error.message || 'unknown database error'}`,
      {
        message: pendingReviewRes.error.message || null,
        code: pendingReviewRes.error.code || null,
        details: pendingReviewRes.error.details || null,
        hint: pendingReviewRes.error.hint || null
      }
    );
  }
  return pendingReviewRes.data;
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
  const startDate = String(offer.start_date || nowIso.slice(0, 10)).slice(0, 10);
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
    const existingStatus = String(existing.status || '').trim().toLowerCase();
    const patch = {
      customer_id: offer.customer_id || null,
      customer_name: offer.company_name || '',
      plan: offer.plan,
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
      || !existingStatus
      || existingStatus === 'accepted'
    );
    if (needsPatch) {
      await updateContractWithPreferredPendingStatus({
        sbAdmin,
        contractId: existing.id,
        patchBase: patch
      });
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
    contract_text: generateContractText({ offer, startDate, cancellationDate })
  };
  const contractRow = await insertContractWithPreferredPendingStatus({
    sbAdmin,
    contractPayload
  });
  return String(contractRow.id);
}

async function ensureInitialInvoiceForOffer({ sbAdmin, offer, contractId, nowIso }) {
  if (!offer?.customer_id || !contractId) return { invoiceId: null, duplicate: false, recurringInvoiceId: null };

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('*')
    .eq('id', offer.customer_id)
    .maybeSingle();
  if (customerError) throw new OfferAcceptanceError(500, 'Customer lookup for initial invoice failed.', customerError.message);
  if (!customer) throw new OfferAcceptanceError(409, 'Kunde für Offerte konnte nicht geladen werden.');

  const { data: contract, error: contractError } = await sbAdmin
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .maybeSingle();
  if (contractError) throw new OfferAcceptanceError(500, 'Contract lookup for billing orchestration failed.', contractError.message);
  if (!contract) throw new OfferAcceptanceError(404, 'Contract für Billing-Orchestrierung nicht gefunden.');

  const billing = await orchestrateContractBilling({
    sbAdmin,
    customer,
    contract,
    nowIso,
    startDate: String(offer.start_date || contract.start_date || nowIso.slice(0, 10)).slice(0, 10),
    setupFeeAmount: Number(offer.setup_fee || customer.setup_fee_amount || 0),
    monthlyAmount: Number(offer.monthly_price || 0),
    forceActiveSubscription: false
  });

  const setupInvoice = billing.setupInvoice || null;
  const recurringInvoice = billing.recurringInvoice || null;

  if (setupInvoice?.id) {
    await sbAdmin
      .from('invoices')
      .update({
        offer_id: offer.id,
        contract_id: contractId,
        customer_id: customer.id,
        updated_at: nowIso
      })
      .eq('id', setupInvoice.id);
  }

  if (recurringInvoice?.id) {
    await sbAdmin
      .from('invoices')
      .update({
        offer_id: offer.id,
        contract_id: contractId,
        customer_id: customer.id,
        subscription_id: billing.subscription?.id || recurringInvoice.subscription_id || null,
        updated_at: nowIso
      })
      .eq('id', recurringInvoice.id);
  }

  if (setupInvoice?.id) {
    await sbAdmin
      .from('offers')
      .update({ invoice_id: setupInvoice.id, updated_at: nowIso })
      .eq('id', offer.id);
  }

  return {
    invoiceId: setupInvoice?.id ? String(setupInvoice.id) : null,
    recurringInvoiceId: recurringInvoice?.id ? String(recurringInvoice.id) : null,
    duplicate: !billing.setup_fee_invoice_created,
    diagnostics: {
      step_failed: null,
      contract_id: contract?.id || contractId || null,
      customer_id: customer?.id || offer?.customer_id || null,
      subscription_id: billing.subscription?.id || null,
      setup_fee_invoice_id: setupInvoice?.id || null,
      month_1_invoice_id: recurringInvoice?.id || null
    }
  };
}

async function ensureOpsReviewTask({ sbAdmin, customerId, contractId, offerId, nowIso }) {
  if (!customerId || !contractId) return null;
  const key = `ops_contract_review:${contractId}`;
  const { data: existing } = await sbAdmin
    .from('cases')
    .select('id, status, note, notes')
    .eq('customer_id', customerId)
    .or(`note.ilike.%${key}%,notes.ilike.%${key}%`)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return { id: existing.id, duplicate: true };

  const note = `[${key}] Angebot akzeptiert – Vertrag operativ prüfen, Start bestätigen, Rechnungen freigeben. Offer=${offerId || 'n/a'} Contract=${contractId}`;
  const { data: created, error } = await sbAdmin
    .from('cases')
    .insert({
      customer_id: customerId,
      title: 'Contract review required',
      note,
      status: 'open',
      created_at: nowIso,
      updated_at: nowIso
    })
    .select('id')
    .single();
  if (error) throw new OfferAcceptanceError(500, 'Ops task creation failed.', error.message);
  return { id: created?.id || null, duplicate: false };
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

  let initialInvoice = { invoiceId: null, duplicate: false };
  let invoiceError = null;
  let lifecycleError = null;

  if (offerWithCustomer.accepted_at && offerWithCustomer.contract_id) {
    try {
      initialInvoice = await ensureInitialInvoiceForOffer({
        sbAdmin,
        offer: offerWithCustomer,
        contractId: String(offerWithCustomer.contract_id),
        nowIso
      });
    } catch (err) {
      invoiceError = err;
      console.error('acceptOfferAndEnsureContract: initial invoice ensure failed for already accepted offer', {
        offer_id: offer.id,
        contract_id: offerWithCustomer.contract_id,
        error: err?.message || String(err),
        details: err?.details || null
      });
    }

    try {
      await syncPostAcceptanceLifecycle({ sbAdmin, offer: offerWithCustomer, nowIso });
    } catch (err) {
      lifecycleError = err;
      console.error('acceptOfferAndEnsureContract: lifecycle sync failed for already accepted offer', {
        offer_id: offer.id,
        customer_id: offerWithCustomer?.customer_id || null,
        error: err?.message || String(err)
      });
    }

    return {
      duplicate: true,
      offerId: String(offerWithCustomer.id),
      contractId: String(offerWithCustomer.contract_id),
      acceptedAt: offerWithCustomer.accepted_at,
      invoiceError: invoiceError
        ? diagnosticFromError('ensure_initial_invoice_for_offer', invoiceError, {
          contract_id: offerWithCustomer?.contract_id || null,
          customer_id: offerWithCustomer?.customer_id || null,
          subscription_id: null,
          setup_fee_invoice_id: initialInvoice?.invoiceId || null,
          month_1_invoice_id: initialInvoice?.recurringInvoiceId || null
        })
        : null,
      lifecycleError: lifecycleError
        ? {
          message: lifecycleError.message || 'Post-acceptance lifecycle sync failed.'
        }
        : null,
      invoiceId: initialInvoice.invoiceId,
      recurringInvoiceId: initialInvoice.recurringInvoiceId || null,
      invoiceDuplicate: initialInvoice.duplicate
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

  let opsTask = null;
  if (contractId) {
    try {
      opsTask = await ensureOpsReviewTask({
        sbAdmin,
        customerId: offerRes.data?.customer_id || offerWithCustomer?.customer_id || null,
        contractId,
        offerId: offerRes.data?.id || offerWithCustomer?.id || null,
        nowIso
      });
    } catch (err) {
      lifecycleError = lifecycleError || err;
      console.error('acceptOfferAndEnsureContract: ops task create failed', {
        offer_id: offer.id,
        customer_id: offerRes.data?.customer_id || null,
        contract_id: contractId,
        error: err?.message || String(err)
      });
    }
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
      ? diagnosticFromError('ensure_initial_invoice_for_offer', invoiceError, {
        contract_id: contractId || null,
        customer_id: offerRes?.data?.customer_id || offerWithCustomer?.customer_id || null,
        subscription_id: null,
        setup_fee_invoice_id: initialInvoice?.invoiceId || null,
        month_1_invoice_id: initialInvoice?.recurringInvoiceId || null
      })
      : null,
    lifecycleError: lifecycleError
      ? {
        message: lifecycleError.message || 'Post-acceptance lifecycle sync failed.'
      }
      : null,
    acceptedAt: offerRes.data.accepted_at || nowIso,
    offer: offerRes.data,
    invoiceId: initialInvoice.invoiceId,
    recurringInvoiceId: initialInvoice.recurringInvoiceId || null,
    billingDiagnostics: initialInvoice.diagnostics || null,
    invoiceDuplicate: initialInvoice.duplicate,
    opsTask
  };
}

module.exports = {
  OfferAcceptanceError,
  acceptOfferAndEnsureContract,
  syncPostAcceptanceLifecycle
};
