const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { normalizeCaseStatus } = require('./_lib/status-model');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
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

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return response(400, { error: 'Ungueltiger Request Body' }); }

  const customerId = String(body.customer_id || '').trim();
  const type = String(body.type || '').trim();
  const note = String(body.note || '').trim();
  const priority = String(body.priority || (type === 'Rückruf' ? 'Hoch' : 'Mittel')).trim();

  if (!customerId || !type) return response(400, { error: 'Pflichtfelder fehlen: customer_id, type' });
  if (!['Rückruf', 'Follow-up'].includes(type)) return response(400, { error: 'Ungueltiger Case-Typ' });

  const now = new Date().toISOString();
  const payload = {
    customer_id: customerId,
    type: title,
    status: normalizeCaseStatus('open'),
    priority: null,
    owner: null,
    notes: note || null,
    history: null,
    created_at: now,
    updated_at: now
  };

  const { data, error } = await sbAdmin
    .from('cases')
    .insert(payload)
    .select('*')
    .single();

  if (error) return response(500, { error: 'Case konnte nicht erstellt werden.', details: error.message });
  return response(200, { success: true, case: data });
};
