import fs from 'node:fs';
import vm from 'node:vm';

const paths = {
  gate: 'admin-panel/netlify/functions/customer-go-live.js',
  runtime: 'admin-panel/shared/admin-runtime-launch-p0.js',
  loader: 'admin-panel/shared/offer-brand.js'
};
const source = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')]));
let failed = 0;

for (const [key, path] of Object.entries(paths)) {
  try {
    new vm.Script(source[key], { filename:path });
    console.log(`PASS syntax ${path}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL syntax ${path}: ${error.message}`);
  }
}

const checks = [
  ['go-live endpoint supports read-only readiness check', /\['check', 'approve', 'go_live'\]/.test(source.gate) && /action === 'check'/.test(source.gate)],
  ['readiness remains admin lifecycle protected', /requiredCapability: 'lifecycle:approve'/.test(source.gate)],
  ['latest ElevenLabs sync is loaded server-side', /from\('elevenlabs_sync_log'\)/.test(source.gate) && /limit\(1\)/.test(source.gate)],
  ['current agent must match latest successful sync', /agent_matches/.test(source.gate) && /currentAgentId === latestAgentId/.test(source.gate)],
  ['failed or missing sync blocks launch', /Der letzte ElevenLabs-Sync ist fehlgeschlagen/.test(source.gate) && /noch kein erfolgreicher Sync dokumentiert/.test(source.gate)],
  ['readiness returns technical evidence and decisions', /technical_gate: gate/.test(source.gate) && /can_approve/.test(source.gate) && /can_go_live/.test(source.gate)],
  ['approve and go-live errors include evidence', /evidence: gate\.evidence/.test(source.gate) && /evidence: finalGate\.evidence/.test(source.gate)],
  ['runtime requests server readiness on modal open', /action:'check'/.test(source.runtime) && /openCustomerGoLiveModal/.test(source.runtime)],
  ['runtime blocks submit when server gate fails', /voxServerBlocked/.test(source.runtime) && /button\.disabled = true/.test(source.runtime)],
  ['runtime visibly separates automatic and manual tests', /Ein Häkchen ersetzt keinen realen Testanruf/.test(source.runtime)],
  ['runtime cache version is refreshed', /admin-runtime-launch-p0\.js\?v=20260801-3/.test(source.loader)]
];

for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

if (failed) {
  console.error(`Launch readiness verification failed: ${failed}`);
  process.exit(1);
}
console.log(`Launch readiness verification passed: ${checks.length} checks.`);
