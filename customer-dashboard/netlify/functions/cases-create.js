const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

const MANUAL_TASKS_DB_EXTENSION_MESSAGE = 'Aufgaben konnten in dieser Umgebung noch nicht gespeichert werden, da die Datenbank-Erweiterung noch nicht aktiv ist.';
const MANUAL_TASKS_PRIORITY_INVALID_MESSAGE = 'Die gewählte Priorität ist in dieser Umgebung nicht verfügbar. Bitte wählen Sie eine andere Priorität oder lassen Sie das Feld leer.';
const DEFAULT_CASE_PRIORITY = 'medium';

function isMissingManualTasksSchema(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  const combined = `${message} ${details} ${hint}`;
  const columnMentioned = /title|note|due_at|phone/.test(combined);
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

function mapPriorityToDb(rawPriority) {
  const key = String(rawPriority || '').trim().toLowerCase();
  if (!key) return DEFAULT_CASE_PRIORITY;
  if (key === 'urgent' || key === 'dringend') return 'high';
  if (key === 'normal') return 'medium';
  if (key === 'high' || key === 'medium' || key === 'low') return key;
  return DEFAULT_CASE_PRIORITY;
}

function normalizeCaseStatus(status) {
  const raw = String(status || '').trim().toLowerCase().replace(/\s+/g, '_');
  const aliases = {
    offen: 'open',
    open: 'open',
    in_bearbeitung: 'in_progress',
    in_progress: 'in_progress',
    wartend: 'waiting',
    waiting: 'waiting',
    geschlossen: 'done',
    erledigt: 'done',
    done: 'done',
    closed: 'done'
  };
  return aliases[raw] || 'open';
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

  const title = String(body.title || body.type || '').trim();
  const note = String(body.note || body.notes || '').trim();
  const dueAt = String(body.due_at || '').trim();
  const phone = String(body.phone || '').trim();
  const status = normalizeCaseStatus(body.status || 'open');
  const priority = mapPriorityToDb(body.priority);

  if (!title) return response(400, { error: 'Titel fehlt.' });
  if (!dueAt) return response(400, { error: 'Fälligkeitsdatum fehlt.' });

  const payload = {
    customer_id: caller.customerId,
    title,
    note: note || null,
    status,
    priority,
    type: String(body.type || 'general').trim() || 'general',
    due_at: dueAt,
    phone: phone || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await sbAdmin
    .from('cases')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    if (isPriorityConstraintError(error)) {
      return response(400, { error: MANUAL_TASKS_PRIORITY_INVALID_MESSAGE, code: 'cases_priority_invalid' });
    }
    if (isMissingManualTasksSchema(error)) {
      return response(503, {
        error: MANUAL_TASKS_DB_EXTENSION_MESSAGE,
        code: 'cases_schema_extension_missing'
      });
    }
    return response(500, { error: 'Case konnte nicht erstellt werden.', details: error.message });
  }

  return response(200, { success: true, case: data });
};
