import fs from 'node:fs';

const lifecycle = fs.readFileSync('admin-panel/netlify/functions/lifecycle-runner.js', 'utf8');
const adminToml = fs.readFileSync('admin-panel/netlify.toml', 'utf8');
const retention = fs.readFileSync('customer-dashboard/netlify/functions/enforce-data-retention.js', 'utf8');
const customerToml = fs.readFileSync('customer-dashboard/netlify.toml', 'utf8');

const failures = [];

for (const token of [
  "process.env.LIFECYCLE_ENFORCEMENT_ENABLED === 'true'",
  "mail_type: 'contract_expired_email'",
  "action: 'contracts.expire'",
  "other_active_contract",
  "status: 'expired'"
]) {
  if (!lifecycle.includes(token)) failures.push(`Lifecycle runner missing: ${token}`);
}

if (!adminToml.includes('[functions."lifecycle-runner"]')) {
  failures.push('Lifecycle runner schedule missing from admin-panel/netlify.toml');
}

for (const token of [
  "DATA_RETENTION_ENFORCEMENT_ENABLED !== 'true'",
  'TRANSCRIPT_RETENTION_DAYS = 90',
  'CALL_RECORD_RETENTION_DAYS = 180'
]) {
  if (!retention.includes(token)) failures.push(`Retention guard missing: ${token}`);
}

if (!customerToml.includes('[functions."enforce-data-retention"]')) {
  failures.push('Retention schedule missing from customer-dashboard/netlify.toml');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Lifecycle and retention verification passed.');
