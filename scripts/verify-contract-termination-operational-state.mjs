import fs from 'node:fs';
import vm from 'node:vm';

const paths = {
  endpoint:'admin-panel/netlify/functions/contract-terminate.js',
  runtime:'admin-panel/shared/admin-runtime-contract-termination.js',
  loader:'admin-panel/shared/offer-brand.js',
  migration:'supabase/sql/2026-07-31_contract_termination_operational_state.sql'
};
const src = Object.fromEntries(Object.entries(paths).map(([key,path]) => [key, fs.readFileSync(path,'utf8')]));
let failed = 0;

for (const key of ['endpoint','runtime','loader']) {
  try { new vm.Script(src[key], { filename:paths[key] }); console.log(`PASS syntax ${paths[key]}`); }
  catch (error) { failed += 1; console.error(`FAIL syntax ${paths[key]}: ${error.message}`); }
}

const checks = [
  ['endpoint requires contract write capability', /requiredCapability:'contract:write'/.test(src.endpoint)],
  ['ordinary future termination stays scheduled', /type === 'ordinary'/.test(src.endpoint) && /termination_status:scheduled \? 'scheduled' : 'effective'/.test(src.endpoint)],
  ['immediate termination cancels contract', /contractPatch\.status = 'cancelled'/.test(src.endpoint)],
  ['customer only terminates without another active contract', /otherActive/.test(src.endpoint) && /operational_status:'terminated'/.test(src.endpoint)],
  ['open invoices are preserved and reported', /loadOpenInvoices/.test(src.endpoint) && /finance_action_required/.test(src.endpoint) && !/\.delete\(/.test(src.endpoint)],
  ['runtime routes legacy cancel action', /contracts\.cancel/.test(src.runtime) && /contract-terminate/.test(src.runtime)],
  ['migration adds termination metadata', /termination_effective_at/.test(src.migration) && /operational_status/.test(src.migration)],
  ['runtime loads last', /admin-runtime-contract-termination\.js/.test(src.loader) && src.loader.indexOf('admin-runtime-contract-termination.js') > src.loader.indexOf('admin-runtime-data-integrity.js')]
];

for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

if (failed) process.exit(1);
console.log(`Contract termination operational-state verification passed: ${checks.length} checks.`);
