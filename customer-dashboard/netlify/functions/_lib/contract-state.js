const ACTIVE_CONTRACT_STATUSES = new Set(['active', 'signed']);

function normalizeContractStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function resolveContractRowStatus(row) {
  if (!row || typeof row !== 'object') return '';
  return normalizeContractStatus(
    row.status != null
      ? row.status
      : (row.contract_status != null ? row.contract_status : '')
  );
}

function toComparableTime(value) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function contractRecencyScore(row) {
  if (!row || typeof row !== 'object') return 0;
  return Math.max(
    toComparableTime(row.updated_at),
    toComparableTime(row.created_at),
    toComparableTime(row.start_date)
  );
}

function sortContractsByRecency(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => contractRecencyScore(b) - contractRecencyScore(a));
}

function deriveContractState(contractRows) {
  const sortedRows = sortContractsByRecency(contractRows);
  const latestContract = sortedRows[0] || null;
  const activeCandidates = sortedRows.filter((row) => ACTIVE_CONTRACT_STATUSES.has(resolveContractRowStatus(row)));
  const activeContract = activeCandidates[0] || null;
  const effectiveContract = activeContract || latestContract || null;
  const effectiveStatus = resolveContractRowStatus(effectiveContract) || 'none';

  return {
    status: effectiveStatus,
    hasContract: sortedRows.length > 0,
    hasActiveContract: !!activeContract,
    latestContract,
    effectiveContract,
    rows: sortedRows
  };
}

module.exports = {
  ACTIVE_CONTRACT_STATUSES,
  normalizeContractStatus,
  resolveContractRowStatus,
  sortContractsByRecency,
  deriveContractState
};
