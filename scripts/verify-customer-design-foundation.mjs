import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const paths = {
  runtime: 'customer-dashboard/shared/customer-runtime-design-foundation.js',
  foundationCss: 'customer-dashboard/shared/customer-design-system.css',
  assistantCss: 'customer-dashboard/shared/customer-assistant-components.css',
  statusCss: 'customer-dashboard/shared/customer-assistant-status.css',
  supportCss: 'customer-dashboard/shared/customer-support-components.css',
  assistantRuntime: 'customer-dashboard/shared/customer-runtime-assistant-profile.js',
  statusRuntime: 'customer-dashboard/shared/customer-runtime-assistant-status.js',
  supportRuntime: 'customer-dashboard/shared/customer-runtime-case-intake.js',
  loader: 'customer-dashboard/shared/offer-brand.js'
};

const runtime = fs.readFileSync(paths.runtime, 'utf8');
const foundationCss = fs.readFileSync(paths.foundationCss, 'utf8');
const assistantCss = fs.readFileSync(paths.assistantCss, 'utf8');
const statusCss = fs.readFileSync(paths.statusCss, 'utf8');
const supportCss = fs.readFileSync(paths.supportCss, 'utf8');
const assistantRuntime = fs.readFileSync(paths.assistantRuntime, 'utf8');
const statusRuntime = fs.readFileSync(paths.statusRuntime, 'utf8');
const supportRuntime = fs.readFileSync(paths.supportRuntime, 'utf8');
const loader = fs.readFileSync(paths.loader, 'utf8');

new vm.Script(runtime, { filename: paths.runtime });
new vm.Script(assistantRuntime, { filename: paths.assistantRuntime });
new vm.Script(statusRuntime, { filename: paths.statusRuntime });
new vm.Script(supportRuntime, { filename: paths.supportRuntime });
new vm.Script(loader, { filename: paths.loader });

const lineCount = (value) => value.split(/\r?\n/).length;
assert.ok(lineCount(runtime) <= 50, `design runtime is too large: ${lineCount(runtime)} lines`);
assert.ok(lineCount(foundationCss) <= 500, 'foundation CSS exceeded the initial size budget');
assert.ok(lineCount(assistantCss) <= 350, 'assistant component CSS exceeded its size budget');
assert.ok(lineCount(statusCss) <= 220, 'assistant status CSS exceeded its size budget');
assert.ok(lineCount(supportCss) <= 220, 'support component CSS exceeded its size budget');

for (const token of [
  'Styling lives exclusively in explicit CSS modules.',
  '/shared/customer-design-system.css?v=20260802-2',
  '/shared/customer-assistant-components.css?v=20260802-1',
  '/shared/customer-assistant-status.css?v=20260802-1',
  '/shared/customer-support-components.css?v=20260802-1',
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
  'font-size: 16px',
  'prefers-reduced-motion'
]) {
  assert.ok(foundationCss.includes(token), `foundation CSS missing: ${token}`);
}

for (const token of [
  '.vx-ap-stack',
  '.vx-ap-status.loading',
  '.vx-ap-current',
  '.vx-ap-actions--end',
  '.vx-ap-voices',
  '.vx-ap-modal',
  '.vx-settings-entry',
  '.vx-page-header--with-back'
]) {
  assert.ok(assistantCss.includes(token), `assistant CSS missing: ${token}`);
}

for (const token of [
  '.vx-as-cap-grid',
  '.vx-as-icon.attention',
  '.vx-as-state::before',
  '.vx-as-tech-row',
  '@media (max-width: 720px)'
]) {
  assert.ok(statusCss.includes(token), `assistant status CSS missing: ${token}`);
}

for (const token of [
  '#vox-support-request-overlay',
  '.vox-support-modal',
  'html.vx-support-modal-open',
  '.vx-feedback-error',
  '.vx-feedback-success',
  '@media (max-width: 520px)'
]) {
  assert.ok(supportCss.includes(token), `support CSS missing: ${token}`);
}

for (const token of [
  "entry.className = 'vx-settings-entry'",
  'vx-settings-entry-icon',
  'vx-page-header--with-back',
  'vx-ap-actions--push',
  'toneLabel',
  'addressLabel',
  'Aktuelle Infos'
]) {
  assert.ok(assistantRuntime.includes(token), `assistant runtime migration missing: ${token}`);
}

for (const token of [
  'Fähigkeiten',
  'Der aktuelle Zustand der wichtigsten Verbindungen.',
  "technicalRow('Telefonie'",
  "technicalRow('Stimme & Einstellungen'",
  'statusObserver.observe(body, { childList: true, subtree: true })'
]) {
  assert.ok(statusRuntime.includes(token), `assistant status cleanup missing: ${token}`);
}

for (const token of [
  'function setFeedback',
  "document.documentElement.classList.add('vx-support-modal-open')",
  "document.documentElement.classList.remove('vx-support-modal-open')",
  "overlay.addEventListener('keydown'",
  'overlay.vxOpenSupportModal = open'
]) {
  assert.ok(supportRuntime.includes(token), `support runtime cleanup missing: ${token}`);
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
  'innerHTML = document.documentElement',
  'fetch(',
  'localStorage',
  'sessionStorage',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ELEVENLABS_API_KEY'
]) {
  assert.ok(!runtime.includes(forbidden), `design runtime contains forbidden token: ${forbidden}`);
}

for (const forbidden of [
  'function addStyles',
  "createElement('style')",
  'style.textContent',
  'vx-assistant-profile-style',
  'entry.style.cssText',
  ' style="'
]) {
  assert.ok(!assistantRuntime.includes(forbidden), `assistant runtime still owns presentation: ${forbidden}`);
}

for (const forbidden of [
  'function addStyles',
  "createElement('style')",
  'style.textContent',
  'vx-assistant-status-style',
  'observer.observe(document.documentElement',
  'vx-assistant-operational-summary',
  'openOperational',
  'openCalendar',
  'Letzte erfolgreiche Synchronisierung',
  ' style="'
]) {
  assert.ok(!statusRuntime.includes(forbidden), `assistant status runtime still contains legacy code: ${forbidden}`);
}

for (const forbidden of [
  "createElement('style')",
  'style.textContent',
  'document.head.appendChild(style)',
  '.style.color',
  '.style.display',
  'document.documentElement.style.overflow',
  ' style="'
]) {
  assert.ok(!supportRuntime.includes(forbidden), `support runtime still owns presentation: ${forbidden}`);
}

for (const [name, css] of [
  ['foundation', foundationCss],
  ['assistant', assistantCss],
  ['status', statusCss],
  ['support', supportCss]
]) {
  assert.ok(!css.includes('<style'), `${name} CSS must not contain an embedded style tag`);
  assert.ok(!css.includes('javascript:'), `${name} CSS must not contain JavaScript URLs`);
  assert.equal((css.match(/!important/g) || []).length, 0, `${name} CSS must not add !important overrides`);
}

assert.match(loader, /customer-runtime-design-foundation\.js\?v=20260802-1/);
assert.match(loader, /__voxeraCustomerDesignFoundationLoaded/);

console.log('Customer dashboard design foundation verification passed.');
