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
  const caseId = String(body.case_id || '').trim();
  const due = new Date(body.due_at || '');
  if (!caseId) return response(400, { error: 'Case-ID fehlt.' });
  if (Number.isNaN(due.getTime())) return response(400, { error: 'Ungültiges Fälligkeitsdatum.' });

  const { data, error } = await sbAdmin
    .from('voxera_cases')
    .update({ due_at: due.toISOString(), updated_at: new Date().toISOString() })
    .eq('id', caseId)
    .select('*')
    .single();
  if (error) return response(500, { error: 'Fälligkeit konnte nicht gespeichert werden.', details: error.message });
  return response(200, { success: true, case: data });
};
