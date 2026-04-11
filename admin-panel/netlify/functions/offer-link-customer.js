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

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function parseBody(event) {
  try { return JSON.parse(event.body || '{}'); } catch (_e) { return null; }
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

function generateCustomerId() {
  return `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    if (data) return { customer: data, via: 'email' };
  }

  const company = String(offer.company_name || '').trim();
  if (company) {
    const { data, error } = await sbAdmin
      .from('customers')
      .select('*')
      .ilike('customer_name', company)
      .limit(1);
    if (error) throw error;
    if (Array.isArray(data) && data[0]) return { customer: data[0], via: 'company' };
  }

  return { customer: null, via: null };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, { error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.' });
  }

  const body = parseBody(event);
  if (!body) return response(400, { error: 'Ungültiger Request Body.' });

  const offerId = String(body.offer_id || '').trim();
  if (!offerId) return response(400, { error: 'offer_id fehlt.' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  const { data: offer, error: offerErr } = await sbAdmin
    .from('offers')
    .select('*')
    .eq('id', offerId)
    .maybeSingle();
  if (offerErr) return response(500, { error: 'Offer lookup failed.', details: offerErr.message });
  if (!offer) return response(404, { error: 'Offerte nicht gefunden.' });

  if (offer.customer_id) {
    const { data: linkedCustomer } = await sbAdmin.from('customers').select('*').eq('id', offer.customer_id).maybeSingle();
    return response(200, { success: true, already_linked: true, customer: linkedCustomer || { id: offer.customer_id } });
  }

  const nowIso = new Date().toISOString();
  let customer;
  let linkedExisting = false;
  let duplicateMatch = null;

  try {
    const existing = await findExistingCustomer(sbAdmin, offer);
    if (existing.customer) {
      customer = existing.customer;
      linkedExisting = true;
      duplicateMatch = existing.via;
    } else {
      const customerId = generateCustomerId();
      const customerPayload = {
        id: customerId,
        customer_name: prospectNameFromOffer(offer),
        email: normalizeEmail(offer.email) || null,
        tel_nr: normalizePhone(offer.phone),
        plan: String(offer.plan || 'professional').trim() || 'professional',
        street: String(offer.street || '').trim() || null,
        zip: String(offer.postal_code || '').trim() || null,
        city: String(offer.city || '').trim() || null,
        country: String(offer.country || '').trim() || null,
        contact_first_name: String(offer.contact_first_name || '').trim() || null,
        contact_last_name: String(offer.contact_last_name || '').trim() || null,
        contact_name: String(offer.contact_name || '').trim() || null,
        status: STATUS.customer.ONBOARDING,
        invite_status: STATUS.access.NOT_SENT,
        welcome_sent: false,
        created_at: nowIso,
        updated_at: nowIso
      };

      const { data: created, error: createErr } = await sbAdmin
        .from('customers')
        .insert(customerPayload)
        .select('*')
        .single();
      if (createErr) {
        if (String(createErr.code || '') === '23505' && normalizeEmail(offer.email)) {
          const retry = await findExistingCustomer(sbAdmin, offer);
          if (retry.customer) {
            customer = retry.customer;
            linkedExisting = true;
            duplicateMatch = retry.via;
          } else {
            return response(409, { error: 'Kunde existiert bereits, konnte aber nicht eindeutig aufgelöst werden.', details: createErr.message });
          }
        } else {
          return response(500, { error: 'Kunde konnte nicht erstellt werden.', details: createErr.message });
        }
      } else {
        customer = created;
      }
    }

    if (!customer?.id) return response(500, { error: 'Kein Kunde verfügbar nach Konvertierung.' });

    const { data: updatedOffer, error: linkErr } = await sbAdmin
      .from('offers')
      .update({ customer_id: customer.id, updated_at: nowIso })
      .eq('id', offer.id)
      .select('*')
      .single();
    if (linkErr) return response(500, { error: 'Offerte konnte nicht verknüpft werden.', details: linkErr.message });

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
    return response(500, { error: 'Konvertierung fehlgeschlagen.', details: e.message || String(e) });
  }
};
