const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { assertCaseTransition } = require('./_lib/status-model');
const {
  mapManualTaskUiStatusToDb,
  DB_CASE_STATUS_VALUES,
  isStatusConstraintError
} = require('./_lib/case-status');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

const ALLOWED_FIELDS = new Set(['status', 'title', 'note', 'priority']);
const MANUAL_TASKS_DB_EXTENSION_MESSAGE = 'Aufgaben konnten in dieser Umgebung noch nicht gespeichert werden, da die Datenbank-Erweiterung noch nicht aktiv ist.';
const MANUAL_TASKS_PRIORITY_INVALID_MESSAGE = 'Die gewählte Priorität ist ungültig. Bitte verwenden Sie „Normal“, „Dringend“ oder keine Priorität.';
const MANUAL_TASKS_STATUS_INVALID_MESSAGE = `Der Status ist ungültig. Erlaubte Werte: ${DB_CASE_STATUS_VALUES.join(', ')}.`;
const DEFAULT_CASE_PRIORITY = 'medium';

function isMissingManualTasksSchema(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  const combined = `${message} ${details} ${hint}`;
  const columnMentioned = /title|note|due_at|phone/.test(combined);
  const relationMentioned = /\bvoxera_cases\b/.test(combined);
  const schemaIssue = /schema cache|column|does not exist|could not find/.test(combined);
  return columnMentioned && relationMentioned && schemaIssue;
}

function isPriorityConstraintError(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  const combined = `${message} ${details} ${hint}`;
  return combined.includes('voxera_cases_priority_check')
    || (/\bvoxera_cases\b/.test(combined) && /priority/.test(combined) && /violates check constraint/.test(combined));
}

function mapPriorityToDb(rawPriority) {
  const key = String(rawPriority || '').trim().toLowerCase();
  if (!key) return DEFAULT_CASE_PRIORITY;
  if (key === 'urgent' || key === 'dringend') return 'high';
  if (key === 'normal') return 'medium';
  if (key === 'high' || key === 'medium' || key === 'low') return key;
  return DEFAULT_CASE_PRIORITY;
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

  const caseId = String(body.case_id || '').trim();
  const field = String(body.field || '').trim();
  const value = body.value;
  if (!caseId || !field) return response(400, { error: 'Pflichtfelder fehlen: case_id, field' });
  if (!ALLOWED_FIELDS.has(field)) return response(400, { error: `Ungueltiges Feld: ${field}` });

  const { data: current, error: currentError } = await sbAdmin
    .from('voxera_cases')
    .select('*')
    .eq('id', caseId)
    .single();
  if (currentError || !current) return response(404, { error: 'Case nicht gefunden' });

  const updatePayload = { updated_at: new Date().toISOString() };
  if (field === 'status') {
    const fromStatus = mapManualTaskUiStatusToDb(current.status);
    const toStatus = mapManualTaskUiStatusToDb(value);
    try {
      assertCaseTransition(fromStatus, toStatus);
    } catch (e) {
      return response(409, { error: e.message, from_status: fromStatus, to_status: toStatus });
    }
    updatePayload.status = toStatus;
  } else if (field === 'title') {
    const title = String(value || '').trim();
    if (!title) return response(400, { error: 'title darf nicht leer sein' });
    updatePayload.title = title;
  } else if (field === 'note') {
    updatePayload.note = String(value || '').trim() || null;
  } else if (field === 'priority') {
    updatePayload.priority = mapPriorityToDb(value);
  }

  const { data, error } = await sbAdmin
    .from('voxera_cases')
    .update(updatePayload)
    .eq('id', caseId)
    .select('*')
    .single();
  if (error) {
    if (isPriorityConstraintError(error)) {
      return response(400, { error: MANUAL_TASKS_PRIORITY_INVALID_MESSAGE, code: 'cases_priority_invalid' });
    }
    if (isStatusConstraintError(error)) {
      return response(400, {
        error: MANUAL_TASKS_STATUS_INVALID_MESSAGE,
        code: 'cases_status_invalid',
        details: { allowed_statuses: DB_CASE_STATUS_VALUES, received_status: updatePayload.status || value }
      });
    }
    if (isMissingManualTasksSchema(error)) {
      return response(503, {
        error: MANUAL_TASKS_DB_EXTENSION_MESSAGE,
        code: 'cases_schema_extension_missing'
      });
    }
    return response(500, { error: 'Case konnte nicht aktualisiert werden.', details: error.message });
  }

  return response(200, { success: true, case: data });
};
