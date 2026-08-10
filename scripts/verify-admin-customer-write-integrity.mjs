import fs from 'node:fs';
import vm from 'node:vm';
import { ladeAdminApi, ADMIN_API_PATH } from './lib/admin-api-harness.mjs';

const endpointPath = 'admin-panel/netlify/functions/admin-customer-update.js';
// Welle 1: admin-runtime-data-integrity.js ist aufgeloest. Seine einzige
// Zusage -- generische Kundenschreibvorgaenge auf den geschuetzten Endpunkt
// umzuleiten -- ist Regel 6 der Kette in core/admin-api.js.
const runtimePath = ADMIN_API_PATH;
const loaderPath = 'admin-panel/shared/offer-brand.js';
const endpoint = fs.readFileSync(endpointPath, 'utf8');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const loader = fs.readFileSync(loaderPath, 'utf8');
const { api } = ladeAdminApi();

let failed = 0;
for (const [path, source] of [[endpointPath, endpoint], [runtimePath, runtime], [loaderPath, loader]]) {
  try { new vm.Script(source, { filename:path }); console.log(`PASS syntax ${path}`); }
  catch (error) { failed += 1; console.error(`FAIL syntax ${path}: ${error.message}`); }
}

const checks = [
  ['endpoint requires admin customer write capability', /requireAdminCaller/.test(endpoint) && /requiredCapability: 'customer:write'/.test(endpoint)],
  ['lifecycle fields are protected', /'status'/.test(endpoint) && /'go_live_approved_at'/.test(endpoint) && /'activated_at'/.test(endpoint)],
  ['commercial fields are protected', /'plan_code'/.test(endpoint) && /'payment_status'/.test(endpoint) && /'stripe_subscription_id'/.test(endpoint)],
  ['protected fields are rejected, not silently dropped', /protected_customer_fields/.test(endpoint) && /rejected_fields/.test(endpoint)],
  ['server controls updated_at', /patch\.updated_at = new Date\(\)\.toISOString\(\)/.test(endpoint)],
  // Nicht mehr die Schreibweise einer Patch-Datei, sondern die Auflösung
  // selbst: derselbe Weg, den der Browser nimmt.
  ['runtime routes generic customer updates to protected endpoint',
    api.resolve('admin-mutate', { action: 'customers.update', id: 'c1', patch: { name: 'X' } }).name === 'admin-customer-update'],
  ['routed payload keeps id and patch, nothing else',
    (() => {
      const p = api.resolve('admin-mutate', { action: 'customers.update', id: 'c1', patch: { name: 'X' } }).payload;
      return p && p.id === 'c1' && p.patch && p.patch.name === 'X' && !('action' in p);
    })()],
  // Die frühere Zusage lautete "data-integrity lädt nach launch-p0" -- eine
  // Reihenfolge zwischen zwei nachgeladenen Dateien. Beide sind aufgelöst; die
  // Reihenfolge ist jetzt die feste Regelkette, und der Weg zum Server steht
  // deterministisch im Kopf von index.html statt im Nachladerennen.
  ['no runtime patch redirects customer writes any more',
    !fs.readdirSync('admin-panel/shared')
      .filter((name) => /^admin-runtime-.*\.js$/.test(name))
      .some((name) => /(?:w|root|window)\.callAdminFunction\s*=\s*[^=]/
        .test(fs.readFileSync(`admin-panel/shared/${name}`, 'utf8')))],
  // Der Weg zum Server steht als Skript-Tag im Kopf, nicht in der Nachladeliste
  // von offer-brand.js -- sonst waere seine Verfuegbarkeit wieder ein Rennen.
  // Geprueft wird die Liste, nicht der Dateitext: ein Kommentar, der das Modul
  // beim Namen nennt, ist keine Ladeanweisung.
  ['the single path to the server is loaded deterministically',
    fs.readFileSync('admin-panel/index.html', 'utf8').includes('/shared/core/admin-api.js')
      && ![...loader.matchAll(/'\/shared\/([a-z0-9/.-]+\.js)/g)].some((m) => m[1].startsWith('core/'))]
];

for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

if (failed) process.exit(1);
console.log(`Admin customer write integrity passed: ${checks.length} checks.`);
