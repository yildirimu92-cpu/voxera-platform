'use strict';

const { STATUS, normalizeCustomerStatus } = require('./status-model');

const ENTITLED_CUSTOMER_STATUSES = new Set([
  STATUS.customer.ONBOARDING,
  STATUS.customer.READY,
  STATUS.customer.INVITED,
  STATUS.customer.ACTIVATED,
  STATUS.customer.LIVE
]);

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
      message: 'Setup Fee ist noch nicht als bezahlt markiert. Zugang ist bis zur Zahlung gesperrt.',
      customer_status: customerStatus,
      payment_status: paymentStatus
    };
  }

  if (!ENTITLED_CUSTOMER_STATUSES.has(customerStatus)) {
    return {
      entitled: false,
      code: 'status_blocked',
      message: `Kunde ist im Status '${customerStatus}' nicht für produktive Nutzung freigeschaltet.`,
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
  normalizePaymentStatus,
  evaluateCustomerEntitlement
};
