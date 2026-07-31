'use strict';

const STATUS = Object.freeze({
  customer: Object.freeze({
    ONBOARDING: 'onboarding',
    READY: 'ready',
    INVITED: 'invited',
    ACTIVATED: 'activated',
    LIVE: 'live',
    PAUSED: 'paused',
    DELETED: 'deleted'
  }),
  onboarding: Object.freeze({
    NOT_STARTED: 'not_started',
    IN_PROGRESS: 'in_progress',
    BLOCKED: 'blocked',
    READY: 'ready',
    COMPLETED: 'completed'
  }),
  access: Object.freeze({
    NOT_SENT: 'not_sent',
    SENT: 'sent',
    ACTIVATED: 'activated'
  }),
  case: Object.freeze({
    OPEN: 'open',
    IN_PROGRESS: 'in_progress',
    WAITING: 'waiting',
    DONE: 'done'
  }),
  call: Object.freeze({
    NEW: 'new',
    IN_PROGRESS: 'in_progress',
    FOLLOW_UP_SCHEDULED: 'follow_up_scheduled',
    CLOSED: 'closed'
  })
});

const LEGACY_CUSTOMER_STATUS_ALIASES = Object.freeze({
  pending: STATUS.customer.ONBOARDING,
  active: STATUS.customer.LIVE,
  aktiv: STATUS.customer.LIVE,
  customer_activated: STATUS.customer.ACTIVATED
});

const CUSTOMER_TRANSITIONS = Object.freeze({
  [STATUS.customer.ONBOARDING]: new Set([STATUS.customer.READY, STATUS.customer.DELETED]),
  [STATUS.customer.READY]: new Set([STATUS.customer.INVITED, STATUS.customer.DELETED]),
  [STATUS.customer.INVITED]: new Set([STATUS.customer.ACTIVATED, STATUS.customer.DELETED]),
  [STATUS.customer.ACTIVATED]: new Set([STATUS.customer.LIVE, STATUS.customer.DELETED]),
  [STATUS.customer.LIVE]: new Set([STATUS.customer.PAUSED, STATUS.customer.DELETED]),
  [STATUS.customer.PAUSED]: new Set([STATUS.customer.LIVE, STATUS.customer.DELETED]),
  [STATUS.customer.DELETED]: new Set([])
});
const ONBOARDING_TRANSITIONS = Object.freeze({
  [STATUS.onboarding.NOT_STARTED]: new Set([STATUS.onboarding.IN_PROGRESS]),
  [STATUS.onboarding.IN_PROGRESS]: new Set([STATUS.onboarding.BLOCKED, STATUS.onboarding.READY]),
  [STATUS.onboarding.BLOCKED]: new Set([STATUS.onboarding.IN_PROGRESS]),
  [STATUS.onboarding.READY]: new Set([STATUS.onboarding.COMPLETED]),
  [STATUS.onboarding.COMPLETED]: new Set([])
});

// Administrative cases are an operational worklist, not a rigid approval chain.
// Direct completion, reopening and returning a task to Open are deliberate and
// prevent the UI from offering status choices that the backend then rejects.
const CASE_TRANSITIONS = Object.freeze({
  [STATUS.case.OPEN]: new Set([STATUS.case.IN_PROGRESS, STATUS.case.WAITING, STATUS.case.DONE]),
  [STATUS.case.IN_PROGRESS]: new Set([STATUS.case.OPEN, STATUS.case.WAITING, STATUS.case.DONE]),
  [STATUS.case.WAITING]: new Set([STATUS.case.OPEN, STATUS.case.IN_PROGRESS, STATUS.case.DONE]),
  [STATUS.case.DONE]: new Set([STATUS.case.OPEN, STATUS.case.IN_PROGRESS])
});
const CALL_TRANSITIONS = Object.freeze({
  [STATUS.call.NEW]: new Set([STATUS.call.IN_PROGRESS]),
  [STATUS.call.IN_PROGRESS]: new Set([STATUS.call.FOLLOW_UP_SCHEDULED]),
  [STATUS.call.FOLLOW_UP_SCHEDULED]: new Set([STATUS.call.CLOSED]),
  [STATUS.call.CLOSED]: new Set([])
});

function normalizeCustomerStatus(status) {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) return STATUS.customer.ONBOARDING;
  return LEGACY_CUSTOMER_STATUS_ALIASES[raw] || raw;
}

function assertTransition(rules, from, to, entity) {
  const normalizedFrom = String(from || '').trim();
  const normalizedTo = String(to || '').trim();
  if (!normalizedFrom || !normalizedTo) {
    throw new Error(`Invalid ${entity} transition payload (from='${normalizedFrom}', to='${normalizedTo}')`);
  }
  if (normalizedFrom === normalizedTo) return;
  const allowedTargets = rules[normalizedFrom];
  if (!allowedTargets || !allowedTargets.has(normalizedTo)) {
    throw new Error(`Illegal ${entity} transition: '${normalizedFrom}' -> '${normalizedTo}'`);
  }
}

function assertCustomerTransition(from, to) {
  return assertTransition(CUSTOMER_TRANSITIONS, normalizeCustomerStatus(from), normalizeCustomerStatus(to), 'customer status');
}

function normalizeOnboardingStatus(status) {
  const raw = String(status || '').trim().toLowerCase().replace(/\s+/g, '_');
  const aliases = {
    notstarted: STATUS.onboarding.NOT_STARTED,
    'not-started': STATUS.onboarding.NOT_STARTED,
    not_started: STATUS.onboarding.NOT_STARTED,
    inprogress: STATUS.onboarding.IN_PROGRESS,
    in_progress: STATUS.onboarding.IN_PROGRESS,
    blocked: STATUS.onboarding.BLOCKED,
    ready: STATUS.onboarding.READY,
    completed: STATUS.onboarding.COMPLETED
  };
  return aliases[raw] || STATUS.onboarding.NOT_STARTED;
}

function normalizeCaseStatus(status) {
  const raw = String(status || '').trim().toLowerCase().replace(/\s+/g, '_');
  const aliases = {
    offen: STATUS.case.OPEN,
    open: STATUS.case.OPEN,
    in_bearbeitung: STATUS.case.IN_PROGRESS,
    in_progress: STATUS.case.IN_PROGRESS,
    wartend: STATUS.case.WAITING,
    waiting: STATUS.case.WAITING,
    geschlossen: STATUS.case.DONE,
    erledigt: STATUS.case.DONE,
    done: STATUS.case.DONE,
    closed: STATUS.case.DONE
  };
  return aliases[raw] || STATUS.case.OPEN;
}

function normalizeCallStatus(status) {
  const raw = String(status || '').trim().toLowerCase().replace(/\s+/g, '_');
  const aliases = {
    neu: STATUS.call.NEW,
    new: STATUS.call.NEW,
    in_bearbeitung: STATUS.call.IN_PROGRESS,
    in_progress: STATUS.call.IN_PROGRESS,
    follow_up_scheduled: STATUS.call.FOLLOW_UP_SCHEDULED,
    'follow-up_geplant': STATUS.call.FOLLOW_UP_SCHEDULED,
    abgeschlossen: STATUS.call.CLOSED,
    erledigt: STATUS.call.CLOSED,
    closed: STATUS.call.CLOSED,
    done: STATUS.call.CLOSED
  };
  return aliases[raw] || STATUS.call.NEW;
}

function assertOnboardingTransition(from, to) {
  return assertTransition(ONBOARDING_TRANSITIONS, normalizeOnboardingStatus(from), normalizeOnboardingStatus(to), 'onboarding status');
}

function assertCaseTransition(from, to) {
  return assertTransition(CASE_TRANSITIONS, normalizeCaseStatus(from), normalizeCaseStatus(to), 'case status');
}

function assertCallTransition(from, to) {
  return assertTransition(CALL_TRANSITIONS, normalizeCallStatus(from), normalizeCallStatus(to), 'call status');
}

module.exports = {
  STATUS,
  normalizeCustomerStatus,
  assertCustomerTransition,
  normalizeOnboardingStatus,
  normalizeCaseStatus,
  normalizeCallStatus,
  assertOnboardingTransition,
  assertCaseTransition,
  assertCallTransition,
  CUSTOMER_TRANSITIONS,
  ONBOARDING_TRANSITIONS,
  CASE_TRANSITIONS,
  CALL_TRANSITIONS
};
