'use strict';

const { createClient } = require('@supabase/supabase-js');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};
const respond = (status, payload) => ({ statusCode: status, headers: corsHeaders, body: JSON.stringify(payload) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };

  const token = event.queryStringParameters?.token || '';
  if (!token) return respond(400, { error: 'Token fehlt.' });

  const sbUrl        = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbServiceKey) return respond(500, { error: 'Serverkonfiguration fehlt.' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Vertrag via public token laden
  const { data: contract, error } = await sbAdmin
    .from('contracts')
    .select('*')
    .eq('contract_public_token', token)
    .maybeSingle();

  if (error) return respond(500, { error: 'Datenbankfehler.' });
  if (!contract) return respond(404, { error: 'Vertrag nicht gefunden oder Link ungültig.' });
  if (!contract.countersigned_at) return respond(403, { error: 'Dieser Vertrag wurde noch nicht gegengezeichnet.' });

  // Verknüpfte Offerte laden (für Legal-Versionen)
  let offer = null;
  if (contract.offer_id) {
    const { data: offerData } = await sbAdmin
      .from('offers')
      .select('accepted_at, accepted_by_name, accepted_by_email, accepted_ip, agb_version, avv_version, dse_version, agb_accepted, avv_accepted, dse_accepted')
      .eq('id', contract.offer_id)
      .maybeSingle();
    offer = offerData || null;
  }

  // Kundensignatur: zuerst contracts.signature_data, dann offer_acceptances als Fallback
  if (!contract.signature_data && contract.offer_id) {
    const { data: acceptance } = await sbAdmin
      .from('offer_acceptances')
      .select('signature_data, accepted_by_name, created_at')
      .eq('offer_id', contract.offer_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (acceptance?.signature_data) {
      contract.signature_data = acceptance.signature_data;
      contract.accepted_by_name = contract.accepted_by_name || acceptance.accepted_by_name;
      contract.accepted_at = contract.accepted_at || acceptance.created_at;
    }
  }

  return respond(200, { contract, offer });
};
