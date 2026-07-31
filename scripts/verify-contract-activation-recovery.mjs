import fs from 'node:fs';
import vm from 'node:vm';

const paths = {
  endpoint: 'admin-panel/netlify/functions/contract-start-confirm.js',
  service: 'admin-panel/netlify/functions/_lib/contract-activation-service.js'
};

const source = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')])
);

let failed = 0;
for (const [key, path] of Object.entries(paths)) {
  try {
    new vm.Script(source[key], { filename: path });
    console.log(`PASS syntax ${path}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL syntax ${path}: ${error.message}`);
  }
}

const checks = [
  ['endpoint uses recoverable activation service', /activateContractSafely/.test(source.endpoint)],
  ['endpoint preserves orchestration step diagnostics', /step_failed/.test(source.endpoint) && /db_message/.test(source.endpoint)],
  ['endpoint treats lifecycle sync as non-fatal', /syncPostAcceptanceLifecycle failed \(non-fatal\)/.test(source.endpoint)],
  ['active contracts are accepted for recovery', /ACTIVATABLE_STATUSES[\s\S]*'active'/.test(source.service) && /activation_recovery/.test(source.service)],
  ['legacy months column is not written', !/\n\s*months\s*:/.test(source.service)],
  ['canonical duration_months is written', /duration_months:\s*durationMonths/.test(source.service)],
  ['schema fallback only removes optional fields', /OPTIONAL_CONTRACT_COLUMNS/.test(source.service) && /end_date/.test(source.service)],
  ['customer mismatch is rejected server-side', /customer_id stimmt nicht mit dem Vertrag überein/.test(source.service)],
  ['billing orchestration remains idempotent entry point', /orchestrateContractBilling/.test(source.service)],
  ['activation audit distinguishes recovery', /contracts\.activate\.recover/.test(source.service)]
];

for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

if (failed) process.exit(1);
console.log(`Contract activation recovery verification passed: ${checks.length} checks.`);
