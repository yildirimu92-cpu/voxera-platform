'use strict';

const { createClient } = require('@supabase/supabase-js');
const { recordOfferEvent } = require('./_lib/offer-events');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function isExpired(offer) {
  const expiry = offer.public_expires_at || (offer.valid_until ? `${String(offer.valid_until).slice(0, 10)}T23:59:59.999Z` : null);
  if (!expiry) return false;
  return new Date(expiry).getTime() < Date.now();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbServiceKey) return response(500, { error: 'Supabase config missing.' });

  const token = String(event.queryStringParameters?.token || '').trim();
  if (!token) return response(400, { error: 'token fehlt.' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: offer, error } = await sbAdmin
    .from('offers')
    .select('*')
    .eq('public_token', token)
    .maybeSingle();

  if (error) return response(500, { error: 'Offer lookup failed.', details: error.message });
  if (!offer) return response(404, { error: 'Offerte nicht gefunden.' });

  const status = String(offer.status || '').toLowerCase();
  const expired = isExpired(offer) || status === 'expired';
  const nowIso = new Date().toISOString();
  if (!expired) {
    await recordOfferEvent(sbAdmin,{ offer_id: offer.id, event_type: 'opened', event_at: nowIso, actor_type: 'public', actor_id: null, recipient_email: offer.email || null });
  }
  if (!expired && status === 'sent') {
    await sbAdmin.from('offers').update({ status: 'viewed', viewed_at: nowIso, updated_at: nowIso }).eq('id', offer.id);
    offer.status = 'viewed';
  } else if (expired && status !== 'expired') {
    await sbAdmin.from('offers').update({ status: 'expired', expired_at: nowIso, updated_at: nowIso }).eq('id', offer.id);
    await recordOfferEvent(sbAdmin,{ offer_id: offer.id, event_type: 'expired', event_at: nowIso, actor_type: 'system', actor_id: null });
    offer.status = 'expired';
  }
  const blocked = ['declined'].includes(String(offer.status || '').toLowerCase());

  if (expired || blocked) {
    return response(410, {
      error: expired ? 'Offerte ist abgelaufen.' : 'Offerte ist nicht mehr verfügbar.',
      offer: {
        offer_number: offer.offer_number,
        status,
        valid_until: offer.valid_until
      }
    });
  }

  return response(200, {
    offer: {
      id: offer.id,
      offer_number: offer.offer_number,
      status,
      company_name: offer.company_name,
      contact_name: offer.contact_name,
      contact_first_name: offer.contact_first_name || null,
      contact_last_name: offer.contact_last_name || null,
      email: offer.email,
      phone: offer.phone,
      street: offer.street,
      postal_code: offer.postal_code,
      city: offer.city,
      country: offer.country,
      plan: offer.plan,
      billing_cycle: offer.billing_cycle,
      duration_months: Number(offer.duration_months || 0),
      setup_fee: Number(offer.setup_fee || 0),
      monthly_price: Number(offer.monthly_price || 0),
      yearly_price: Number(offer.yearly_price || 0),
      discount_amount: Number(offer.discount_amount || 0),
      discount_percent: Number(offer.discount_percent || 0),
      total: Number(offer.total || 0),
      valid_until: offer.valid_until,
      included_minutes: offer.included_minutes != null ? Number(offer.included_minutes) : null,
      extra_per_minute: offer.extra_per_minute != null ? Number(offer.extra_per_minute) : null,
      number_count: offer.number_count != null ? Number(offer.number_count) : null,
      starts_at: offer.starts_at || null,
      ends_at: offer.ends_at || null,
      add_ons: offer.add_ons || {},
      offer_text: offer.offer_text || {},
      accepted_at: offer.accepted_at || null
    }
  });
};
