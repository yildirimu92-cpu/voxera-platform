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
assert.ok(lineCount(assistantCss) <= 968, 'assistant component CSS exceeded its consolidated size budget');
assert.ok(lineCount(statusCss) <= 300, 'assistant status CSS exceeded its consolidated size budget');
assert.ok(lineCount(settingsCss) <= 740, 'settings component CSS exceeded its consolidated size budget');
assert.ok(lineCount(supportCss) <= 220, 'support component CSS exceeded its size budget');
assert.ok(lineCount(navigationCss) <= 121, 'navigation component CSS exceeded its reduced size budget');

for (const token of [
  'Styling lives exclusively in explicit CSS modules.',
  '/shared/customer-design-system.css?v=20260805-1',
  '/shared/customer-assistant-components.css?v=20260805-1',
  '/shared/customer-assistant-status.css?v=20260803-1',
  '/shared/customer-settings-components.css?v=20260803-2',
  '/shared/customer-support-components.css?v=20260802-2',
  '/shared/customer-navigation-components.css?v=20260805-1',
  '/shared/customer-ui-components.css?v=20260807-1',
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

assert.match(
  foundationCss,
  /@media\s*\(max-width:\s*720px\)\s*\{[\s\S]*?body\.vx-customer-design-foundation\s+\.vx-page-header-title\s*\{\s*font-size:\s*24px;\s*\}/,
  'foundation mobile page-header title must use 24px'
);

assert.match(
  dashboard,
  /@media\s*\(max-width:\s*720px\)\s*\{\s*body\.vx-customer-design-foundation\s+#dash-greeting-block\s*>\s*\.vx-ap-head\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*minmax\(0,\s*1fr\);\s*gap:\s*9px;\s*\}\s*body\.vx-customer-design-foundation\s+#dash-greeting-block\s*>\s*\.vx-ap-head\s*>\s*\.vx-page-header-subtitle\s*\{\s*margin-top:\s*0;\s*font-size:\s*12px;\s*text-align:\s*left;\s*white-space:\s*nowrap;\s*\}\s*\}/,
  'dashboard mobile greeting block must be complete'
);

assert.doesNotMatch(
  dashboard,
  /(?:^|\n)\s*font-size:\s*24px;\s*\}\s*body\.vx-customer-design-foundation\s+#dash-greeting-block/,
  'dashboard must not contain an orphaned top-level mobile title fragment before the greeting block'
);

for (const token of [
  '.vx-ap-stack',
  '.vx-ap-status.loading',
  '.vx-ap-current',
  '.vx-ap-actions--end',
  '.vx-ap-voices',
  '.vx-ap-modal',
  '.vx-ap-filter',
  '.vx-ap-actions > .vx-ap-btn',
  '#vx-business-profile-body .vx-ap-card',
  '#vx-business-profile-body .vx-ap-title',
  '#vx-business-profile-body textarea',
  '#tab-assistent > :not(#vx-assistant-root-header):not(#vx-assistant-root-switch):not(#vx-assistant-root-host)',
  '.vx-assistant-root-header',
  '#vx-assistant-root-host > [data-vx-assistant-managed-page]:not([hidden])',
  '.vx-nav-voice-details',
  '#vx-assistant-profile-body .vx-ap-card:first-child',
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
  '#nav-assistent.nav-item',
  '#mnav-assistent.mobile-nav-btn',
  '#vx-assistant-root-switch',
  '.nav-item.vx-root-nav-active',
  '.mobile-nav-btn:is(.active, .vx-root-nav-active)'
]) {
  assert.ok(navigationCss.includes(token), `navigation CSS missing: ${token}`);
}
assert.match(
  navigationCss,
  /@media\s*\(max-width:\s*720px\)[\s\S]*?body\.vx-customer-design-foundation\s+#vx-assistant-root-switch\s*>\s*button\s*\{[^}]*min-height:\s*36px;?[^}]*\}/,
  'navigation CSS missing mobile assistant switch min-height'
);

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
  'main.hidden = true',
  'page.hidden = false'
]) {
  assert.ok(calendarRuntime.includes(token), `calendar runtime missing semantic structure: ${token}`);
}
assert.ok(
  calendarRuntime.includes('entry.hidden = false;'),
  'calendar runtime must keep settings entry visible'
);
assert.ok(
  calendarRuntime.includes('if (entry) entry.hidden = false;'),
  'calendar runtime must preserve settings entry visibility after render'
);
assert.ok(
  !calendarRuntime.includes(
    'entry.hidden = !(state.enabled && providers.length)'
  ),
  'calendar runtime still contains obsolete provider-dependent entry visibility'
);

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
assert.match(loader, /customer-runtime-design-foundation\.js\?v=20260805-1/);
assert.match(loader, /__voxeraCustomerCaseIntakeLoaded/);
assert.match(loader, /__voxeraCustomerDesignFoundationLoaded/);


// --- Unified UI components (Design-System Etappe 1) ---------------------------
const uiComponentsCss = fs.readFileSync('customer-dashboard/shared/customer-ui-components.css', 'utf8');
const uiComponentsJs = fs.readFileSync('customer-dashboard/shared/customer-ui-components.js', 'utf8');
const designTokens = fs.readFileSync('customer-dashboard/shared/customer-design-tokens.css', 'utf8');
new vm.Script(uiComponentsJs, { filename: 'customer-dashboard/shared/customer-ui-components.js' });

for (const token of [
  '--vx-ui-card-border-width: 0.5px',
  '--vx-ui-card-radius: 12px',
  '--vx-ui-card-padding',
  '--vx-ui-tab-accent',
  '--vx-ui-badge-danger-bg',
  '--vx-ui-badge-info-bg',
  '--vx-ui-badge-neutral-bg',
  '--vx-ui-skeleton-base',
  '--vx-ui-empty-icon-color'
]) {
  assert.ok(designTokens.includes(token), `component contract token missing: ${token}`);
}

for (const token of [
  '.vx-ui-card',
  '.vx-ui-tabs',
  '.vx-ui-tab',
  '.vx-ui-skeleton',
  '.vx-ui-badge',
  '.vx-ui-empty',
  'var(--vx-ui-card-border-width)',
  'var(--vx-ui-card-radius)',
  'var(--vx-ui-tab-accent)',
  '#vx-assistant-root-switch > button',
  '.vx-requests-filters > .vx-ap-filter',
  '@keyframes vxUiSkeletonShimmer',
  'prefers-reduced-motion'
]) {
  assert.ok(uiComponentsCss.includes(token), `UI component CSS missing: ${token}`);
}

// The component layer must resolve every value from the token contract.
assert.equal((uiComponentsCss.match(/!important/g) || []).length, 0, 'UI component CSS must not add !important overrides');
assert.ok(!uiComponentsCss.includes('<style'), 'UI component CSS must not contain an embedded style tag');
assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(uiComponentsCss.replace(/#vx-assistant-root-switch/g, '')), 'UI component CSS must not hardcode colors; use the tokens');

for (const token of ['skeleton:', 'badge:', 'badgeTone:', 'emptyState:', 'card:', 'tabs:', 'root.VoxeraUI =']) {
  assert.ok(uiComponentsJs.includes(token), `VoxeraUI factory missing: ${token}`);
}
for (const forbidden of ["createElement('style')", 'style.textContent', 'document.head.appendChild', 'setTimeout', 'MutationObserver', 'fetch(']) {
  assert.ok(!uiComponentsJs.includes(forbidden), `VoxeraUI factory must stay a pure markup builder: ${forbidden}`);
}

// The five components replaced their divergent predecessors — the old
// declarations must stay deleted, not be re-added next to the canonical ones.
assert.ok(!navigationCss.includes('grid-template-columns: repeat(3, minmax(0, 1fr))'), 'assistant switch must not return to a segmented control');
assert.ok(!foundationCss.includes('.vx-assistant-root-switch button.active'), 'assistant tab active state must stay owned by the tab component');
assert.ok(!assistantCss.includes('.vx-ops-pill {'), 'status pills must stay owned by the badge component');
assert.ok(!assistantCss.includes('.vx-ops-empty {'), 'empty states must stay owned by the empty-state component');
assert.ok(dashboard.includes('/shared/customer-ui-components.js?v=20260807-1'), 'dashboard must load the VoxeraUI markup factory');
assert.ok(!/wird geladen|werden geladen/i.test(calendarRuntime), 'calendar runtime must use the skeleton component, not loading text');
assert.ok(!/wird geladen …/i.test(assistantRuntime), 'assistant runtime must use the skeleton component, not loading text');

console.log('Customer dashboard design foundation verification passed.');

assert.doesNotMatch(navigationRuntime, /function addStyles|createElement\('style'\)|style\.textContent/);

for (const forbidden of ['#tab-assistent > :not(#vx-assistant-root-header):not(#vx-assistant-root-switch):not(#vx-assistant-root-host)','#vx-assistant-root-host > [data-vx-assistant-managed-page]:not([hidden])','.vx-nav-voice-details','#vx-assistant-profile-body .vx-ap-card:first-child']) assert.ok(!navigationCss.includes(forbidden), `navigation CSS still owns assistant structure: ${forbidden}`);
assert.ok(dashboard.includes('<script src="/shared/offer-brand.js?v=20260805-1"></script>'), 'dashboard missing versioned offer-brand loader');
assert.ok(!dashboard.includes('<script src="/shared/offer-brand.js"></script>'), 'dashboard still loads unversioned offer-brand');
assert.ok(loader.includes('/shared/customer-runtime-design-foundation.js?v=20260805-1'), 'offer-brand missing current design loader version');
assert.ok(!loader.includes('/shared/customer-runtime-design-foundation.js?v=20260803-4'), 'offer-brand still references stale design loader version');
for (const stale of ['/shared/customer-design-system.css?v=20260804-1','/shared/customer-assistant-components.css?v=20260803-1','/shared/customer-navigation-components.css?v=20260803-1']) assert.ok(!runtime.includes(stale), `design loader still contains stale CSS URL: ${stale}`);
const cssOrder=['/shared/customer-design-system.css?v=20260805-1','/shared/customer-assistant-components.css?v=20260805-1','/shared/customer-assistant-status.css?v=20260803-1','/shared/customer-navigation-components.css?v=20260805-1','/shared/customer-settings-components.css?v=20260803-2','/shared/customer-support-components.css?v=20260802-2','/shared/customer-ui-components.css?v=20260807-1'];
for(let i=1;i<cssOrder.length;i+=1) assert.ok(runtime.indexOf(cssOrder[i-1])<runtime.indexOf(cssOrder[i]),`design CSS module order changed: ${cssOrder[i-1]} before ${cssOrder[i]}`);
