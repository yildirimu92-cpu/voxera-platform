'use strict';

const DB_CASE_STATUS_VALUES = Object.freeze(['open', 'in_progress', 'waiting', 'done']);
const DB_CASE_STATUS_SET = new Set(DB_CASE_STATUS_VALUES);

const MANUAL_TASK_UI_STATUS_TO_DB = Object.freeze({
  offen: 'open',
  open: 'open',
  in_bearbeitung: 'in_progress',
  'in bearbeitung': 'in_progress',
  in_progress: 'in_progress',
  erledigt: 'done',
  abgeschlossen: 'done',
  done: 'done',
  geschlossen: 'done',
  closed: 'done',
  wartend: 'waiting',
  waiting: 'waiting'
});

function normalizeCaseStatusForDb(rawStatus, options = {}) {
  const fallback = options.fallback || 'open';
  const raw = String(rawStatus || '').trim().toLowerCase().replace(/\s+/g, '_');
  const normalized = MANUAL_TASK_UI_STATUS_TO_DB[raw];
  if (normalized && DB_CASE_STATUS_SET.has(normalized)) return normalized;
  if (DB_CASE_STATUS_SET.has(raw)) return raw;
  return DB_CASE_STATUS_SET.has(fallback) ? fallback : 'open';
}

function mapManualTaskUiStatusToDb(rawStatus, options = {}) {
  return normalizeCaseStatusForDb(rawStatus, options);
}

function isValidCaseStatus(status) {
  return DB_CASE_STATUS_SET.has(String(status || '').trim().toLowerCase());
}

function isStatusConstraintError(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  const combined = `${message} ${details} ${hint}`;
  return combined.includes('cases_status_check')
    || (/\bcases\b/.test(combined) && /status/.test(combined) && /violates check constraint/.test(combined));
}

module.exports = {
  DB_CASE_STATUS_VALUES,
  mapManualTaskUiStatusToDb,
  normalizeCaseStatusForDb,
  isValidCaseStatus,
  isStatusConstraintError
};
