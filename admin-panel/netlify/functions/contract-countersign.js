'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const respond = (status, payload) => ({ statusCode: status, headers: corsHeaders, body: JSON.stringify(payload) });

function generatePublicToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 48; i++) token += chars[Math.floor(Math.random() * chars.length)];
  return token;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  const sbUrl        = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sbAnonKey    = process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbServiceKey || !sbAnonKey) return respond(500, { error: 'Supabase-Konfiguration fehlt.' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Admin-Auth prüfen
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return respond(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Ungültiger Request Body.' }); }

  const { contract_id, countersign_name, countersignature_data } = body;
  if (!contract_id)         return respond(400, { error: 'contract_id fehlt.' });
  if (!countersign_name)    return respond(400, { error: 'countersign_name fehlt.' });
  if (!countersignature_data) return respond(400, { error: 'countersignature_data fehlt.' });

  // Vertrag laden
  const { data: contract, error: loadErr } = await sbAdmin
    .from('contracts')
    .select('*')
    .eq('id', contract_id)
    .single();
  if (loadErr || !contract) return respond(404, { error: 'Vertrag nicht gefunden.' });
  if (contract.countersigned_at) return respond(409, { error: 'Vertrag wurde bereits gegengezeichnet.' });

  const nowIso = new Date().toISOString();
  const publicToken = generatePublicToken();

  // Gegenzeichnung speichern
  const { error: updateErr } = await sbAdmin
    .from('contracts')
    .update({
      countersigned_at:      nowIso,
      countersign_name:      countersign_name.trim(),
      countersignature_data: countersignature_data,
      contract_public_token: publicToken,
      updated_at:            nowIso
    })
    .eq('id', contract_id);

  if (updateErr) return respond(500, { error: 'Gegenzeichnung konnte nicht gespeichert werden.', details: updateErr.message });

  // Offers-Tabelle ebenfalls aktualisieren falls verknüpft
  if (contract.offer_id) {
    await sbAdmin
      .from('offers')
      .update({ countersigned_at: nowIso, updated_at: nowIso })
      .eq('id', contract.offer_id);
  }

  // Kunden-E-Mail laden
  let customerEmail = null;
  let customerName  = null;
  if (contract.customer_id) {
    const { data: customer } = await sbAdmin
      .from('customers')
      .select('email, customer_name, contact_name')
      .eq('id', contract.customer_id)
      .maybeSingle();
    if (customer) {
      customerEmail = customer.email;
      customerName  = customer.contact_name || customer.customer_name;
    }
  }

  // Signed-Page URL aufbauen
  const baseUrl = process.env.PUBLIC_BASE_URL || 'https://voxera.ch';
  const signedPageUrl = `${baseUrl}/contract-signed.html?token=${publicToken}`;

  // Make.com Webhook für E-Mail triggern (falls konfiguriert)
  const mailWebhook = process.env.MAKE_MAIL_WEBHOOK;
  if (mailWebhook && customerEmail) {
    try {
      await fetch(mailWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type:       'countersign_email',
          mail_type:        'countersign_email',
          recipient: {
            email: customerEmail,
            name:  customerName || contract.customer_name || 'Kunde'
          },
          contract: {
            id:                   contract.id,
            customer_name:        contract.customer_name || null,
            plan:                 contract.plan || null,
            start_date:           contract.start_date || null,
            end_date:             contract.end_date || null,
            duration_months:      contract.duration_months || contract.months || null,
            countersigned_at:     nowIso,
            countersign_name:     countersign_name.trim(),
            signed_page_url:      signedPageUrl,
            public_token:         publicToken
          }
        })
      });
    } catch (mailErr) {
      console.warn('contract-countersign: E-Mail Webhook fehlgeschlagen:', mailErr.message);
      // Kein Hard-Fail — Gegenzeichnung wurde gespeichert
    }
  }

  return respond(200, {
    success:          true,
    contract_id:      contract_id,
    countersigned_at: nowIso,
    public_token:     publicToken,
    signed_page_url:  signedPageUrl
  });
};
