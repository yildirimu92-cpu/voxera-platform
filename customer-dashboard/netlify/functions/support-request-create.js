'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');
const { insertOperationalCase } = require('./_lib/create-operational-case');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) return response(500, { error: 'Supabase-Konfiguration fehlt.' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin, requireActiveContract: true });
  if (!caller?.ok) return response(caller?.statusCode || 403, caller?.body || { error: 'Zugriff verweigert.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return response(400, { error: 'Ungültiger Request Body.' }); }
  const subject = String(body.subject || 'Support-Anfrage').trim().slice(0, 160);
  const message = String(body.message || '').trim().slice(0, 6000);
  const requestId = String(body.request_id || '').trim().slice(0, 160) || null;
  if (!message) return response(400, { error: 'Bitte beschreiben Sie Ihr Anliegen.' });

  try {
    const created = await insertOperationalCase(sbAdmin, {
      customerId: caller.customerId,
      title: subject,
      note: message,
      caseType: 'customer_support',
      source: 'customer_portal_support',
      sourceRefId: requestId,
      originChannel: 'customer_portal',
      requesterUserId: caller.userId || null,
      requesterEmail: caller.email || null,
      priority: body.priority === 'high' ? 'high' : 'medium'
    });
    return response(200, { success: true, case: created });
  } catch (error) {
    console.error('[support-request-create]', error);
    return response(500, { error: 'Support-Anfrage konnte nicht erstellt werden.', details: error.message });
  }
};
