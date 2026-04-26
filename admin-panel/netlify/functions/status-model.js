'use strict';

const STATUS = Object.freeze({
  customer: Object.freeze({
    DRAFT:       'draft',
    INVITED:     'invited',
    ONBOARDING:  'onboarding',
    ACTIVE:      'active',
    PAUSED:      'paused',
    SUSPENDED:   'suspended',
    CANCELLED:   'cancelled',
    ARCHIVED:    'archived',
  }),
  onboarding: Object.freeze({
    NOT_STARTED: 'not_started',
    IN_PROGRESS: 'in_progress',
    BLOCKED:     'blocked',
    COMPLETED:   'completed',
  }),
  access: Object.freeze({
    NOT_SENT:  'not_sent',
    SENT:      'sent',
    ACCEPTED:  'accepted',
    EXPIRED:   'expired',
    REVOKED:   'revoked',
  }),
});

const CUSTOMER_TRANSITIONS = Object.freeze({
  draft:      new Set(['invited','onboarding','active','cancelled','archived']),
  invited:    new Set(['onboarding','active','cancelled','archived']),
  onboarding: new Set(['active','paused','suspended','cancelled','archived']),
  active:     new Set(['paused','suspended','cancelled','archived']),
  paused:     new Set(['active','suspended','cancelled','archived']),
  suspended:  new Set(['active','cancelled','archived']),
  cancelled:  new Set(['archived']),
  archived:   new Set([]),
});

const ONBOARDING_TRANSITIONS = Object.freeze({
  not_started: new Set(['in_progress','blocked']),
  in_progress: new Set(['completed','blocked','not_started']),
  blocked:     new Set(['in_progress','not_started']),
  completed:   new Set(['in_progress']),
});

function normalizeCustomerStatus(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return STATUS.customer.DRAFT;
  if (v === 'paused') return STATUS.customer.SUSPENDED;
  return v;
}

function normalizeOnboardingStatus(raw) {
  const v = String(raw || '').trim().toLowerCase().replace(/-/g, '_');
  if (!v) return STATUS.onboarding.NOT_STARTED;
  if (v === 'pending') return STATUS.onboarding.NOT_STARTED;
  return v;
}

function assertOnboardingTransition(from, to) {
  const source = normalizeOnboardingStatus(from);
  const target = normalizeOnboardingStatus(to);
  if (source === target) return;
  const allowed = ONBOARDING_TRANSITIONS[source] || new Set();
  if (!allowed.has(target)) {
    throw new Error(`Illegal onboarding transition: '${source}' -> '${target}'`);
  }
}

function assertCustomerTransition(from, to) {
  const source = normalizeCustomerStatus(from);
  const target = normalizeCustomerStatus(to);
  if (source === target) return;
  const allowed = CUSTOMER_TRANSITIONS[source] || new Set();
  if (!allowed.has(target)) {
    throw new Error(`Illegal customer transition: '${source}' -> '${target}'`);
  }
}

module.exports = {
  STATUS,
  normalizeCustomerStatus,
  normalizeOnboardingStatus,
  assertOnboardingTransition,
  assertCustomerTransition,
  CUSTOMER_TRANSITIONS,
  ONBOARDING_TRANSITIONS,
};
