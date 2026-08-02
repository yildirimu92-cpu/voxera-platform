import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const paths = {
  runtime: 'customer-dashboard/shared/customer-runtime-design-foundation.js',
  css: 'customer-dashboard/shared/customer-design-system.css',
  loader: 'customer-dashboard/shared/offer-brand.js'
};

const runtime = fs.readFileSync(paths.runtime, 'utf8');
const css = fs.readFileSync(paths.css, 'utf8');
const loader = fs.readFileSync(paths.loader, 'utf8');

new vm.Script(runtime, { filename: paths.runtime });
new vm.Script(loader, { filename: paths.loader });

const runtimeLines = runtime.split(/\r?\n/).length;
assert.ok(runtimeLines <= 40, `design runtime is too large: ${runtimeLines} lines`);
assert.ok(css.split(/\r?\n/).length <= 500, 'design system CSS exceeded the initial size budget');

for (const token of [
  '/shared/customer-design-system.css?v=20260802-2',
  "link.rel = 'stylesheet'",
  'vx-customer-design-foundation-html',
  'vx-customer-design-foundation',
  '/\\/activate(?:\\.html)?$/'
]) {
  assert.ok(runtime.includes(token), `design loader missing: ${token}`);
}

for (const token of [
  '--vx-font-ui',
  '--vx-radius-card',
  '--vx-mobile-nav-space',
  'env(safe-area-inset-bottom, 0px)',
  '100svh',
  '100dvh',
  '#tab-dashboard',
  '#tab-anrufe',
  '#tab-assistent',
  '#tab-auswertung',
  '#tab-mehr',
  '#mnav-dashboard',
  '#mnav-anrufe',
  '#mnav-assistent',
  '#mnav-auswertung',
  '#mnav-mehr',
  '.vx-assistant-root-switch',
  '.vx-page-header',
  '.vx-ap-card',
  '.vx-ops-card',
  'font-size: 16px',
  'prefers-reduced-motion'
]) {
  assert.ok(css.includes(token), `design CSS missing: ${token}`);
}

for (const forbidden of [
  'MutationObserver',
  'ResizeObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'visualViewport',
  'setInterval',
  'setTimeout',
  'style.textContent',
  'innerHTML',
  'fetch(',
  'localStorage',
  'sessionStorage',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ELEVENLABS_API_KEY'
]) {
  assert.ok(!runtime.includes(forbidden), `design runtime contains forbidden token: ${forbidden}`);
}

assert.ok(!css.includes('<style'), 'CSS file must not contain an embedded style tag');
assert.ok(!css.includes('javascript:'), 'CSS file must not contain JavaScript URLs');
assert.equal((css.match(/!important/g) || []).length, 0, 'canonical design CSS must not add !important overrides');
assert.match(loader, /customer-runtime-design-foundation\.js\?v=20260802-1/);
assert.match(loader, /__voxeraCustomerDesignFoundationLoaded/);

console.log('Customer dashboard design foundation verification passed.');
