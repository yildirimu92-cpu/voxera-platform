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

module.exports = {
  STATUS,
  normalizeCustomerStatus,
  assertCustomerTransition,
  CUSTOMER_TRANSITIONS
};
