'use strict';

const DB_CASE_STATUS_VALUES = Object.freeze(['open', 'in_progress', 'waiting', 'done']);
const DB_CASE_STATUS_SET = new Set(DB_CASE_STATUS_VALUES);

const DB_CASE_PRIORITY_VALUES = Object.freeze(['low', 'medium', 'high']);
const DB_CASE_PRIORITY_SET = new Set(DB_CASE_PRIORITY_VALUES);

// `type` has no DB check constraint yet; canonical values are enforced here.
const DB_CASE_TYPE_VALUES = Object.freeze(['general', 'callback', 'follow_up', 'appointment', 'information']);
const DB_CASE_TYPE_SET = new Set(DB_CASE_TYPE_VALUES);

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

const MANUAL_TASK_UI_PRIORITY_TO_DB = Object.freeze({
  dringend: 'high',
  urgent: 'high',
  hoch: 'high',
  high: 'high',
  normal: 'medium',
  mittel: 'medium',
  medium: 'medium',
  niedrig: 'low',
  low: 'low'
});

const MANUAL_TASK_UI_TYPE_TO_DB = Object.freeze({
  allgemein: 'general',
  general: 'general',
  aufgabe: 'general',
  task: 'general',
  rueckruf: 'callback',
  rückruf: 'callback',
  callback: 'callback',
  followup: 'follow_up',
  follow_up: 'follow_up',
  'follow-up': 'follow_up',
  nachverfolgung: 'follow_up',
  appointment: 'appointment',
  termin: 'appointment',
  information: 'information',
  'information_senden': 'information',
  support: 'information'
});

function normalizeStatusForDb(rawStatus, options = {}) {
  const fallback = options.fallback || 'open';
  const raw = String(rawStatus || '').trim().toLowerCase().replace(/\s+/g, '_');
  const normalized = MANUAL_TASK_UI_STATUS_TO_DB[raw];
  if (normalized && DB_CASE_STATUS_SET.has(normalized)) return normalized;
  if (DB_CASE_STATUS_SET.has(raw)) return raw;
  return DB_CASE_STATUS_SET.has(fallback) ? fallback : 'open';
}

function normalizePriorityForDb(rawPriority, options = {}) {
  const fallback = options.fallback || 'medium';
  const raw = String(rawPriority || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!raw) return DB_CASE_PRIORITY_SET.has(fallback) ? fallback : 'medium';
  const normalized = MANUAL_TASK_UI_PRIORITY_TO_DB[raw];
  if (normalized && DB_CASE_PRIORITY_SET.has(normalized)) return normalized;
  if (DB_CASE_PRIORITY_SET.has(raw)) return raw;
  return DB_CASE_PRIORITY_SET.has(fallback) ? fallback : 'medium';
}

function normalizeTypeForDb(rawType, options = {}) {
  const fallback = options.fallback || 'general';
  const raw = String(rawType || '').trim().toLowerCase().replace(/\s+/g, '_');
  const normalized = MANUAL_TASK_UI_TYPE_TO_DB[raw];
  if (normalized && DB_CASE_TYPE_SET.has(normalized)) return normalized;
  if (DB_CASE_TYPE_SET.has(raw)) return raw;
  return DB_CASE_TYPE_SET.has(fallback) ? fallback : 'general';
}

function isValidCaseStatus(status) {
  return DB_CASE_STATUS_SET.has(String(status || '').trim().toLowerCase());
}

function isValidCasePriority(priority) {
  return DB_CASE_PRIORITY_SET.has(String(priority || '').trim().toLowerCase());
}

function normalizeDueAtForDb(rawDueAt) {
  const raw = String(rawDueAt || '').trim();
  if (!raw) return { ok: false, reason: 'missing' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ok: true, value: raw };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { ok: false, reason: 'invalid' };
  return { ok: true, value: parsed.toISOString().slice(0, 10) };
}

function normalizeDueTimeForDb(rawDueTime) {
  const raw = String(rawDueTime || '').trim();
  if (!raw) return { ok: true, value: null };
  const hhmm = raw.match(/^(\d{2}):(\d{2})$/);
  if (!hhmm) return { ok: false, reason: 'invalid_format' };
  const hours = Number(hhmm[1]);
  const minutes = Number(hhmm[2]);
  if (hours > 23 || minutes > 59) return { ok: false, reason: 'invalid_range' };
  return { ok: true, value: `${hhmm[1]}:${hhmm[2]}` };
}

module.exports = {
  DB_CASE_STATUS_VALUES,
  DB_CASE_PRIORITY_VALUES,
  DB_CASE_TYPE_VALUES,
  normalizeStatusForDb,
  normalizePriorityForDb,
  normalizeTypeForDb,
  normalizeDueAtForDb,
  normalizeDueTimeForDb,
  isValidCaseStatus,
  isValidCasePriority
};
