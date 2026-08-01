'use strict';

function rolloutCustomerIds() {
  return new Set(
    String(process.env.CALENDAR_ROLLOUT_CUSTOMER_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function calendarEnabledForCustomer(customerId) {
  if (process.env.CALENDAR_INTEGRATION_ENABLED !== 'true') return false;
  const allowed = rolloutCustomerIds();
  return allowed.has('*') || allowed.has(String(customerId || '').trim());
}

module.exports = { calendarEnabledForCustomer, rolloutCustomerIds };
