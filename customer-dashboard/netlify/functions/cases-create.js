const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');
const {
  mapManualTaskUiStatusToDb,
  isValidCaseStatus,
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

const MANUAL_TASKS_DB_EXTENSION_MESSAGE = 'Aufgaben konnten in dieser Umgebung noch nicht gespeichert werden, da die Datenbank-Erweiterung noch nicht aktiv ist.';
const MANUAL_TASKS_PRIORITY_INVALID_MESSAGE = 'Die gewählte Priorität ist in dieser Umgebung nicht verfügbar. Bitte wählen Sie eine andere Priorität oder lassen Sie das Feld leer.';
const MANUAL_TASKS_STATUS_INVALID_MESSAGE = `Der Status ist ungültig. Erlaubte Werte: ${DB_CASE_STATUS_VALUES.join(', ')}.`;
const DEFAULT_CASE_PRIORITY = 'medium';
const DEFAULT_CASE_TYPE = 'general';
const ALLOWED_CASE_TYPES = new Set(['general', 'task', 'follow_up', 'callback', 'support']);

function log(stage, meta = {}) {
  try {
    console.log('[cases-create]', stage, JSON.stringify(meta));
  } catch (_error) {
    console.log('[cases-create]', stage, '[unserializable-meta]');
  }
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

function normalizeDueAtForDb(rawDueAt) {
  const raw = String(rawDueAt || '').trim();
  if (!raw) return { ok: false, reason: 'missing' };

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: true, value: raw };
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, reason: 'invalid' };
  }

  const dateOnly = parsed.toISOString().slice(0, 10);
  return { ok: true, value: dateOnly };
}

function detectLikelyFieldMismatch(error) {
  const combined = `${String(error?.message || '')} ${String(error?.details || '')} ${String(error?.hint || '')}`.toLowerCase();
  if (combined.includes('due_at')) return 'due_at';
  if (combined.includes('priority')) return 'priority';
  if (combined.includes('status')) return 'status';
  if (combined.includes('type')) return 'type';
  if (combined.includes('title')) return 'title';
  if (combined.includes('note')) return 'note';
  if (combined.includes('phone')) return 'phone';
  if (combined.includes('customer_id')) return 'customer_id';
  return null;
}

function safeBodyForLog(body) {
  const raw = String(body || '');
  if (raw.length <= 2500) return raw;
  return `${raw.slice(0, 2500)}…[truncated:${raw.length}]`;
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
    log('auth.result', {
      ok: caller?.ok,
      statusCode: caller?.statusCode || 200,
      code: caller?.body?.code || null,
      error: caller?.body?.error || null
    });
    if (!caller?.ok) {
      const status = caller?.statusCode || 403;
      const baseCode = status === 401
        ? 'guard_unauthorized'
        : status === 403
          ? 'guard_denied'
          : status === 409
            ? 'guard_conflict'
            : 'guard_failed';
      return response(status, {
        error: caller?.body?.error || 'Zugriff verweigert',
        code: caller?.body?.code || baseCode,
        details: caller?.body?.details || null
      });
    }

    if (!caller.customerId) {
      log('auth.missing_customer_id', { caller });
      return response(409, errorPayload('Customer-Kontext konnte nicht aufgelöst werden.', 'guard_customer_context_invalid'));
    }

    log('resolved.customer', { customerId: caller.customerId, userId: caller.userId || null });
    log('request.raw_body', { body: safeBodyForLog(event?.body) });

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
    const status = mapManualTaskUiStatusToDb(body.status || 'open');
    const priority = mapPriorityToDb(body.priority);
    const type = normalizeCaseType(body.type || DEFAULT_CASE_TYPE);

    const dueAtDb = normalizeDueAtForDb(dueAt);

    log('request.normalized_payload', {
      title,
      note,
      due_at_input: dueAt,
      due_at_db: dueAtDb.ok ? dueAtDb.value : null,
      phone,
      status,
      priority,
      type
    });

    if (!title) return response(400, errorPayload('Titel fehlt.', 'validation_title_required'));
    if (!dueAt) return response(400, errorPayload('Fälligkeitsdatum fehlt.', 'validation_due_at_required'));

    if (!dueAtDb.ok) {
      return response(400, errorPayload('Fälligkeitsdatum ist ungültig.', 'validation_due_at_invalid', {
        expected: 'YYYY-MM-DD oder parsebarer ISO-Date-String',
        received: dueAt
      }));
    }

    if (!isValidCaseStatus(status)) {
      return response(400, errorPayload('Status ist ungültig.', 'validation_status_invalid', { status }));
    }

    const payload = {
      customer_id: caller.customerId,
      title,
      note: note || null,
      status,
      priority,
      type,
      due_at: dueAtDb.value,
      phone: phone || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    log('db.insert.payload', {
      table: 'cases',
      payload,
      keys: Object.keys(payload)
    });

    let { data, error } = await sbAdmin
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
      const dbError = sanitizeSupabaseError(error);
      const mismatchedField = detectLikelyFieldMismatch(error);
      if (isDbValidationError(error) && mismatchedField === 'type') {
        const payloadWithoutType = { ...payload };
        delete payloadWithoutType.type;
        log('db.insert.retry_without_type', {
          reason: 'type_field_validation_mismatch',
          original_error: dbError,
          payload_keys: Object.keys(payloadWithoutType)
        });
        const retried = await sbAdmin
          .from('cases')
          .insert(payloadWithoutType)
          .select('*')
          .single();
        data = retried.data;
        error = retried.error;
      }
    }

    if (error) {
      const dbError = sanitizeSupabaseError(error);
      const mismatchedField = detectLikelyFieldMismatch(error);
      log('db.insert.error_classification', {
        isPriorityConstraintError: isPriorityConstraintError(error),
        isMissingManualTasksSchema: isMissingManualTasksSchema(error),
        isDbValidationError: isDbValidationError(error),
        code: error?.code || null,
        mismatchedField
      });
      if (isPriorityConstraintError(error)) {
        return response(400, errorPayload(MANUAL_TASKS_PRIORITY_INVALID_MESSAGE, 'cases_priority_invalid', {
          db_error: dbError,
          mismatched_field: mismatchedField
        }));
      }
      if (isStatusConstraintError(error)) {
        return response(400, errorPayload(MANUAL_TASKS_STATUS_INVALID_MESSAGE, 'cases_status_invalid', {
          db_error: dbError,
          mismatched_field: mismatchedField,
          allowed_statuses: DB_CASE_STATUS_VALUES,
          received_status: status
        }));
      }
      if (isMissingManualTasksSchema(error)) {
        return response(503, errorPayload(MANUAL_TASKS_DB_EXTENSION_MESSAGE, 'cases_schema_extension_missing', {
          db_error: dbError,
          mismatched_field: mismatchedField
        }));
      }
      if (isDbValidationError(error)) {
        return response(400, errorPayload('Payload ist nicht mit dem Case-Schema kompatibel.', 'cases_payload_invalid', {
          db_error: dbError,
          mismatched_field: mismatchedField
        }));
      }
      return response(500, errorPayload('Case konnte nicht erstellt werden.', 'cases_create_failed', {
        db_error: dbError,
        mismatched_field: mismatchedField
      }));
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
