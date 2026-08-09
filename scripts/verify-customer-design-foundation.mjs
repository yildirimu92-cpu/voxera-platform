import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const paths = {
  runtime: 'customer-dashboard/shared/customer-runtime-design-foundation.js',
  foundationCss: 'customer-dashboard/shared/customer-design-system.css',
  assistantCss: 'customer-dashboard/shared/customer-assistant-components.css',
  operationalCss: 'customer-dashboard/shared/customer-operational-components.css',
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
const operationalCss = fs.readFileSync(paths.operationalCss, 'utf8');
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
// Etappe 6 / S2: +83 Zeilen fuer den Kopfbereich "So meldet sich Ihr
// Assistent". S3: +50 fuer den Ansprache-/Ton-Editor darin. Umgliederung
// (E8, 09.08.): +134 fuer die zweite Achse der neuen Struktur — Herkunftsmarke,
// Regellisten, Unterabschnitte, das "Aktuell"-Band, das den dritten Reiter
// ersetzt, und die zweispaltige Ausnahme fuer die Kernidentitaet auf Mobile
// (fuenf kurze Werte gestapelt kosteten dort rund 100px fuer nichts).
// Nachtrag aus dem Live-Test (09.08.): +32 fuer die Entdichtung — eingeklappte
// Voxera-Regeln, einspaltige Branchenfelder, Erklaerung und Handlung unter der
// Statuszeile (Grundsatz 13).
// Alles neue Komponenten, kein Wildwuchs. Budget behaelt denselben Spielraum
// wie zuvor (~15 Zeilen), damit der Waechter weiterhin anschlaegt, bevor die
// Datei unbemerkt waechst.
// 09.08.: Die Datei stand bei exakt 1300 und blockierte damit jede weitere
// UI-Ergaenzung. Herausgeloest wurde die Betriebsinformations-Oberflaeche
// (.vx-ops-*) -- eigene Feature-Flaeche, eigenes Runtime-Modul, keine
// Kaskadenbeziehung zu .vx-ap-*. Die Budgets sind bewusst knapp ueber dem
// Ist-Stand gesetzt: sie sollen weiter bremsen, nur nicht mehr blockieren.
assert.ok(lineCount(assistantCss) <= 1050, 'assistant component CSS exceeded its consolidated size budget');
assert.ok(lineCount(operationalCss) <= 420, 'operational component CSS exceeded its size budget');
assert.ok(lineCount(statusCss) <= 300, 'assistant status CSS exceeded its consolidated size budget');
// Design-Nachzug 4 (2026-08-08): +46 Zeilen. Der groessere Teil davon ist
// EIN Block — die Zuruecknahme der geerbten Feldbeschriftungs-Typografie auf
// den <label>-Zeilen von Benachrichtigungen, Profil und Kalender. Der
// Kommentar dort haelt fest, warum die Hierarchie vorher invertiert war
// (Titel 15px/900, Untertexte 13px/700, Switch-Titel heller als sein eigener
// Untertitel); ohne diese Herleitung sieht die Regel nach Geschmack aus. Der
// Rest ist die Anbieter-Marke im Kalender. Budget behaelt denselben Spielraum
// wie zuvor, damit der Waechter weiterhin anschlaegt, bevor die Datei
// unbemerkt waechst.
// Premium-Polish (2026-08-09): +39 Zeilen fuer die Hover-Zustaende der
// klickbaren Flaechen im Abo-, Plan- und Hilfe-Bereich. Sie stehen bewusst
// hier statt als Sammelregel im Fundament — die Herleitung dazu steht am
// Block selbst. Budget behaelt denselben Spielraum wie zuvor.
assert.ok(lineCount(settingsCss) <= 845, 'settings component CSS exceeded its consolidated size budget');
assert.ok(lineCount(supportCss) <= 220, 'support component CSS exceeded its size budget');
// Navigation Premium-Redesign (2026-08-09): +122 Zeilen. Der groessere Teil
// ist der Gold-Icon-Chip als gemeinsamer Aktiv-Zustand von Seitenleiste und
// Tab-Leiste samt Herleitung, dazu der Fokusring beider Formen und die
// Gruss-Zeile auf "Heute". Netto ist das Produkt schlanker geworden: der
// Aktiv-Zustand stand vorher an fuenf Orten (drei Inline-Bloecke in
// index.html, dieses Modul und die !important-Farben des Reparaturskripts).
// Budget behaelt denselben Spielraum wie zuvor.
assert.ok(lineCount(navigationCss) <= 390, 'navigation component CSS exceeded its size budget');

for (const token of [
  'Styling lives exclusively in explicit CSS modules.',
  '/shared/customer-design-system.css?v=20260809-3',
  '/shared/customer-assistant-components.css?v=20260809-4',
  '/shared/customer-operational-components.css?v=20260809-1',
  '/shared/customer-assistant-status.css?v=20260803-1',
  '/shared/customer-settings-components.css?v=20260809-3',
  '/shared/customer-support-components.css?v=20260802-2',
  '/shared/customer-navigation-components.css?v=20260809-2',
  '/shared/customer-ui-components.css?v=20260809-2',
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

// Navigation Etappe 2: the Night page header is gone. No module outside the
// navigation component may declare a screen header again.
for (const [name, css] of [
  ['foundation', foundationCss],
  ['assistant', assistantCss],
  ['operational', operationalCss],
  ['settings', settingsCss],
  ['support', supportCss]
]) {
  assert.ok(!css.includes('.vx-page-header'), `${name} CSS still owns the replaced page header`);
  assert.ok(!css.includes('.vx-appbar {'), `${name} CSS must not redeclare the screen header`);
}
assert.ok(!dashboard.includes('vx-page-header'), 'the dashboard must not carry the replaced page header any more');
assert.ok(!dashboard.includes('vx-back-btn'), 'the dashboard must not carry the replaced back button any more');

// The greeting and the date left the header and are the first card of Heute.
assert.match(
  dashboard,
  /<section id="dash-greeting-block" class="vx-ui-card vx-screen-meta">/,
  'the Heute greeting must be an ordinary card in the content area'
);

// The meta cards use the canonical shell unchanged — no screen may give the
// card that receives the header's content its own surface treatment.
for (const forbidden of ['vx-screen-meta {\n  background', '.vx-screen-meta{background']) {
  assert.ok(!navigationCss.includes(forbidden), 'the meta card must not redeclare the card shell');
}


// One bar per screen, and each of the five top-level screens has exactly one
// without a back arrow.
for (const [screen, title] of [
  ['tab-dashboard', 'Heute'],
  ['tab-anrufe', 'Anfragen'],
  ['tab-auswertung', 'Bericht']
]) {
  assert.ok(
    dashboard.includes(`<header class="vx-appbar"><h1 class="vx-appbar-title">${title}</h1></header>`),
    `${screen} must open with a back-arrow-free app bar titled "${title}"`
  );
}
assert.ok(
  dashboard.includes('<header class="vx-appbar"><h1 class="vx-appbar-title">Einstellungen</h1></header>'),
  'Einstellungen must open with a back-arrow-free app bar'
);
// E8 (09.08.): Der Assistent-Tab ist eine durchgehende Seite; seine beiden
// Formulare sind Drill-ins. Die Leiste traegt deshalb jetzt auch den
// Zurueck-Pfeil — aber nur dort, nicht auf der Wurzelseite.
assert.ok(
  navigationRuntime.includes('<h1 class="vx-appbar-title" id="vx-assistant-root-title">Assistent</h1>'),
  'the assistant root must open with the shared app bar'
);
assert.ok(
  navigationRuntime.includes('back.hidden = Boolean(config.root)'),
  'the assistant root view must stay free of a back arrow'
);
assert.ok(
  !navigationRuntime.includes('vx-assistant-root-subtitle'),
  'the assistant header subtitle must stay deleted — the bar carries a title only'
);

// Sub-screens keep an arrow, and no arrow may hard-code its destination:
// every static one routes through vxScreenBack (browser history), and the
// request detail routes through vxHandleDetailBack (its own origin stack).
// 7 statt 8 seit 2026-08-09: der zweite Hilfe-Screen (#tab-hilfe) ist
// entfernt. Er lag als .tab-page innerhalb von #tab-einstellungen und war
// deshalb nie erreichbar — sein Pfeil hat hier mitgezaehlt, ohne dass ihn
// jemand sehen konnte. Die lebende Hilfe-Seite (#mehr-sub-hilfe) bringt
// ihren eigenen Pfeil mit und steckt weiterhin in dieser Zahl.
const staticBackArrows = (dashboard.match(/onclick="vxScreenBack\(/g) || []).length;
assert.ok(
  staticBackArrows >= 7,
  `expected the settings sub-screens, help and notifications to carry a back arrow, found ${staticBackArrows}`
);
assert.equal(
  (dashboard.match(/class="vx-appbar-back"/g) || []).length,
  staticBackArrows + 1,
  'the only back arrow outside vxScreenBack is the request detail, which uses vxHandleDetailBack'
);
assert.match(
  dashboard,
  /function vxDetailAppBarHtml[\s\S]{0,400}?vxHandleDetailBack\(\);/,
  'the request detail app bar must resolve its origin through vxHandleDetailBack'
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
  '#vx-assistant-root-host > [data-vx-assistant-managed-page]:not([hidden])',
  '.vx-nav-voice-details',
  '#vx-assistant-profile-body .vx-ap-card:first-child',
  'min-height: 138px',
  'min-height: 124px'
]) {
  assert.ok(assistantCss.includes(token), `assistant CSS missing: ${token}`);
}

// Dieselben Zusicherungen fuer die herausgeloeste Datei — sonst waere die
// Aufteilung eine Luecke statt einer Ordnung.
for (const token of [
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
  assert.ok(operationalCss.includes(token), `operational CSS missing: ${token}`);
}

// Die Trennung muss halten: keine Familie darf in die andere Datei wandern.
assert.ok(!/\.vx-ops-[a-z-]*\s*[,{]/.test(assistantCss), 'assistant CSS took operational rules back');
assert.ok(!/\.vx-ap-[a-z-]*\s*[,{]/.test(operationalCss), 'operational CSS took assistant rules');

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
  '.vx-appbar',
  '.vx-appbar-back',
  '.vx-appbar-title',
  'var(--vx-ui-appbar-divider-color)',
  'var(--vx-ui-appbar-title-size)',
  '#nav-assistent.nav-item',
  '#mnav-assistent.mobile-nav-btn',
  // Seit dem Icon-Chip-Umbau setzen Seitenleiste und Tab-Leiste denselben
  // Aktiv-Zustand, deshalb steht er in einer gemeinsamen Regel statt in zwei.
  '.nav-item:is(.active, .vx-root-nav-active)',
  '.mobile-nav-btn:is(.active, .vx-root-nav-active)',
  'var(--vx-ui-nav-chip-bg)',
  'var(--vx-ui-nav-item-color)'
]) {
  assert.ok(navigationCss.includes(token), `navigation CSS missing: ${token}`);
}

// Der Aktiv-Zustand der Navigation hat genau einen Eigentuemer. Frueher lag er
// zusaetzlich in drei Inline-Bloecken in index.html und in den !important-Farben
// des Tab-Leisten-Reparaturskripts — daher der Bruch "mobil weiss, Desktop Navy".
{
  for (const forbidden of ['.nav-item.active{', '.mobile-nav-btn.active{']) {
    assert.ok(
      !dashboard.includes(forbidden),
      `index.html darf den Aktiv-Zustand der Navigation nicht selbst setzen: ${forbidden}`
    );
  }
  const mobileNavRepair = fs.readFileSync('customer-dashboard/shared/customer-runtime-mobile-nav-repair.js', 'utf8');
  for (const forbidden of ['rgba(255,255,255,.98)', '#64748b', '#3478ed']) {
    assert.ok(
      !mobileNavRepair.includes(forbidden),
      `Tab-Leisten-Reparatur darf keine eigenen Farben setzen: ${forbidden}`
    );
  }
  assert.ok(
    mobileNavRepair.includes("closest('.mobile-nav')"),
    'Tab-Leisten-Reparatur muss die Leiste selbst fixieren, nicht die Knopfreihe in ihr'
  );
}
// E8 (09.08.): Der Umschalter ist entfallen — mit ihm seine Mobil-Regeln.
// Statt der Trefferflaeche der Reiter wird jetzt die des Zurueck-Pfeils
// gesichert; er ist auf Mobile das einzige verbleibende Navigationselement
// innerhalb des Screens.
assert.match(
  navigationCss,
  /\.vx-appbar-back\s*\{[^}]*width:\s*var\(--vx-ui-appbar-back-size\)/,
  'navigation CSS missing the app bar back target size'
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
  // Etappe 6 / S2: eine Statuszeile pro Screen. Die Zusammenfassung sitzt im
  // Kopfbereich (customer-runtime-assistant-profile.js), die Betriebsstatus-
  // Karte erscheint nur noch bei einer Abweichung und erzeugt deshalb kein
  // vx-nav-status-summary mehr.
  'Diese Einrichtungen brauchen noch Ihre Aufmerksamkeit.',
  'function hasDeviation',
  "stack.dataset.vxStatusRendered = '1'",
  'function capabilityToggleHtml',
  'data-vx-capability-toggle',
  'type="button"',
  'vx-as-capabilities-simple',
  'vx-as-extra-capability',
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
  'vx-appbar',
  'data-cal-back',
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

// Klassen werden als Klassen geprüft, nicht als exakter Attributwert:
// class="vx-abo-hero vx-ui-brand-rule" ist derselbe Baustein wie
// class="vx-abo-hero". Die frühere Fassung verglich die Zeichenkette und
// schlug fehl, sobald eine Rolle danebengesetzt wurde — geprüft werden soll
// aber, DASS der kanonische Baustein da ist, nicht dass er allein steht.
for (const className of [
  'vx-settings-list',
  'vx-settings-entry',
  'vx-abo-hero',
  'vx-abo-contract-grid',
  'vx-abo-addon-grid'
]) {
  const present = new RegExp(`class="[^"]*\\b${className}\\b[^"]*"`).test(dashboard);
  assert.ok(present, `dashboard missing canonical settings markup: class ${className}`);
}

for (const token of [
  '<progress id="abo-minutes-bar"',
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
  ['operational', operationalCss],
  ['status', statusCss],
  ['settings', settingsCss],
  ['support', supportCss],
  ['navigation', navigationCss]
]) {
  assert.ok(!css.includes('<style'), `${name} CSS must not contain an embedded style tag`);
  assert.ok(!css.includes('javascript:'), `${name} CSS must not contain JavaScript URLs`);
  assert.equal((css.match(/!important/g) || []).length, 0, `${name} CSS must not add !important overrides`);
}

assert.match(loader, /customer-runtime-case-intake\.js\?v=20260808-1/);
assert.match(loader, /customer-runtime-calendar-settings\.js\?v=20260809-1/);
assert.match(loader, /customer-runtime-assistant-status\.js\?v=20260809-1/);
assert.match(loader, /customer-runtime-design-foundation\.js\?v=20260809-1/);
assert.match(loader, /__voxeraCustomerCaseIntakeLoaded/);
assert.match(loader, /__voxeraCustomerDesignFoundationLoaded/);


// --- Unified UI components (Design-System Etappe 1) ---------------------------
const uiComponentsCss = fs.readFileSync('customer-dashboard/shared/customer-ui-components.css', 'utf8');
const uiComponentsJs = fs.readFileSync('customer-dashboard/shared/customer-ui-components.js', 'utf8');
const designTokens = fs.readFileSync('customer-dashboard/shared/customer-design-tokens.css', 'utf8');
new vm.Script(uiComponentsJs, { filename: 'customer-dashboard/shared/customer-ui-components.js' });

for (const token of [
  '--vx-ui-appbar-divider-color: #E5E8EE',
  // Design-Nachzug 4 (2026-08-08): 17px/600 -> 24px/730. Der Seitentitel war
  // gemessen die kleinste Ueberschrift im Produkt — Kartentitel stehen auf
  // 18px/730, der Datensatzname im Detail-Panel auf 20px/700. Die Werte
  // bleiben hier festgenagelt, damit die Leiste nicht unbemerkt driftet.
  '--vx-ui-appbar-title-size: 24px',
  '--vx-ui-appbar-title-size-mobile: 21px',
  '--vx-ui-appbar-title-weight: 730',
  '--vx-ui-appbar-title-color: #0D1F3C',
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
  '.vx-requests-filters > .vx-ap-filter',
  '@keyframes vxUiSkeletonShimmer',
  'prefers-reduced-motion'
]) {
  assert.ok(uiComponentsCss.includes(token), `UI component CSS missing: ${token}`);
}

// The component layer must resolve every value from the token contract.
// Geprüft wird ausschliesslich echtes CSS, ohne Kommentare: die Hex-Regex
// unten liest sonst jede PR-Nummer im Fliesstext ("PR #848") als Farbwert
// und meldet einen Verstoss, den es nicht gibt. Dieselbe Vorsichtsmassnahme
// wie in verify-anfragen-list-row-polish.mjs, die dort schon aus demselben
// Grund getroffen wurde.
const uiComponentsRules = uiComponentsCss.replace(/\/\*[\s\S]*?\*\//g, ' ');
assert.equal((uiComponentsRules.match(/!important/g) || []).length, 0, 'UI component CSS must not add !important overrides');
assert.ok(!uiComponentsRules.includes('<style'), 'UI component CSS must not contain an embedded style tag');
assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(uiComponentsRules.replace(/#vx-assistant-root-switch/g, '')), 'UI component CSS must not hardcode colors; use the tokens');

// --- Block 6b: Sans-only + Stimmenrolle (2026-08-08) ------------------------
// Die frühere Regel "Serife = Stimme, Sans = Bedienelemente" ist zurück-
// genommen: das Kunden-Produkt ist durchgehend Sans. Die Stimme der
// Assistentin hebt sich weiterhin ab, aber über --vx-ui-voice-* (Grösse,
// Gewicht, Zeilenhöhe, Zeilenlänge) statt über einen Schriftwechsel.
//
// Ohne Wächter kriecht die Serife über die nächste Etappe zurück: sie stand
// an sechs Stellen in drei Dateien, davon zwei rein ornamental, und die
// Regel war nur in Kommentaren und Dokumenten festgehalten.
for (const token of [
  '--vx-ui-voice-font',
  '--vx-ui-voice-size',
  '--vx-ui-voice-size-sm',
  '--vx-ui-voice-weight: 500',
  '--vx-ui-voice-leading',
  '--vx-ui-voice-measure'
]) {
  assert.ok(designTokens.includes(token), `voice role token missing: ${token}`);
}

// --- Block 6c: geteilte Überschriften-Leiter (2026-08-09) -------------------
// Panel und Einstellungen legten ihre Überschriftenwerte getrennt fest und
// standen nebeneinander in zwei Leitern (Panel 24/20/20/14/13/12/11 gegen
// 24/18/15/14/13/12). Die beiden geteilten Stufen kommen jetzt aus einer
// Quelle; ohne Wächter driftet die nächste Fläche wieder auf Literale ab.
for (const token of [
  '--vx-ui-title-size: 18px',
  '--vx-ui-title-weight: 730',
  '--vx-ui-title-tracking',
  '--vx-ui-entry-title-size: 15px',
  '--vx-ui-entry-title-weight: 700'
]) {
  assert.ok(designTokens.includes(token), `heading ladder token missing: ${token}`);
}

// Die Stimme darf nicht wieder über die Titelstufe steigen: als Lauftext
// konkurriert sie dort direkt mit der Überschriftenhierarchie — der Grund,
// aus dem sie von 20px auf 17px zurückgenommen wurde. Nach unten begrenzt
// 15px: auf diesem Wert stand das Anliegen vor #848 und war als eigene
// Stimme nicht lesbar.
{
  const voiceSize = /--vx-ui-voice-size:\s*(\d+)px/.exec(designTokens);
  const titleSize = /--vx-ui-title-size:\s*(\d+)px/.exec(designTokens);
  assert.ok(voiceSize && titleSize, 'voice/title size tokens not readable');
  const voice = Number(voiceSize[1]);
  assert.ok(voice < Number(titleSize[1]), `voice size ${voice}px must stay below the title step ${titleSize[1]}px`);
  assert.ok(voice > 15, `voice size ${voice}px is back at the pre-#848 body-text level`);
}

// Panel und Einstellungen lesen dieselben zwei Stufen. Literale hier sind
// genau der Zustand, aus dem die zwei getrennten Leitern entstanden sind.
for (const [label, source, selectors] of [
  ['dashboard', dashboard, ['.vx-dv2-title', '.vx-dv2-action-title']],
  ['settings CSS', settingsCss, ['.vx-settings-card-title', '.vx-settings-entry-title']]
]) {
  for (const selector of selectors) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escaped}[^{};*/]*\\{([^}]*)\\}`).exec(source);
    assert.ok(match, `${label} missing ladder place: ${selector}`);
    assert.ok(/var\(--vx-ui-(title|entry-title)-size\)/.test(match[1]),
      `${label}: ${selector} sets its own size instead of reading the shared ladder`);
  }
}

// Die Leiter gilt erst, wenn sie niemand mit hoeherer Spezifitaet ueberstimmt.
// customer-runtime-settings-polish.js injizierte ein <style> mit
// "#mehr-sub-profil .vx-settings-card-title, #tab-hilfe .vx-settings-card-title
// {font-size:19px;font-weight:760}" — ID-Selektoren schlagen die Modulregel,
// und ausgerechnet Profil und Hilfe standen damit ausserhalb der geteilten
// Stufe, waehrend der Datei-Waechter oben gruen meldete. Ein Waechter, der nur
// die Modulregel liest, prueft die falsche Ebene.
{
  const polish = fs.readFileSync('customer-dashboard/shared/customer-runtime-settings-polish.js', 'utf8');
  assert.ok(!/vx-settings-card-title/.test(polish),
    'settings-polish runtime overrides the shared title step again (ID selectors beat the module rule)');
}

// Verboten ist die DEKLARATION, nicht das Wort: die Kommentare, die den
// Wechsel erklären, nennen die abgelöste Serife im Fliesstext und sollen
// stehen bleiben dürfen. Ein Kommentar schreibt "Newsreader-Serife", eine
// Regel schreibt 'Newsreader' in Anführungszeichen oder zieht das Token —
// beides ist eindeutig unterscheidbar, und die Prüfung braucht damit kein
// Kommentar-Stripping, das an den Regex-Literalen im Dashboard-JS ohnehin
// nicht zuverlässig ist.
const retiredSerif = [
  [/--vx-font-serif\s*:/, '--vx-font-serif definition'],
  [/var\(\s*--vx-font-serif/, 'var(--vx-font-serif) usage'],
  [/['"]Newsreader['"]/, "quoted 'Newsreader' family"],
  [/family=Newsreader/, 'Newsreader webfont request'],
  // "sans-serif" endet auf serif und wuerde ohne den Lookbehind jede
  // reguläre Sans-Kette melden.
  [/font-family\s*:[^;}]*(?<!sans-)\bserif\b/, 'serif font-family declaration']
];
for (const [label, source] of [
  ['design tokens', designTokens],
  ['assistant CSS', assistantCss],
  ['foundation CSS', foundationCss],
  ['UI component CSS', uiComponentsCss],
  ['dashboard', dashboard]
]) {
  for (const [pattern, what] of retiredSerif) {
    assert.ok(!pattern.test(source), `${label} reintroduces the retired serif: ${what}`);
  }
}

// Jeder Stimmen-Ort zieht die Rolle als Ganzes. Ein Ort, der nur die Grösse
// übernimmt und Gewicht oder Zeilenhöhe selbst setzt, driftet als erster
// wieder aus der gemeinsamen Rolle heraus.
for (const [label, source, selectors] of [
  ['dashboard', dashboard, ['.vx-lara-text', '.vx-report-voice .vx-ops-message', '.vx-dv2-task-summary']],
  ['assistant CSS', assistantCss, ['.vx-ap-hero-greeting']]
]) {
  for (const selector of selectors) {
    // Gelesen wird der Deklarationsblock, nicht ein Fenster ab dem ersten
    // Vorkommen: die Klassennamen stehen auch in den Kommentaren daneben.
    // Der Selektor-Teil darf deshalb kein * oder / enthalten — damit endet
    // die Suche an einem Kommentar, statt über ihn hinweg den nächsten
    // fremden Block einzufangen.
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escaped}[^{};*/]*\\{([^}]*)\\}`).exec(source);
    assert.ok(match, `${label} missing voice place: ${selector}`);
    for (const prop of ['var(--vx-ui-voice-font)', 'var(--vx-ui-voice-size)', 'var(--vx-ui-voice-weight)', 'var(--vx-ui-voice-leading)']) {
      assert.ok(match[1].includes(prop), `${label}: voice place ${selector} does not resolve ${prop}`);
    }
  }
}

// --- Block 7: form field contract ------------------------------------------
for (const token of [
  '--vx-ui-field-border',
  '--vx-ui-field-radius',
  '--vx-ui-field-height',
  '--vx-ui-field-focus-ring',
  '--vx-ui-field-chevron'
]) {
  assert.ok(designTokens.includes(token), `field contract token missing: ${token}`);
}

for (const token of [
  '.vx-ui-field',
  '.vx-ui-input',
  '.vx-ui-select',
  '.vx-ui-textarea',
  'appearance: none',
  '-webkit-appearance: none',
  'var(--vx-ui-field-chevron)',
  'var(--vx-ui-field-focus-ring)'
]) {
  assert.ok(uiComponentsCss.includes(token), `field component missing: ${token}`);
}

// A select without an appearance reset falls back to the native widget — the
// exact defect block 7 exists to remove.
assert.match(
  uiComponentsCss,
  /:where\(select, \.vx-ui-select\)\s*\{[^}]*appearance:\s*none/,
  'select must reset appearance so it stops rendering as the native widget'
);
// Checkbox and radio have their own contract instead of a tinted native widget.
for (const token of [
  '--vx-ui-choice-size',
  '--vx-ui-choice-accent',
  '--vx-ui-choice-border-width',
  '--vx-ui-choice-disabled-bg'
]) {
  assert.ok(designTokens.includes(token), `choice control token missing: ${token}`);
}
assert.match(
  uiComponentsCss,
  /input\[type="checkbox"\],\s*\n\s*input\[type="radio"\]\s*\n\)\s*\{[^}]*appearance:\s*none/,
  'checkbox and radio must reset appearance so they stop rendering as native widgets'
);
assert.ok(
  !settingsCss.includes('accent-color'),
  'the settings module must not tint native controls; the choice control owns them'
);

// Checkboxes, radios and range inputs must keep their intrinsic box.
for (const excluded of ['checkbox', 'radio', 'range', 'file']) {
  assert.ok(
    uiComponentsCss.includes(`:not([type="${excluded}"])`),
    `field baseline must exclude input[type=${excluded}]`
  );
}
assert.ok(!foundationCss.includes('body.vx-customer-design-foundation :where(input, select, textarea) {'), 'field box model must stay owned by the field component');

// --- Mobile tabs must stay reachable without horizontal scrolling ----------
// The "Anfragen" filters lost Geplant/Erledigt/Archiv on mobile because the
// legacy two-column grid rule (display:grid + width:100% on every chip) was
// written for the layout the pill component replaced. Wrapping is the only
// default: a scrolled-off tab has no affordance and reads as missing.
assert.ok(
  !dashboard.includes('grid-template-columns:repeat(2,minmax(0,1fr));\n    gap:var(--vx-space-2);\n    padding:14px 14px 8px;'),
  'the replaced two-column grid layout for the request filters must stay deleted'
);
assert.ok(
  !/#tab-anrufe \.vx-ap-filter\.vx-chip\{\s*width:100%/.test(dashboard),
  'request filter chips must not be forced to full row width on mobile'
);
assert.match(
  uiComponentsCss,
  /@media \(max-width: 720px\)[\s\S]*?\.vx-requests-filters \{\s*flex-wrap: wrap;/,
  'tabs must wrap on mobile so every tab stays reachable'
);
assert.ok(
  !/@media \(max-width: 720px\)[\s\S]*?#vx-assistant-root-switch,[\s\S]{0,200}?flex-wrap: nowrap/.test(uiComponentsCss),
  'mobile tabs must not default to nowrap + horizontal scrolling'
);
assert.ok(
  uiComponentsCss.includes('.vx-ui-tabs--scroll'),
  'horizontal scrolling must remain an explicit opt-in'
);

// --- Action feedback: spinner, not bare text -------------------------------
for (const token of [
  '--vx-ui-spinner-size',
  '--vx-ui-spinner-head',
  '--vx-ui-spinner-duration'
]) {
  assert.ok(designTokens.includes(token), `spinner token missing: ${token}`);
}
assert.ok(uiComponentsCss.includes('@keyframes vxUiSpin'), 'inline spinner animation missing');
assert.match(
  uiComponentsCss,
  /\.vx-ap-status,[\s\S]{0,160}?\)\.loading::before/,
  'loading statuses must render a spinner affordance'
);

// --- No second card system inside the assistant pages ----------------------
assert.ok(
  !assistantCss.includes('border-top: 1px solid var(--vx-brand-dark)'),
  'the dark accent border above the first assistant card must stay removed'
);
assert.ok(
  !/#vx-assistant-profile-body \.vx-ap-card,\s*body\.vx-customer-design-foundation #vx-business-profile-body \.vx-ap-card \{[^}]*box-shadow/.test(assistantCss),
  'assistant pages must not redeclare the card shell'
);

// --- Audio card: the loading state must keep the player mount hook ---------
// The auto-loader finds the card by #vx-call-audio-card[data-vx-audio-auto="1"]
// and reads data-conversation-id. A loading state without that shell never
// starts the fetch and leaves the skeleton on screen forever.
assert.match(
  dashboard,
  /if \(conversationId\) \{\s*return vxRenderAudioStateCardHtml\('loading'/,
  'audio loading state must render the card shell, not a bare skeleton'
);
assert.match(
  dashboard,
  /function vxRenderAudioStateCardHtml[\s\S]{0,1200}?data-vx-audio-auto="1"[\s\S]{0,1200}?vxUiSkeleton/,
  'audio card must keep the auto-load hook and render the skeleton inside it'
);

// --- Save feedback must be reachable from the field being edited, without
// forcing the page to scroll to it. The status nodes stay (used for
// warnings/errors); the loading/success state moved onto the save button
// itself via the shared vxInlineSaveStatus helper, and the page must never
// scrollIntoView to reveal it.
// E8 (09.08.): Das Namensfeld hat mit der Umgliederung seine eigene Karte
// verloren und sitzt jetzt im Identitaets-Editor — dessen Statusanker ist
// vx-hero-tune-status. Ein Pin auf den alten Knoten wuerde eine Regression
// behaupten, wo eine Zusammenfuehrung stattgefunden hat.
for (const token of [
  'vx-hero-tune-status',
  'vx-business-save-status',
  'function paintStatus',
  'vxInlineSaveStatus'
]) {
  assert.ok(assistantRuntime.includes(token), `inline save feedback missing: ${token}`);
}
assert.ok(!assistantRuntime.includes('scrollIntoView'), 'assistant profile save must not force-scroll the page');

for (const token of ['skeleton:', 'badge:', 'badgeTone:', 'emptyState:', 'card:', 'appBar:', 'tabs:', 'root.VoxeraUI =']) {
  assert.ok(uiComponentsJs.includes(token), `VoxeraUI factory missing: ${token}`);
}
for (const forbidden of ["createElement('style')", 'style.textContent', 'document.head.appendChild', 'setTimeout', 'MutationObserver', 'fetch(']) {
  assert.ok(!uiComponentsJs.includes(forbidden), `VoxeraUI factory must stay a pure markup builder: ${forbidden}`);
}

// The five components replaced their divergent predecessors — the old
// declarations must stay deleted, not be re-added next to the canonical ones.
assert.ok(!navigationCss.includes('grid-template-columns: repeat(3, minmax(0, 1fr))'), 'assistant switch must not return to a segmented control');
assert.ok(!foundationCss.includes('.vx-assistant-root-switch button.active'), 'assistant tab active state must stay owned by the tab component');
assert.ok(!operationalCss.includes('.vx-ops-pill {'), 'status pills must stay owned by the badge component');
assert.ok(!operationalCss.includes('.vx-ops-empty {'), 'empty states must stay owned by the empty-state component');
assert.ok(dashboard.includes('/shared/customer-ui-components.js?v=20260807-2'), 'dashboard must load the VoxeraUI markup factory');
assert.ok(!/wird geladen|werden geladen/i.test(calendarRuntime), 'calendar runtime must use the skeleton component, not loading text');
assert.ok(!/wird geladen …/i.test(assistantRuntime), 'assistant runtime must use the skeleton component, not loading text');

console.log('Customer dashboard design foundation verification passed.');

assert.doesNotMatch(navigationRuntime, /function addStyles|createElement\('style'\)|style\.textContent/);

for (const forbidden of ['#tab-assistent > :not(#vx-assistant-root-header):not(#vx-assistant-root-switch):not(#vx-assistant-root-host)','#vx-assistant-root-host > [data-vx-assistant-managed-page]:not([hidden])','.vx-nav-voice-details','#vx-assistant-profile-body .vx-ap-card:first-child']) assert.ok(!navigationCss.includes(forbidden), `navigation CSS still owns assistant structure: ${forbidden}`);
assert.ok(dashboard.includes('<script src="/shared/offer-brand.js?v=20260807-4"></script>'), 'dashboard missing versioned offer-brand loader');
assert.ok(!dashboard.includes('<script src="/shared/offer-brand.js"></script>'), 'dashboard still loads unversioned offer-brand');
assert.ok(loader.includes('/shared/customer-runtime-design-foundation.js?v=20260809-1'), 'offer-brand missing current design loader version');
assert.ok(!loader.includes('/shared/customer-runtime-design-foundation.js?v=20260803-4'), 'offer-brand still references stale design loader version');
for (const stale of ['/shared/customer-settings-components.css?v=20260807-3','/shared/customer-design-system.css?v=20260804-1','/shared/customer-assistant-components.css?v=20260803-1','/shared/customer-assistant-components.css?v=20260808-2','/shared/customer-assistant-components.css?v=20260808-3','/shared/customer-assistant-components.css?v=20260809-1','/shared/customer-assistant-components.css?v=20260809-2','/shared/customer-assistant-components.css?v=20260809-3','/shared/customer-navigation-components.css?v=20260803-1','/shared/customer-navigation-components.css?v=20260809-1','/shared/customer-design-system.css?v=20260809-1','/shared/customer-ui-components.css?v=20260809-1','/shared/customer-design-system.css?v=20260809-2']) assert.ok(!runtime.includes(stale), `design loader still contains stale CSS URL: ${stale}`);
const cssOrder=['/shared/customer-design-system.css?v=20260809-3','/shared/customer-assistant-components.css?v=20260809-4','/shared/customer-operational-components.css?v=20260809-1','/shared/customer-assistant-status.css?v=20260803-1','/shared/customer-navigation-components.css?v=20260809-2','/shared/customer-settings-components.css?v=20260809-3','/shared/customer-support-components.css?v=20260802-2','/shared/customer-ui-components.css?v=20260809-2'];
for(let i=1;i<cssOrder.length;i+=1) assert.ok(runtime.indexOf(cssOrder[i-1])<runtime.indexOf(cssOrder[i]),`design CSS module order changed: ${cssOrder[i-1]} before ${cssOrder[i]}`);

// Alle Screens liegen in .content — der Waechter gegen das verirrte </div>.
//
// Bis 2026-08-09 schloss ein zusaetzliches </div> den Container schon hinter
// #tab-assistent. #tab-mehr, #tab-einstellungen und #tab-benachrichtigungen
// standen dadurch als Geschwister daneben, sahen dessen Polsterung nie und
// waren auf Mobil sichtbar breiter als die uebrigen Screens (gemessen 14px
// statt 26px Einfassung bei 390px). Zwei CSS-Umgehungen haben zwei Symptome
// davon einzeln abgefangen, ohne die Ursache zu beruehren.
//
// Der Waechter zaehlt die Verschachtelung ab <div class="content"> und
// verlangt, dass jede .tab-page vor dem schliessenden Tag steht. Kommentare
// werden vorher entfernt, damit ein <div> im Fliesstext nicht mitzaehlt.
{
  const markup = dashboard.replace(/<!--[\s\S]*?-->/g, '');
  const start = markup.indexOf('<div class="content">');
  assert.ok(start >= 0, 'the dashboard must keep a single .content wrapper');

  let depth = 0;
  let close = -1;
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = start;
  for (let m = tag.exec(markup); m; m = tag.exec(markup)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) { close = m.index; break; }
  }
  assert.ok(close > start, '.content is never closed');

  const screens = [...markup.matchAll(/<div class="tab-page[^"]*" id="(tab-[a-z-]+)"/g)];
  assert.ok(screens.length >= 7, `expected at least seven screens, found ${screens.length}`);
  const outside = screens.filter((m) => m.index > close).map((m) => m[1]);
  assert.deepEqual(outside, [], `these screens sit outside .content again: ${outside.join(', ')}`);
}

// Die beiden Umgehungen von 2026-08-08 duerfen nicht zurueckkehren: sie haben
// die Wirkung des verirrten </div> abgefangen, nicht seine Ursache.
assert.ok(
  !dashboard.includes('.content:not(:has(> .tab-page.active))'),
  'the collapsed-.content workaround is back — the screens belong inside .content instead'
);
