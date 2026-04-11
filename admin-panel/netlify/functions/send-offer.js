const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { createOutboxEvent, markOutboxFailed, markOutboxSent } = require('./_lib/webhook-outbox');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const response = (statusCode, payload) => ({ statusCode, headers: corsHeaders, body: JSON.stringify(payload) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbServiceKey || !sbAnonKey) return response(500, { error: 'Supabase-Konfiguration fehlt.' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return response(400, { error: 'Ungültiger Request Body.' }); }
  const offerId = String(body.offer_id || '').trim();
  if (!offerId) return response(400, { error: 'offer_id fehlt.' });

  const { data: offer, error: loadErr } = await sbAdmin.from('offers').select('*').eq('id', offerId).single();
  if (loadErr || !offer) return response(404, { error: 'Offerte nicht gefunden.' });

  const sentToEmail = String(offer.email || body.sent_to_email || '').trim();
  if (!sentToEmail) return response(400, { error: 'Offerte hat keine Empfänger-E-Mail.' });

  const outbox = await createOutboxEvent(sbAdmin, {
    eventType: 'offer_sent_email',
    payload: {
      offer_id: offer.id,
      offer_number: offer.offer_number,
      company_name: offer.company_name,
      contact_name: offer.contact_name,
      sent_to_email: sentToEmail,
      valid_until: offer.valid_until,
      total: offer.total,
      plan: offer.plan
    },
    payloadSummary: `offer_sent_email -> ${sentToEmail}`,
    dedupeKey: `offer:${offer.id}:send`
  }).catch((err) => {
    throw new Error(`Outbox insert failed: ${err.message}`);
  });

  const webhookUrl = process.env.MAKE_OFFER_WEBHOOK || process.env.MAKE_WELCOME_WEBHOOK;
  if (!webhookUrl) {
    await markOutboxFailed(sbAdmin, outbox.id, 'MAKE_OFFER_WEBHOOK nicht gesetzt');
    return response(500, { error: 'MAKE_OFFER_WEBHOOK nicht gesetzt.' });
  }

  try {
    const hookRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'offer_sent_email',
        offer_id: offer.id,
        offer_number: offer.offer_number,
        company_name: offer.company_name,
        contact_name: offer.contact_name,
        email: sentToEmail,
        valid_until: offer.valid_until,
        total: offer.total,
        plan: offer.plan,
        offer_payload: offer
      })
    });
    if (!hookRes.ok) throw new Error(`Webhook failed (HTTP ${hookRes.status})`);
    await markOutboxSent(sbAdmin, outbox.id);
  } catch (err) {
    await markOutboxFailed(sbAdmin, outbox.id, err.message || 'Webhook request failed');
    return response(500, { error: 'Offer E-Mail konnte nicht gesendet werden.', details: err.message || err });
  }

  const nowIso = new Date().toISOString();
  const { error: updErr } = await sbAdmin
    .from('offers')
    .update({ status: 'sent', sent_to_email: sentToEmail, sent_at: nowIso, sent_by: caller.userId || null, delivery_status: 'sent', updated_at: nowIso })
    .eq('id', offer.id);
  if (updErr) return response(500, { error: 'Offerte konnte nicht aktualisiert werden.', details: updErr.message });

  return response(200, { success: true, offer_id: offer.id, sent_to_email: sentToEmail, sent_at: nowIso, delivery_status: 'sent' });
};
