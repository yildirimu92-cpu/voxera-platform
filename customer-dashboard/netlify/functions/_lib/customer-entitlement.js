'use strict';

const ENTITLED_CUSTOMER_STATUSES = new Set(['onboarding', 'ready', 'invited', 'activated', 'live']);

function normalizeCustomerStatus(status) {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) return 'onboarding';
  if (raw === 'active') return 'live';
  if (raw === 'customer_activated') return 'activated';
  return raw;
}

function evaluateCustomerEntitlement(customerRow) {
  const customerStatus = normalizeCustomerStatus(customerRow?.status);

  if (!ENTITLED_CUSTOMER_STATUSES.has(customerStatus)) {
    return {
      entitled: false,
      code: 'status_blocked',
      message: `Zugriff gesperrt: Kundenstatus '${customerStatus}' ist nicht berechtigt.`,
      customer_status: customerStatus
    };
  }

  return {
    entitled: true,
    code: 'entitled',
    customer_status: customerStatus
  };
}

module.exports = {
  ENTITLED_CUSTOMER_STATUSES,
  normalizeCustomerStatus,
  evaluateCustomerEntitlement
};
