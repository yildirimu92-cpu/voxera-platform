'use strict';

const ENTITLED_CUSTOMER_STATUSES = new Set(['onboarding', 'ready', 'invited', 'activated', 'live']);

function normalizeCustomerStatus(status) {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) return 'onboarding';
  if (raw === 'active') return 'live';
  if (raw === 'customer_activated') return 'activated';
  return raw;
}

function normalizePaymentStatus(paymentStatus) {
  const normalized = String(paymentStatus || 'none').trim().toLowerCase();
  if (normalized === 'paid') return 'paid';
  if (normalized === 'pending') return 'pending';
  return 'none';
}

function evaluateCustomerEntitlement(customerRow) {
  const customerStatus = normalizeCustomerStatus(customerRow?.status);
  const paymentStatus = normalizePaymentStatus(customerRow?.payment_status);

  if (paymentStatus !== 'paid') {
    return {
      entitled: false,
      code: 'payment_required',
      message: 'Zugriff gesperrt: Zahlung noch nicht als bezahlt markiert.',
      customer_status: customerStatus,
      payment_status: paymentStatus
    };
  }

  if (!ENTITLED_CUSTOMER_STATUSES.has(customerStatus)) {
    return {
      entitled: false,
      code: 'status_blocked',
      message: `Zugriff gesperrt: Kundenstatus '${customerStatus}' ist nicht berechtigt.`,
      customer_status: customerStatus,
      payment_status: paymentStatus
    };
  }

  return {
    entitled: true,
    code: 'entitled',
    customer_status: customerStatus,
    payment_status: paymentStatus
  };
}

module.exports = {
  ENTITLED_CUSTOMER_STATUSES,
  normalizeCustomerStatus,
  normalizePaymentStatus,
  evaluateCustomerEntitlement
};
