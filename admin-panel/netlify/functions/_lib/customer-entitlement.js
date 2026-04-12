'use strict';

const { STATUS, normalizeCustomerStatus } = require('./status-model');

const ENTITLED_CUSTOMER_STATUSES = new Set([
  STATUS.customer.ONBOARDING,
  STATUS.customer.READY,
  STATUS.customer.INVITED,
  STATUS.customer.ACTIVATED,
  STATUS.customer.LIVE
]);

function evaluateCustomerEntitlement(customerRow) {
  const customerStatus = normalizeCustomerStatus(customerRow?.status);

  if (!ENTITLED_CUSTOMER_STATUSES.has(customerStatus)) {
    return {
      entitled: false,
      code: 'status_blocked',
      message: `Kunde ist im Status '${customerStatus}' nicht für produktive Nutzung freigeschaltet.`,
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
  evaluateCustomerEntitlement
};
