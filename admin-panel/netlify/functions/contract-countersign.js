'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { countersignContract, CountersignError, trimOrNull } = require('./_lib/contract-countersign-service');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const respond = (status, payload) => ({
  statusCode: status,
  headers: corsHeaders,
  body: JSON.stringify(payload)
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbServiceKey || !sbAnonKey) {
    return respond(500, { error: 'Supabase-Konfiguration fehlt.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const caller = await requireAdminCaller({
    event,
    supabaseUrl: sbUrl,
    supabaseAnonKey: sbAnonKey,
    sbAdmin
  });
  if (!caller.ok) return respond(caller.statusCode, caller.body);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_error) {
    return respond(400, { error: 'Ungültiger Request Body.' });
  }

  const contractId = trimOrNull(body.contract_id);
  const countersignName = trimOrNull(body.countersign_name);
  const countersignatureData = trimOrNull(body.countersignature_data);

  try {
    const result = await countersignContract({
      sbAdmin,
      contractId,
      countersignName,
      countersignatureData,
      actorUserId: caller.userId
    });
    return respond(200, { success: true, ...result });
  } catch (error) {
    if (error instanceof CountersignError) {
      return respond(error.statusCode, { error: error.message, details: error.details || undefined });
    }
    return respond(500, { error: 'Gegenzeichnung konnte nicht gespeichert werden.', details: error?.message });
  }
};
