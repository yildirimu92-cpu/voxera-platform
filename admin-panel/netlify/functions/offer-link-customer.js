'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { STATUS } = require('./_lib/status-model');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const CUSTOMER_INSERTABLE_FIELDS = new Set([
  'id',
  'customer_name',
  'email',
  'tel_nr',
  'plan',
  'street',
  'zip',
  'city',
  'country',
  'contact_first_name',
  'contact_last_name',
  'contact_name',
  'status',
  'invite_status',
  'welcome_sent',
  'created_at',
  'updated_at'
]);

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function errorResponse(statusCode, code, message, details) {
  const payload = { error: { code, message } };
  if (details) payload.error.details = details;
  return response(statusCode, payload);
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch (_e) {
    return null;
  }
}

function prospectNameFromOffer(offer) {
  const company = String(offer.company_name || '').trim();
  if (company) return company;
  const contact = [offer.contact_first_name, offer.contact_last_name].map(v => String(v || '').trim()).filter(Boolean).join(' ');
  if (contact) return contact;
  const legacyContact = String(offer.contact_name || '').trim();
  if (legacyContact) return legacyContact;
  return `Prospect ${String(offer.offer_number || offer.id || '').trim() || 'Offerte'}`;
}

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function normalizePhone(raw) {
  return String(raw || '').trim() || null;
}

function normalizeText(raw) {
  const value = String(raw || '').trim();
  return value || null;
}

function pickFirstNonEmpty(offer, candidates) {
  for (const key of candidates) {
    const value = normalizeText(offer?.[key]);
    if (value) return { key, value };
  }
  return { key: null, value: null };
}

function resolveAddressFields(offer) {
  const street = pickFirstNonEmpty(offer, ['street', 'street_address']);
  const zip = pickFirstNonEmpty(offer, ['postal_code', 'zip', 'postalCode']);
  const city = pickFirstNonEmpty(offer, ['city', 'town']);
  const country = pickFirstNonEmpty(offer, ['country']);
  return { street, zip, city, country };
}

function requiredFieldMissing(fieldValue) {
  return !String(fieldValue || '').trim();
}

function missingFieldError(messages, details) {
  return errorResponse(409, 'missing_required_offer_field', messages.join(' '), details);
}

function generateCustomerId() {
  return `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function serializeError(err) {
  if (!err) return { message: 'Unknown error' };
  if (typeof err === 'string') return { message: err };
  return {
    name: err.name,
    message: err.message,
    code: err.code,
    details: err.details,
    hint: err.hint,
    status: err.status,
    stack: err.stack
  };
}

function logError(stage, err, meta) {
  console.error(JSON.stringify({
    level: 'error',
    function: 'offer-link-customer',
    stage,
    meta: meta || null,
    error: serializeError(err)
  }));
}

function validateCustomerPayload(payload) {
  for (const key of Object.keys(payload)) {
    if (!CUSTOMER_INSERTABLE_FIELDS.has(key)) {
      return { ok: false, reason: `Unsupported customer field: ${key}` };
    }
  }
  if (!payload.id || !payload.customer_name) {
    return { ok: false, reason: 'Required customer fields missing (id/customer_name).' };
  }
  if (payload.email !== null && typeof payload.email !== 'string') {
    return { ok: false, reason: 'email must be string or null.' };
  }
  return { ok: true };
}

async function ensureOnboarding(sbAdmin, customerId) {
  const { data: onboarding, error: onboardingErr } = await sbAdmin
    .from('onboarding')
    .select('id,status,progress')
    .eq('customer_id', customerId)
    .maybeSingle();
  if (onboardingErr) throw onboardingErr;
  if (onboarding) return onboarding;

  const nowIso = new Date().toISOString();
  const { data: created, error: createErr } = await sbAdmin
    .from('onboarding')
    .insert({
      customer_id: customerId,
      status: STATUS.onboarding.NOT_STARTED,
      progress: 0,
      next_step: 'Offerte in Kunde überführt',
      created_at: nowIso,
      updated_at: nowIso
    })
    .select('*')
    .single();
  if (createErr) throw createErr;
  return created;
}

async function findExistingCustomer(sbAdmin, offer) {
  const email = normalizeEmail(offer.email);
  if (email) {
    const { data, error } = await sbAdmin
      .from('customers')
      .select('*')
      .ilike('email', email)
      .limit(2);
    if (error) throw error;
    if (Array.isArray(data) && data.length > 1) {
      return { customer: null, via: 'email', ambiguous: true, count: data.length };
    }
    if (Array.isArray(data) && data[0]) return { customer: data[0], via: 'email', ambiguous: false };
  }

  const company = String(offer.company_name || '').trim();
  if (company) {
    const { data, error } = await sbAdmin
      .from('customers')
      .select('*')
      .ilike('customer_name', company)
      .limit(2);
    if (error) throw error;
    if (Array.isArray(data) && data.length > 1) {
      return { customer: null, via: 'company', ambiguous: true, count: data.length };
    }
    if (Array.isArray(data) && data[0]) return { customer: data[0], via: 'company', ambiguous: false };
  }

  return { customer: null, via: null, ambiguous: false };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
    if (event.httpMethod !== 'POST') return errorResponse(405, 'method_not_allowed', 'Method not allowed');

    const sbUrl = process.env.SUPABASE_URL;
    const sbAnonKey = process.env.SUPABASE_ANON_KEY;
    const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!sbUrl || !sbAnonKey || !sbServiceKey) {
      return errorResponse(500, 'config_missing', 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.');
    }

    const body = parseBody(event);
    if (!body) return errorResponse(400, 'invalid_json', 'Ungültiger Request Body.');

    const offerId = String(body.offer_id || '').trim();
    if (!offerId) return errorResponse(400, 'validation_error', 'offer_id fehlt.');

    const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
    if (!caller.ok) return response(caller.statusCode, caller.body);

    const { data: offer, error: offerErr } = await sbAdmin
      .from('offers')
      .select('*')
      .eq('id', offerId)
      .maybeSingle();
    if (offerErr) {
      logError('offer_lookup', offerErr, { offerId });
      return errorResponse(500, 'offer_lookup_failed', 'Offer lookup failed.', offerErr.message);
    }
    if (!offer) return errorResponse(404, 'offer_not_found', 'Offerte nicht gefunden.');

    if (offer.customer_id) {
      const { data: linkedCustomer } = await sbAdmin.from('customers').select('*').eq('id', offer.customer_id).maybeSingle();
      return response(200, { success: true, already_linked: true, customer: linkedCustomer || { id: offer.customer_id } });
    }

    const nowIso = new Date().toISOString();
    let customer;
    let linkedExisting = false;
    let duplicateMatch = null;

    const existing = await findExistingCustomer(sbAdmin, offer);
    if (existing.ambiguous) {
      return errorResponse(409, 'duplicate_ambiguous', 'Mehrdeutiger Duplikat-Treffer. Bitte Kunde manuell zuordnen.', {
        via: existing.via,
        matches: existing.count
      });
    }

    if (existing.customer) {
      customer = existing.customer;
      linkedExisting = true;
      duplicateMatch = existing.via;
    } else {
      const address = resolveAddressFields(offer);
      const email = normalizeEmail(offer.email) || null;
      const phone = normalizePhone(offer.phone);
      const customerId = generateCustomerId();
      const customerPayload = {
        id: customerId,
        customer_name: prospectNameFromOffer(offer),
        email,
        tel_nr: phone,
        plan: String(offer.plan || 'professional').trim() || 'professional',
        street: address.street.value,
        zip: address.zip.value,
        city: address.city.value,
        country: address.country.value,
        contact_first_name: String(offer.contact_first_name || '').trim() || null,
        contact_last_name: String(offer.contact_last_name || '').trim() || null,
        contact_name: String(offer.contact_name || '').trim() || null,
        status: STATUS.customer.ONBOARDING,
        invite_status: STATUS.access.NOT_SENT,
        welcome_sent: false,
        created_at: nowIso,
        updated_at: nowIso
      };

      const requiredErrors = [];
      const requiredFieldDetails = [];
      if (requiredFieldMissing(customerPayload.customer_name)) {
        requiredErrors.push('Kunde kann nicht erstellt werden: Firmen-/Kundenname fehlt in der Offerte.');
        requiredFieldDetails.push({ customer_field: 'customer_name', offer_field: 'company_name|contact_first_name|contact_last_name|contact_name' });
      }
      if (requiredFieldMissing(customerPayload.street)) {
        requiredErrors.push('Kunde kann nicht erstellt werden: Straße fehlt in der Offerte.');
        requiredFieldDetails.push({ customer_field: 'street', offer_field: address.street.key || 'street' });
      }
      if (requiredFieldMissing(customerPayload.zip)) {
        requiredErrors.push('Kunde kann nicht erstellt werden: PLZ fehlt in der Offerte (erwartet: postal_code, Fallback: zip/postalCode).');
        requiredFieldDetails.push({ customer_field: 'zip', offer_field: address.zip.key || 'postal_code|zip|postalCode' });
      }
      if (requiredFieldMissing(customerPayload.city)) {
        requiredErrors.push('Kunde kann nicht erstellt werden: Ort fehlt in der Offerte.');
        requiredFieldDetails.push({ customer_field: 'city', offer_field: address.city.key || 'city' });
      }
      if (requiredFieldMissing(customerPayload.country)) {
        requiredErrors.push('Kunde kann nicht erstellt werden: Land fehlt in der Offerte.');
        requiredFieldDetails.push({ customer_field: 'country', offer_field: address.country.key || 'country' });
      }
      if (requiredErrors.length) {
        return missingFieldError(requiredErrors, {
          offer_id: offer.id,
          missing_fields: requiredFieldDetails
        });
      }

      const payloadValidation = validateCustomerPayload(customerPayload);
      if (!payloadValidation.ok) {
        return errorResponse(400, 'invalid_customer_payload', payloadValidation.reason);
      }

      const { data: created, error: createErr } = await sbAdmin
        .from('customers')
        .insert(customerPayload)
        .select('*')
        .single();
      if (createErr) {
        if (String(createErr.code || '') === '23505' && normalizeEmail(offer.email)) {
          const retry = await findExistingCustomer(sbAdmin, offer);
          if (retry.ambiguous) {
            return errorResponse(409, 'duplicate_ambiguous', 'Mehrdeutiger Duplikat-Treffer nach Retry. Bitte Kunde manuell zuordnen.', {
              via: retry.via,
              matches: retry.count
            });
          }
          if (retry.customer) {
            customer = retry.customer;
            linkedExisting = true;
            duplicateMatch = retry.via;
          } else {
            logError('customer_insert_duplicate_unresolved', createErr, { offerId });
            return errorResponse(409, 'duplicate_unresolved', 'Kunde existiert bereits, konnte aber nicht eindeutig aufgelöst werden.', createErr.message);
          }
        } else {
          logError('customer_insert', createErr, { offerId });
          return errorResponse(500, 'customer_create_failed', 'Kunde konnte nicht erstellt werden.', createErr.message);
        }
      } else {
        customer = created;
      }
    }

    if (!customer?.id) return errorResponse(500, 'customer_missing', 'Kein Kunde verfügbar nach Konvertierung.');

    const { data: updatedOffer, error: linkErr } = await sbAdmin
      .from('offers')
      .update({ customer_id: customer.id, updated_at: nowIso })
      .eq('id', offer.id)
      .select('*')
      .single();
    if (linkErr) {
      logError('offer_link', linkErr, { offerId, customerId: customer.id });
      return errorResponse(500, 'offer_link_failed', 'Offerte konnte nicht verknüpft werden.', linkErr.message);
    }

    const onboarding = await ensureOnboarding(sbAdmin, customer.id);

    return response(200, {
      success: true,
      linked_existing: linkedExisting,
      duplicate_match: duplicateMatch,
      customer,
      offer: updatedOffer,
      onboarding
    });
  } catch (e) {
    logError('unhandled', e);
    return errorResponse(500, 'conversion_failed', 'Konvertierung fehlgeschlagen.', e?.message || String(e));
  }
};
