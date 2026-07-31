import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(path, 'utf8');
const paths = {
  syncCoordinator: 'admin-panel/netlify/functions/trigger-elevenlabs-sync-v2.js',
  syncStatus: 'admin-panel/netlify/functions/elevenlabs-sync-status.js',
  scrapeCoordinator: 'admin-panel/netlify/functions/scrape-website-v2.js',
  syncRuntime: 'admin-panel/shared/admin-runtime-sync.js',
  launchRuntime: 'admin-panel/shared/admin-runtime-launch-p0.js',
  loader: 'admin-panel/shared/offer-brand.js'
};

const source = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, read(path)]));
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
  ['sync coordinator authenticates admin', /requireAdminCaller/.test(source.syncCoordinator) && /requiredCapability: 'customer:write'/.test(source.syncCoordinator)],
  ['sync coordinator derives stored agent id', /customer\.elevenlabs_agent_id/.test(source.syncCoordinator) && /agent_mismatch/.test(source.syncCoordinator)],
  ['sync coordinator has bounded timeout', /SYNC_TIMEOUT_MS = 24_000/.test(source.syncCoordinator) && /AbortController/.test(source.syncCoordinator)],
  ['sync coordinator records failed timeout state', /setSyncState\(sb, customerId, 'failed'/.test(source.syncCoordinator) && /sync_timeout/.test(source.syncCoordinator)],
  ['sync status is server-side and authenticated', /requiredCapability: 'customer:read'/.test(source.syncStatus) && /elevenlabs_sync_log/.test(source.syncStatus)],
  ['sync runtime no longer queries sync log directly', /elevenlabs-sync-status/.test(source.syncRuntime) && !/authClient\.from\('elevenlabs_sync_log'\)/.test(source.syncRuntime)],
  ['sync runtime exposes manual retry', /Jetzt synchronisieren/.test(source.syncRuntime) && /trigger-elevenlabs-sync/.test(source.syncRuntime)],
  ['website coordinator retries scheme safely', /https:\/\//.test(source.scrapeCoordinator) && /http:\/\//.test(source.scrapeCoordinator) && /FALLBACK_CODES/.test(source.scrapeCoordinator)],
  ['launch runtime routes stable endpoints', /trigger-elevenlabs-sync-v2/.test(source.launchRuntime) && /scrape-website-v2/.test(source.launchRuntime)],
  ['website feedback survives wizard rerender', /renderWizardModal/.test(source.launchRuntime) && /setWebsiteFeedback\(message, true\)/.test(source.launchRuntime)],
  ['launch runtime is loaded last', /admin-runtime-launch-p0\.js/.test(source.loader) && source.loader.indexOf('admin-runtime-launch-p0.js') > source.loader.indexOf('admin-runtime-sync.js')]
];

for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}

if (failed) {
  console.error(`Launch sync/website verification failed: ${failed}`);
  process.exit(1);
}
console.log(`Launch sync/website verification passed: ${checks.length} checks.`);
