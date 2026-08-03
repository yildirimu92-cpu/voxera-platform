import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const paths = {
  runtime: 'customer-dashboard/shared/customer-runtime-design-foundation.js',
  foundationCss: 'customer-dashboard/shared/customer-design-system.css',
  assistantCss: 'customer-dashboard/shared/customer-assistant-components.css',
  statusCss: 'customer-dashboard/shared/customer-assistant-status.css',
  settingsCss: 'customer-dashboard/shared/customer-settings-components.css',
  supportCss: 'customer-dashboard/shared/customer-support-components.css',
  navigationCss: 'customer-dashboard/shared/customer-navigation-components.css',
  navigationRuntime: 'customer-dashboard/shared/customer-runtime-unified-navigation.js',
  assistantRuntime: 'customer-dashboard/shared/customer-runtime-assistant-profile.js',
  statusRuntime: 'customer-dashboard/shared/customer-runtime-assistant-status.js',
  calendarRuntime: 'customer-dashboard/shared/customer-runtime-calendar-settings.js',
  supportRuntime: 'customer-dashboard/shared/customer-runtime-case-intake.js',
  loader: 'customer-dashboard/shared/offer-brand.js',
  dashboard: 'customer-dashboard/index.html'
};

const runtime = fs.readFileSync(paths.runtime, 'utf8');
const foundationCss = fs.readFileSync(paths.foundationCss, 'utf8');
const assistantCss = fs.readFileSync(paths.assistantCss, 'utf8');
const statusCss = fs.readFileSync(paths.statusCss, 'utf8');
const settingsCss = fs.readFileSync(paths.settingsCss, 'utf8');
const supportCss = fs.readFileSync(paths.supportCss, 'utf8');
const navigationCss = fs.readFileSync(paths.navigationCss, 'utf8');
const navigationRuntime = fs.readFileSync(paths.navigationRuntime, 'utf8');
const assistantRuntime = fs.readFileSync(paths.assistantRuntime, 'utf8');
const statusRuntime = fs.readFileSync(paths.statusRuntime, 'utf8');
const calendarRuntime = fs.readFileSync(paths.calendarRuntime, 'utf8');
const supportRuntime = fs.readFileSync(paths.supportRuntime, 'utf8');
const loader = fs.readFileSync(paths.loader, 'utf8');
const dashboard = fs.readFileSync(paths.dashboard, 'utf8');

new vm.Script(runtime, { filename: paths.runtime });
new vm.Script(assistantRuntime, { filename: paths.assistantRuntime });
new vm.Script(statusRuntime, { filename: paths.statusRuntime });
new vm.Script(calendarRuntime, { filename: paths.calendarRuntime });
new vm.Script(supportRuntime, { filename: paths.supportRuntime });
new vm.Script(navigationRuntime, { filename: paths.navigationRuntime });
new vm.Script(loader, { filename: paths.loader });

const lineCount = (value) => value.split(/\r?\n/).length;
assert.ok(lineCount(runtime) <= 55, `design runtime is too large: ${lineCount(runtime)} lines`);
assert.ok(lineCount(foundationCss) <= 500, 'foundation CSS exceeded the initial size budget');
assert.ok(lineCount(assistantCss) <= 800, 'assistant component CSS exceeded its consolidated size budget');
assert.ok(lineCount(statusCss) <= 300, 'assistant status CSS exceeded its consolidated size budget');
assert.ok(lineCount(settingsCss) <= 740, 'settings component CSS exceeded its consolidated size budget');
assert.ok(lineCount(supportCss) <= 220, 'support component CSS exceeded its size budget');
assert.ok(lineCount(navigationCss) <= 110, 'navigation component CSS exceeded its reduced size budget');

for (const token of [
  'Styling lives exclusively in explicit CSS modules.',
  '/shared/customer-design-system.css?v=20260803-1',
  '/shared/customer-assistant-components.css?v=20260803-1',
  '/shared/customer-assistant-status.css?v=20260803-1',
  '/shared/customer-settings-components.css?v=20260803-2',
  '/shared/customer-support-components.css?v=20260802-2',
  '/shared/customer-navigation-components.css?v=20260803-1',
  "link.rel = 'stylesheet'",
  'vx-customer-design-foundation-html',
  'vx-customer-design-foundation',
  '/\\/activate(?:\\.html)?$/'
]) {
  assert.ok(runtime.includes(token), `design loader missing: ${token}`);
}

for (const token of [
  '--vx-font-ui: "Inter", -apple-system',
  '--vx-font-size-button',
  '--vx-control-min-height',
  '--vx-control-padding-inline',
  '--vx-control-gap',
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
  '.vx-ap-btn',
  '.vx-ops-btn',
  '.vx-as-capability-toggle',
  'display: inline-flex',
  'padding: var(--vx-control-padding-block) var(--vx-control-padding-inline)',
  'white-space: normal',
  'overflow-wrap: anywhere',
  'font-size: var(--vx-font-size-body-mobile)',
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
  '.vx-ap-filter',
  'min-height: 36px',
  '.vx-ap-actions > .vx-ap-btn',
  '#vx-business-profile-body .vx-ap-card',
  '#vx-business-profile-body .vx-ap-title',
  '#vx-business-profile-body .vx-ap-grid',
  '#vx-business-profile-body textarea',
  'min-height: 138px',
  'min-height: 124px',
  '#vx-operational-page-body',
  '.vx-ops-layout',
  '.vx-ops-card',
  '.vx-ops-title',
  '.vx-ops-field textarea',
  '.vx-ops-details-body',
  '.vx-ops-status.loading',
  '.vx-ops-actions > .vx-ops-btn',
  '@media (max-width: 820px)'
]) {
  assert.ok(assistantCss.includes(token), `assistant CSS missing: ${token}`);
}

for (const forbidden of [
  '.vx-settings-entry',
  '.vx-page-header--with-back',
  '.vx-page-header-copy'
]) {
  assert.ok(!assistantCss.includes(forbidden), `assistant CSS still contains obsolete selector: ${forbidden}`);
}

for (const token of [
  '.vx-as-cap-grid',
  '.vx-as-icon.attention',
  '.vx-as-state::before',
  '.vx-as-capabilities-simple:not(.is-expanded) .vx-as-extra-capability',
  '.vx-as-capability-toggle',
  '.vx-nav-status-summary',
  '.vx-nav-status-details',
  '.vx-as-tech-row',
  '@media (max-width: 720px)',
  '@media (max-width: 390px)'
]) {
  assert.ok(statusCss.includes(token), `assistant status CSS missing: ${token}`);
}

for (const forbidden of [
  '.vx-nav-status-summary',
  '.vx-nav-status-details',
  '.vx-as-capabilities-simple',
  '.vx-as-capability-toggle'
]) {
  assert.ok(!navigationCss.includes(forbidden), `navigation CSS still owns assistant status styling: ${forbidden}`);
}

for (const token of [
  '.vx-settings-list',
  '.vx-settings-entry',
  '.vx-settings-entry-icon',
  '.vx-settings-entry-title',
  '.vx-settings-entry-subtitle',
  '.vx-cal-page-header',
  '.vx-cal-back',
  '#vx-calendar-page-body',
  '.vx-cal-grid',
  '.vx-cal-card',
  '.vx-cal-provider',
  '.vx-cal-pill.ok',
  '.vx-cal-banner.ok',
  '.vx-cal-status.loading',
  '.vx-cal-form',
  '.vx-cal-checkbox',
  '.vx-cal-actions > .vx-cal-btn',
  '.vx-abo-hero',
  '.vx-settings-card',
  '.vx-abo-progress',
  '.vx-abo-contract-grid',
  '.vx-abo-addon-grid',
  '.vx-abo-btn.danger',
  '@media (max-width: 720px)',
  '@media (max-width: 390px)'
]) {
  assert.ok(settingsCss.includes(token), `settings CSS missing canonical component: ${token}`);
}

for (const token of [
  '#vox-support-request-overlay',
  '.vox-support-modal',
  'html.vx-support-modal-open',
  '.vox-support-close',
  'width: 40px',
  'height: 40px',
  '.vx-feedback-error',
  '.vx-feedback-success',
  '@media (max-width: 520px)'
]) {
  assert.ok(supportCss.includes(token), `support CSS missing: ${token}`);
}

for (const token of [
  '#tab-assistent > :not(#vx-assistant-root-switch):not(#vx-assistant-root-host)',
  '#vx-assistant-root-host > [data-vx-assistant-managed-page]:not([hidden])',
  '.vx-nav-voice-details'
]) {
  assert.ok(navigationCss.includes(token), `navigation CSS missing: ${token}`);
}

for (const token of [
  "document.getElementById('tab-assistent')",
  'root.vxAssistantProfileOpen = open',
  'vx-ap-actions--push',
  'toneLabel',
  'addressLabel',
  'Aktuelle Infos'
]) {
  assert.ok(assistantRuntime.includes(token), `assistant runtime migration missing: ${token}`);
}

for (const token of [
  'Fähigkeiten',
  'Betriebsstatus',
  'Nur Abweichungen werden hervorgehoben. Technische Details bleiben optional.',
  'function technicalSummary',
  'function capabilityToggleHtml',
  'data-vx-capability-toggle',
  'type="button"',
  'vx-as-capabilities-simple',
  'vx-as-extra-capability',
  'vx-nav-status-summary',
  'vx-nav-status-details',
  "technicalRow('Telefonie'",
  "technicalRow('Stimme & Einstellungen'",
  'statusObserver.observe(body, { childList: true, subtree: true })'
]) {
  assert.ok(statusRuntime.includes(token), `assistant status runtime missing final structure: ${token}`);
}

for (const token of [
  'vx-calendar-settings-entry',
  'vx-settings-entry vx-settings-entry--calendar',
  'vx-cal-page-header',
  'vx-cal-rules-card',
  'vx-cal-checkbox',
  "page.removeAttribute('style')",
  'entry.hidden = !(state.enabled && providers.length)',
  'main.hidden = true',
  'page.hidden = false'
]) {
  assert.ok(calendarRuntime.includes(token), `calendar runtime missing semantic structure: ${token}`);
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
  'vx-calendar-settings-style',
  'entry.style.cssText',
  '.style.display',
  ' style="'
]) {
  assert.ok(!calendarRuntime.includes(forbidden), `calendar runtime still owns presentation: ${forbidden}`);
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

for (const forbidden of [
  '"DM Sans"',
  '"Plus Jakarta Sans"',
  '.vx-ap-card button',
  '.vx-ops-card button',
  'min-height: 148px',
  '.vx-ops-card',
  '.vx-ops-title',
  '.vx-ops-sub',
  '.vx-ops-message',
  '.vx-ops-meta',
  '.vx-ops-layout',
  '.vx-ops-grid',
  '.vx-ops-rule',
  '.vx-ops-item',
  '.vx-ops-section',
  '.vx-ops-preview',
  '.vx-ops-help',
  '.vx-ops-field label',
  '.vx-cal-card',
  '.vx-cal-provider',
  '.vx-cal-form'
]) {
  assert.ok(!foundationCss.includes(forbidden), `foundation CSS still contains mixed, broad or component-owned rule: ${forbidden}`);
}

for (const token of [
  'class="vx-settings-list"',
  'class="vx-settings-entry"',
  'class="vx-abo-hero"',
  '<progress id="abo-minutes-bar"',
  'class="vx-abo-contract-grid"',
  'class="vx-abo-addon-grid"',
  "barEl.classList.toggle('warning'",
  "onclick=\"vxMehrShow('abonnement')\"",
  'onclick="vxAboUpgrade()"',
  'onclick="vxAboMinuten()"',
  'onclick="vxSubmitCancellationRequest()"'
]) {
  assert.ok(dashboard.includes(token), `dashboard missing canonical settings markup: ${token}`);
}

for (const forbidden of [
  '#mehr-main [onclick]',
  '.addon-grid{',
  '#abo-addons-list > div[style*="grid-template-columns:1fr 1fr"]',
  '<div id="mehr-main" style=',
  '<div id="abo-plan-name" style=',
  "if (barEl) { barEl.style.width = pct + '%'; barEl.style.background = pct >= 80 ? '#D97706' : '#1A6FE8'; }",
  'statusStyle ='
]) {
  assert.ok(!dashboard.includes(forbidden), `dashboard still contains legacy settings presentation: ${forbidden}`);
}

for (const [name, css] of [
  ['foundation', foundationCss],
  ['assistant', assistantCss],
  ['status', statusCss],
  ['settings', settingsCss],
  ['support', supportCss],
  ['navigation', navigationCss]
]) {
  assert.ok(!css.includes('<style'), `${name} CSS must not contain an embedded style tag`);
  assert.ok(!css.includes('javascript:'), `${name} CSS must not contain JavaScript URLs`);
  assert.equal((css.match(/!important/g) || []).length, 0, `${name} CSS must not add !important overrides`);
}

assert.match(loader, /customer-runtime-case-intake\.js\?v=20260802-2/);
assert.match(loader, /customer-runtime-calendar-settings\.js\?v=20260803-2/);
assert.match(loader, /customer-runtime-assistant-status\.js\?v=20260803-1/);
assert.match(loader, /customer-runtime-design-foundation\.js\?v=20260803-4/);
assert.match(loader, /__voxeraCustomerCaseIntakeLoaded/);
assert.match(loader, /__voxeraCustomerDesignFoundationLoaded/);

console.log('Customer dashboard design foundation verification passed.');

assert.doesNotMatch(navigationRuntime, /function addStyles|createElement\('style'\)|style\.textContent/);
