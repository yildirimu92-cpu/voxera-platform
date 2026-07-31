import fs from 'node:fs';
import vm from 'node:vm';

const endpointPath = 'admin-panel/netlify/functions/admin-customer-update.js';
const runtimePath = 'admin-panel/shared/admin-runtime-launch-p0.js';
const endpoint = fs.readFileSync(endpointPath, 'utf8');
const runtime = fs.readFileSync(runtimePath, 'utf8');

let failed = 0;
for (const [path, source] of [[endpointPath, endpoint], [runtimePath, runtime]]) {
  try { new vm.Script(source, { filename:path }); console.log(`PASS syntax ${path}`); }
  catch (error) { failed += 1; console.error(`FAIL syntax ${path}: ${error.message}`); }
}

const checks = [
  ['endpoint requires admin customer write capability', /requireAdminCaller/.test(endpoint) && /requiredCapability: 'customer:write'/.test(endpoint)],
  ['lifecycle fields are protected', /'status'/.test(endpoint) && /'go_live_approved_at'/.test(endpoint) && /'activated_at'/.test(endpoint)],
  ['commercial fields are protected', /'plan_code'/.test(endpoint) && /'payment_status'/.test(endpoint) && /'stripe_subscription_id'/.test(endpoint)],
  ['protected fields are rejected, not silently dropped', /protected_customer_fields/.test(endpoint) && /rejected_fields/.test(endpoint)],
  ['server controls updated_at', /patch\.updated_at = new Date\(\)\.toISOString\(\)/.test(endpoint)],
  ['runtime routes generic customer updates to protected endpoint', /admin-customer-update/.test(runtime) && /payload\?\.action === 'customers\.update'/.test(runtime)]
];

for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

if (failed) process.exit(1);
console.log(`Admin customer write integrity passed: ${checks.length} checks.`);
