import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const paths = {
  runtime: 'customer-dashboard/shared/customer-runtime-design-foundation.js',
  loader: 'customer-dashboard/shared/offer-brand.js'
};

const runtime = fs.readFileSync(paths.runtime, 'utf8');
const loader = fs.readFileSync(paths.loader, 'utf8');

new vm.Script(runtime, { filename: paths.runtime });
new vm.Script(loader, { filename: paths.loader });

for (const token of [
  "'tab-dashboard'",
  "'tab-anrufe'",
  "'tab-assistent'",
  "'tab-auswertung'",
  "'tab-mehr'",
  "'mnav-dashboard'",
  "'mnav-anrufe'",
  "'mnav-assistent'",
  "'mnav-auswertung'",
  "'mnav-mehr'",
  '--vx-font-ui',
  '--vx-radius-card',
  '--vx-mobile-nav-height',
  '--vx-mobile-header-height',
  '--vx-visual-viewport-height',
  'env(safe-area-inset-bottom,0px)',
  '100svh',
  '100dvh',
  'font-size:16px!important',
  'textarea{font-family:var(--vx-font-ui)!important',
  'vx-assistant-root-switch',
  'vx-ds-dark-surface',
  'ResizeObserver',
  'MutationObserver',
  'visualViewport',
  'orientationchange',
  'prefers-reduced-motion',
  '/\\/activate(?:\\.html)?$/'
]) {
  assert.ok(runtime.includes(token), `design foundation missing: ${token}`);
}

assert.match(runtime, /padding-bottom:calc\(var\(--vx-mobile-nav-height\) \+ env\(safe-area-inset-bottom,0px\) \+ 34px\)!important/);
assert.match(runtime, /scroll-padding-bottom:calc\(var\(--vx-mobile-nav-height\) \+ env\(safe-area-inset-bottom,0px\) \+ 28px\)/);
assert.match(runtime, /document\.documentElement\.style\.setProperty\('--vx-visual-viewport-height'/);
assert.match(runtime, /resizeObserver\.observe\(node\)/);
assert.match(runtime, /mutationObserver\.observe\(document\.body, \{ childList: true, subtree: true \}\)/);
assert.match(loader, /customer-runtime-design-foundation\.js\?v=20260802-1/);
assert.match(loader, /__voxeraCustomerDesignFoundationLoaded/);

for (const forbidden of [
  'SUPABASE_SERVICE_ROLE_KEY',
  'ELEVENLABS_API_KEY',
  'localStorage',
  'sessionStorage',
  '/.netlify/functions/',
  'fetch(',
  'innerHTML = document.documentElement'
]) {
  assert.ok(!runtime.includes(forbidden), `design foundation contains forbidden token: ${forbidden}`);
}

console.log('Customer dashboard design foundation verification passed.');
