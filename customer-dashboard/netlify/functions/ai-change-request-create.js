'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');
const { insertOperationalCase } = require('./_lib/create-operational-case');

const MAKE_WEBHOOK = process.env.MAKE_MAIL_WEBHOOK || '';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

async function notifyAdminOfChangeRequest({ customerId, customerName, message }) {
  if (!MAKE_WEBHOOK) {
    console.warn('[ai-change-request-create] MAKE_MAIL_WEBHOOK not set, skipping admin notification');
    return;
  }
  try {
    await fetch(MAKE_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mail_type: 'ai_change_request',
        customer_id: customerId,
        customer_name: customerName || 'Unbekannt',
        message,
        timestamp: new Date().toISOString(),
        admin_url: 'https://admin.voxera.ch/#ai-setup'
      })
    });
  } catch (error) {
    console.warn('[ai-change-request-create] admin notification failed', { error: error.message });
  }
}

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
  const message = String(body.message || '').trim().slice(0, 6000);
  if (!message) return response(400, { error: 'Bitte beschreiben Sie die gewünschte Änderung.' });

  const now = new Date().toISOString();
  const { data: request, error: requestError } = await sbAdmin
    .from('ai_change_requests')
    .insert({ customer_id: caller.customerId, message, status: 'open', created_at: now, updated_at: now })
    .select('*')
    .single();
  if (requestError) return response(500, { error: 'Änderungsanfrage konnte nicht gespeichert werden.', details: requestError.message });

  try {
    const createdCase = await insertOperationalCase(sbAdmin, {
      customerId: caller.customerId,
      title: 'Assistenten-Anpassung',
      note: message,
      caseType: 'assistant_change',
      source: 'ai_change_request',
      sourceRefId: request.id,
      originChannel: 'customer_portal',
      requesterUserId: caller.userId || null,
      requesterEmail: caller.email || null,
      priority: 'medium'
    });

    const { data: customerRow } = await sbAdmin
      .from('customers')
      .select('customer_name')
      .eq('id', caller.customerId)
      .maybeSingle();
    await notifyAdminOfChangeRequest({
      customerId: caller.customerId,
      customerName: customerRow?.customer_name,
      message
    });

    return response(200, { success: true, request, case: createdCase });
  } catch (error) {
    await sbAdmin.from('ai_change_requests').delete().eq('id', request.id);
    console.error('[ai-change-request-create]', error);
    return response(500, { error: 'Interner Case konnte nicht erstellt werden.', details: error.message });
  }
};
