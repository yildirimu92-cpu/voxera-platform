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
const DEFAULT_CASE_TYPE = 'general';
const ALLOWED_CASE_STATUSES = new Set(['open', 'in_progress', 'waiting', 'done']);
const ALLOWED_CASE_TYPES = new Set(['general', 'task', 'follow_up', 'callback', 'support']);

function log(stage, meta = {}) {
  console.log('[cases-create]', stage, JSON.stringify(meta));
}

function errorPayload(error, code, details) {
  const payload = { error, code };
  if (details !== undefined) payload.details = details;
  return payload;
}

function safeJsonParse(rawBody) {
  try {
    return { ok: true, data: JSON.parse(rawBody || '{}') };
  } catch (error) {
    return { ok: false, error };
  }
}

function isMissingManualTasksSchema(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  const combined = `${message} ${details} ${hint}`;
  const columnMentioned = /title|note|due_at|phone|status|type|priority/.test(combined);
  const relationMentioned = /\bcases\b/.test(combined);
  const schemaIssue = /schema cache|column|does not exist|could not find/.test(combined);
  return relationMentioned && schemaIssue && columnMentioned;
}

function isPriorityConstraintError(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  const combined = `${message} ${details} ${hint}`;
  return combined.includes('cases_priority_check')
    || (/\bcases\b/.test(combined) && /priority/.test(combined) && /violates check constraint/.test(combined));
}

function isDbValidationError(error) {
  const pgCode = String(error?.code || '').trim();
  return ['22P02', '22007', '23502', '23514'].includes(pgCode);
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

function normalizeCaseType(rawType) {
  const key = String(rawType || '').trim().toLowerCase().replace(/\s+/g, '_');
  const aliases = {
    allgemein: 'general',
    general: 'general',
    task: 'task',
    aufgabe: 'task',
    followup: 'follow_up',
    follow_up: 'follow_up',
    nachverfolgung: 'follow_up',
    callback: 'callback',
    rueckruf: 'callback',
    rückruf: 'callback',
    support: 'support'
  };
  const normalized = aliases[key] || DEFAULT_CASE_TYPE;
  if (!ALLOWED_CASE_TYPES.has(normalized)) return DEFAULT_CASE_TYPE;
  return normalized;
}

function sanitizeSupabaseError(error) {
  return {
    message: error?.message || null,
    details: error?.details || null,
    hint: error?.hint || null,
    code: error?.code || null
  };
}

exports.handler = async (event) => {
  log('entry', { method: event?.httpMethod || null });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, errorPayload('Method not allowed', 'method_not_allowed'));

  try {
    const sbUrl = process.env.SUPABASE_URL;
    const sbAnonKey = process.env.SUPABASE_ANON_KEY;
    const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!sbUrl || !sbAnonKey || !sbServiceKey) {
      return response(500, errorPayload('SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.', 'supabase_config_missing'));
    }

    const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    log('auth.start', { requireActiveContract: true });
    const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin, requireActiveContract: true });
    log('auth.result', { ok: caller?.ok, statusCode: caller?.statusCode || 200 });
    if (!caller?.ok) {
      const status = caller?.statusCode || 403;
      const baseCode = status === 403 ? 'guard_denied' : status === 409 ? 'guard_conflict' : 'guard_failed';
      return response(status, {
        error: caller?.body?.error || 'Zugriff verweigert',
        code: caller?.body?.code || baseCode,
        details: caller?.body?.details || null
      });
    }

    log('resolved.customer', { customerId: caller.customerId });
    log('request.raw_body', { body: event?.body || null });

    const parsed = safeJsonParse(event?.body || '{}');
    if (!parsed.ok) {
      log('request.parse_error', { message: parsed.error?.message || null });
      return response(400, errorPayload('Ungültiger Request Body', 'invalid_json', parsed.error?.message || null));
    }

    const body = parsed.data || {};
    const title = String(body.title || body.type || '').trim();
    const note = String(body.note || body.notes || '').trim();
    const dueAt = String(body.due_at || '').trim();
    const phone = String(body.phone || '').trim();
    const status = normalizeCaseStatus(body.status || 'open');
    const priority = mapPriorityToDb(body.priority);
    const type = normalizeCaseType(body.type || DEFAULT_CASE_TYPE);

    log('request.normalized_payload', {
      title,
      note,
      due_at: dueAt,
      phone,
      status,
      priority,
      type
    });

    if (!title) return response(400, errorPayload('Titel fehlt.', 'validation_title_required'));
    if (!dueAt) return response(400, errorPayload('Fälligkeitsdatum fehlt.', 'validation_due_at_required'));

    const dueDate = new Date(dueAt);
    if (Number.isNaN(dueDate.getTime())) {
      return response(400, errorPayload('Fälligkeitsdatum ist ungültig.', 'validation_due_at_invalid', { expected: 'ISO-8601 date string' }));
    }

    if (!ALLOWED_CASE_STATUSES.has(status)) {
      return response(400, errorPayload('Status ist ungültig.', 'validation_status_invalid', { status }));
    }

    const payload = {
      customer_id: caller.customerId,
      title,
      note: note || null,
      status,
      priority,
      type,
      due_at: dueDate.toISOString(),
      phone: phone || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    log('db.insert.payload', payload);

    const { data, error } = await sbAdmin
      .from('cases')
      .insert(payload)
      .select('*')
      .single();

    log('db.insert.response', {
      hasData: Boolean(data),
      hasError: Boolean(error),
      error: error ? sanitizeSupabaseError(error) : null
    });

    if (error) {
      if (isPriorityConstraintError(error)) {
        return response(400, errorPayload(MANUAL_TASKS_PRIORITY_INVALID_MESSAGE, 'cases_priority_invalid', sanitizeSupabaseError(error)));
      }
      if (isMissingManualTasksSchema(error)) {
        return response(503, errorPayload(MANUAL_TASKS_DB_EXTENSION_MESSAGE, 'cases_schema_extension_missing', sanitizeSupabaseError(error)));
      }
      if (isDbValidationError(error)) {
        return response(400, errorPayload('Payload ist nicht mit dem Case-Schema kompatibel.', 'cases_payload_invalid', sanitizeSupabaseError(error)));
      }
      return response(500, errorPayload('Case konnte nicht erstellt werden.', 'cases_create_failed', sanitizeSupabaseError(error)));
    }

    return response(200, { success: true, case: data });
  } catch (error) {
    log('exception.caught', {
      message: error?.message || null,
      stack: error?.stack || null
    });
    return response(500, errorPayload('Unerwarteter Fehler beim Erstellen des Cases.', 'cases_create_unexpected', {
      message: error?.message || null
    }));
  }
};
