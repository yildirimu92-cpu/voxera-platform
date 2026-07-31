'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

function missingColumn(error) {
  const code = String(error?.code || '');
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return code === '42703' || code === 'PGRST204' || text.includes('schema cache') || (text.includes('column') && text.includes('does not exist'));
}

function parseDueAt(value) {
  const fallback = new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (!value) return fallback.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) return response(500, { error: 'Supabase-Konfiguration fehlt.' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin, requiredCapability: 'customer:write' });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return response(400, { error: 'Ungültiger Request Body.' }); }

  const customerId = String(body.customer_id || '').trim();
  const title = String(body.title || '').trim().slice(0, 180);
  const note = String(body.note || '').trim().slice(0, 6000);
  const dueAt = parseDueAt(body.due_at);
  if (!customerId) return response(400, { error: 'Kunde fehlt.' });
  if (!title) return response(400, { error: 'Titel fehlt.' });

  const now = new Date().toISOString();
  const modern = {
    customer_id: customerId,
    title,
    note: note || null,
    status: 'open',
    priority: 'medium',
    due_at: dueAt,
    case_type: 'internal_task',
    source: 'admin_portal',
    origin_channel: 'admin_portal',
    queue_scope: 'admin',
    created_at: now,
    updated_at: now
  };

  let { data, error } = await sbAdmin.from('voxera_cases').insert(modern).select('*').single();
  if (error && missingColumn(error)) {
    const withoutScope = { ...modern };
    delete withoutScope.queue_scope;
    ({ data, error } = await sbAdmin.from('voxera_cases').insert(withoutScope).select('*').single());
  }
  if (error && missingColumn(error)) {
    const legacy = {
      customer_id: customerId,
      title,
      note: note || null,
      status: 'open',
      priority: 'medium',
      due_at: dueAt,
      created_at: now,
      updated_at: now
    };
    ({ data, error } = await sbAdmin.from('voxera_cases').insert(legacy).select('*').single());
  }
  if (error) {
    console.error('[cases-create-admin]', error);
    return response(500, { error: 'Case konnte nicht erstellt werden.', details: error.message });
  }

  return response(200, { success: true, case: data });
};
