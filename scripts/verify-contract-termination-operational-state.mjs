import fs from 'node:fs';
import vm from 'node:vm';
import { ladeAdminApi, ADMIN_API_PATH } from './lib/admin-api-harness.mjs';

const paths = {
  endpoint:'admin-panel/netlify/functions/contract-terminate.js',
  // Welle 1: admin-runtime-contract-termination.js ist aufgeloest. Die
  // Umleitung ist Regel 5 der Kette, die beiden Praedikate liegen in
  // shared/core/admin-lifecycle.js.
  runtime:ADMIN_API_PATH,
  lifecycle:'admin-panel/shared/core/admin-lifecycle.js',
  loader:'admin-panel/shared/offer-brand.js',
  migration:'supabase/migrations/2026-07-31_contract_termination_operational_state.sql'
};
const src = Object.fromEntries(Object.entries(paths).map(([key,path]) => [key, fs.readFileSync(path,'utf8')]));
const { api } = ladeAdminApi();
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
  // Die Auflösung selbst statt der Schreibweise einer Patch-Datei.
  ['runtime routes legacy cancel action',
    api.resolve('admin-mutate', { action:'contracts.cancel', payload:{ contract_id:'k1', type:'ordinary' } }).name === 'contract-terminate'],
  ['routed payload is the inner payload, not the envelope',
    (() => {
      const p = api.resolve('admin-mutate', { action:'contracts.cancel', payload:{ contract_id:'k1' } }).payload;
      return p && p.contract_id === 'k1' && !('action' in p);
    })()],
  ['migration adds termination metadata', /termination_effective_at/.test(src.migration) && /operational_status/.test(src.migration)],
  // Frueher: "laedt nach data-integrity". Beide Dateien sind aufgeloest, die
  // Reihenfolge ist jetzt die feste Kette in admin-api.js -- kein Rennen mehr,
  // das eine Ladeliste entscheiden koennte.
  ['termination rule runs before the endpoint aliases',
    src.runtime.indexOf('contractTerminationRule,') < src.runtime.indexOf('aliasRule ')],
  ['the two lifecycle predicates have one home',
    /function customerIsOperational/.test(src.lifecycle) && /function invoiceIsReceivable/.test(src.lifecycle)
      && /root\.voxeraCustomerIsOperational/.test(src.lifecycle) && /root\.voxeraInvoiceIsReceivable/.test(src.lifecycle)]
];

for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

if (failed) process.exit(1);
console.log(`Contract termination operational-state verification passed: ${checks.length} checks.`);
