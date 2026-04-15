'use strict';

const {
  DB_CASE_STATUS_VALUES,
  normalizeStatusForDb,
  isValidCaseStatus
} = require('./manual-task-model');

function mapManualTaskUiStatusToDb(rawStatus, options = {}) {
  return normalizeStatusForDb(rawStatus, options);
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
  normalizeCaseStatusForDb: normalizeStatusForDb,
  isValidCaseStatus,
  isStatusConstraintError
};
