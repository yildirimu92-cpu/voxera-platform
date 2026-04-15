const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');
const {
  mapManualTaskUiStatusToDb,
  DB_CASE_STATUS_VALUES,
  isStatusConstraintError
} = require('./_lib/case-status');
const {
  normalizePriorityForDb,
  normalizeTypeForDb,
  normalizeDueAtForDb,
  normalizeDueTimeForDb
} = require('./_lib/manual-task-model');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

const ALLOWED_FIELDS = new Set(['status', 'title', 'note', 'priority', 'type', 'due_at', 'due_time', 'phone']);
const MANUAL_TASKS_DB_EXTENSION_MESSAGE = 'Aufgaben konnten in dieser Umgebung noch nicht gespeichert werden, da die Datenbank-Erweiterung noch nicht aktiv ist.';
const MANUAL_TASKS_PRIORITY_INVALID_MESSAGE = 'Die gewählte Priorität ist in dieser Umgebung nicht verfügbar. Bitte wählen Sie eine andere Priorität oder lassen Sie das Feld leer.';
const MANUAL_TASKS_STATUS_INVALID_MESSAGE = `Der Status ist ungültig. Erlaubte Werte: ${DB_CASE_STATUS_VALUES.join(', ')}.`;
const MANUAL_TASKS_DUE_TIME_INVALID_MESSAGE = 'Die Uhrzeit ist ungültig. Bitte verwenden Sie das Format HH:MM (z. B. 14:30).';
const MANUAL_TASKS_DUE_TIME_UNAVAILABLE_MESSAGE = 'Die Uhrzeit kann aktuell noch nicht gespeichert werden, da die Datenbankspalte due_time in dieser Umgebung fehlt. Bitte speichern Sie vorerst ohne Uhrzeit.';

const CASE_TRANSITIONS = {
  open: new Set(['in_progress']),
  in_progress: new Set(['waiting', 'done']),
  waiting: new Set(['in_progress']),
  done: new Set([])
};

function isMissingManualTasksSchema(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  const combined = `${message} ${details} ${hint}`;
  const columnMentioned = /title|note|due_at|due_time|phone|type|priority|status/.test(combined);
  const relationMentioned = /\bcases\b/.test(combined);
  const schemaIssue = /schema cache|column|does not exist|could not find/.test(combined);
  return columnMentioned && relationMentioned && schemaIssue;
}

function isPriorityConstraintError(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  const combined = `${message} ${details} ${hint}`;
  return combined.includes('cases_priority_check')
    || (/\bcases\b/.test(combined) && /priority/.test(combined) && /violates check constraint/.test(combined));
}

function isDueTimeColumnMissing(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  const combined = `${message} ${details} ${hint}`;
  return /\bcases\b/.test(combined)
    && /\bdue_time\b/.test(combined)
    && /(schema cache|column|does not exist|could not find)/.test(combined);
}

function assertCaseTransition(from, to) {
  if (from === to) return;
  const allowed = CASE_TRANSITIONS[from] || new Set();
  if (!allowed.has(to)) {
    throw new Error(`Ungültiger Status-Übergang: ${from} → ${to}`);
  }
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
  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin, requireActiveContract: true });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return response(400, { error: 'Ungültiger Request Body' }); }

  const caseId = String(body.case_id || '').trim();
  const updates = body.updates && typeof body.updates === 'object' && !Array.isArray(body.updates)
    ? body.updates
    : null;
  const field = String(body.field || '').trim();
  const value = body.value;
  if (!caseId) return response(400, { error: 'Pflichtfeld fehlt: case_id', code: 'validation_case_id_required' });
  if (!updates && !field) return response(400, { error: 'Pflichtfelder fehlen: case_id und updates oder field/value', code: 'validation_updates_required' });
  if (field && !ALLOWED_FIELDS.has(field)) return response(400, { error: `Ungültiges Feld: ${field}`, code: 'validation_field_invalid' });

  const { data: current, error: currentError } = await sbAdmin
    .from('cases')
    .select('*')
    .eq('id', caseId)
    .eq('customer_id', caller.customerId)
    .single();
  if (currentError || !current) return response(404, { error: 'Case nicht gefunden' });

  const updatePayload = { updated_at: new Date().toISOString() };
  const requestedUpdates = updates || { [field]: value };

  if (Object.prototype.hasOwnProperty.call(requestedUpdates, 'status')) {
    const fromStatus = mapManualTaskUiStatusToDb(current.status || 'open');
    const toStatus = mapManualTaskUiStatusToDb(requestedUpdates.status);
    try {
      assertCaseTransition(fromStatus, toStatus);
    } catch (e) {
      return response(409, { error: e.message, from_status: fromStatus, to_status: toStatus });
    }
    updatePayload.status = toStatus;
  }

  if (Object.prototype.hasOwnProperty.call(requestedUpdates, 'title')) {
    const title = String(requestedUpdates.title || '').trim();
    if (!title) return response(400, { error: 'title darf nicht leer sein' });
    updatePayload.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(requestedUpdates, 'note')) {
    updatePayload.note = String(requestedUpdates.note || '').trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(requestedUpdates, 'priority')) {
    updatePayload.priority = normalizePriorityForDb(requestedUpdates.priority);
  }

  if (Object.prototype.hasOwnProperty.call(requestedUpdates, 'type')) {
    updatePayload.type = normalizeTypeForDb(requestedUpdates.type);
  }

  if (Object.prototype.hasOwnProperty.call(requestedUpdates, 'phone')) {
    updatePayload.phone = String(requestedUpdates.phone || '').trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(requestedUpdates, 'due_at')) {
    const dueAtDb = normalizeDueAtForDb(requestedUpdates.due_at);
    if (!dueAtDb.ok) {
      return response(400, { error: 'Fälligkeitsdatum ist ungültig.', code: 'validation_due_at_invalid' });
    }
    updatePayload.due_at = dueAtDb.value;
  }

  if (Object.prototype.hasOwnProperty.call(requestedUpdates, 'due_time')) {
    const dueTimeDb = normalizeDueTimeForDb(requestedUpdates.due_time);
    if (!dueTimeDb.ok) {
      return response(400, { error: MANUAL_TASKS_DUE_TIME_INVALID_MESSAGE, code: 'validation_due_time_invalid' });
    }
    updatePayload.due_time = dueTimeDb.value;
  }

  if (Object.keys(updatePayload).length === 1) {
    return response(400, { error: 'Keine zulässigen Felder zum Aktualisieren übergeben.', code: 'validation_no_mutable_fields' });
  }

  const { data, error } = await sbAdmin
    .from('cases')
    .update(updatePayload)
    .eq('id', caseId)
    .eq('customer_id', caller.customerId)
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
        details: { allowed_statuses: DB_CASE_STATUS_VALUES, received_status: updatePayload.status || requestedUpdates.status || value }
      });
    }
    if (isMissingManualTasksSchema(error)) {
      if (Object.prototype.hasOwnProperty.call(updatePayload, 'due_time') && isDueTimeColumnMissing(error)) {
        return response(409, {
          error: MANUAL_TASKS_DUE_TIME_UNAVAILABLE_MESSAGE,
          code: 'cases_due_time_unavailable'
        });
      }
      return response(503, {
        error: MANUAL_TASKS_DB_EXTENSION_MESSAGE,
        code: 'cases_schema_extension_missing'
      });
    }
    return response(500, { error: 'Case konnte nicht aktualisiert werden.', details: error.message });
  }

  return response(200, { success: true, case: data });
};
