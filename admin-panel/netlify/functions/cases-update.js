const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { normalizeCaseStatus, assertCaseTransition } = require('./_lib/status-model');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

const ALLOWED_FIELDS = new Set(['status', 'title', 'note']);

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

  const caseId = String(body.case_id || '').trim();
  const field = String(body.field || '').trim();
  const value = body.value;
  if (!caseId || !field) return response(400, { error: 'Pflichtfelder fehlen: case_id, field' });
  if (!ALLOWED_FIELDS.has(field)) return response(400, { error: `Ungueltiges Feld: ${field}` });

  const { data: current, error: currentError } = await sbAdmin
    .from('cases')
    .select('*')
    .eq('id', caseId)
    .single();
  if (currentError || !current) return response(404, { error: 'Case nicht gefunden' });

  const updatePayload = { updated_at: new Date().toISOString() };
  if (field === 'status') {
    const fromStatus = normalizeCaseStatus(current.status);
    const toStatus = normalizeCaseStatus(value);
    try {
      assertCaseTransition(fromStatus, toStatus);
    } catch (e) {
      return response(409, { error: e.message, from_status: fromStatus, to_status: toStatus });
    }
    updatePayload.status = toStatus;
  } else if (field === 'title') {
    const title = String(value || '').trim();
    if (!title) return response(400, { error: 'title darf nicht leer sein' });
    updatePayload.type = title;
  } else if (field === 'note') {
    updatePayload.notes = String(value || '').trim() || null;
  }

  const { data, error } = await sbAdmin
    .from('cases')
    .update(updatePayload)
    .eq('id', caseId)
    .select('*')
    .single();
  if (error) return response(500, { error: 'Case konnte nicht aktualisiert werden.', details: error.message });

  return response(200, { success: true, case: data });
};
