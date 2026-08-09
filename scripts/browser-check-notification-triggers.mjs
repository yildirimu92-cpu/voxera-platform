// Browser-Gegenprobe zum Glocken-Abfaenger (2026-08-09).
//
// Laeuft NICHT in der Verify-Suite: braucht Playwright und einen laufenden
// Webserver, beides ist keine Repo-Abhaengigkeit. Die dauerhaften Guards
// stehen statisch in verify-notification-settings.mjs; dieses Skript ist der
// Nachweis am laufenden DOM, den man bei Aenderungen an
// customer-runtime-notifications.js von Hand wiederholt.
//
// Aufruf:
//   npx http-server -p 8099 -s customer-dashboard
//   PW_PATH="$(npm root -g)/playwright" node scripts/browser-check-notification-triggers.mjs
//
// Gegenprobe bestanden: gegen den Stand vor dem Fix meldet dieses Skript
// "Klick auf Glocken-Icon oeffnet die Einstellungsseite" als FAIL (panelOpen
// true, settingsPage false) und findet die verschachtelte Button-Rolle auf
// span.vx-settings-entry-icon -- es misst also wirklich den Fehler.

//
// Sandbox-Hinweis aus dem Briefing beachtet: das Phosphor-Webfont ist offline
// blockiert, die <i>-Elemente haetten dadurch null Groesse und waeren nicht
// anklickbar -- der Test wuerde faelschlich "kein Fehler" melden. Deshalb
// bekommen alle Icons hier eine Box, bevor geklickt wird.

import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || 'playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8099';

const results = [];
const check = (name, passed, detail) => {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${!passed && detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
let page = await browser.newPage({ viewport: { width: 390, height: 844 } });

page.on('pageerror', err => console.log('  [pageerror]', String(err).slice(0, 160)));

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
// Die vier Supplemental-Runtimes werden dynamisch nachgeladen.
await page.waitForFunction(() => window.__vxCustomerNotificationBridgeInstalledV5 === true, { timeout: 15000 });

// Die Sichtbarkeit muss vor jedem Schritt erneut erzwungen werden: mehrere
// Runtime-Module (mobile-nav-repair, screen-navigation) raeumen im Hintergrund
// weiter auf und haengen an einer Boot-Zustandsmaschine, die ohne
// Supabase-Zugangsdaten nie fertig wird.
const forceVisible = () => page.evaluate(() => {
  const app = document.getElementById('app');
  if (app) { app.style.setProperty('display', 'block', 'important'); app.style.opacity = '1'; app.hidden = false; }
  const login = document.getElementById('login-screen');
  if (login) login.style.setProperty('display', 'none', 'important');
  const notice = document.getElementById('vx-runtime-config-notice');
  if (notice) notice.style.setProperty('display', 'none', 'important');
  document.querySelectorAll('.tab-page').forEach(el => {
    el.classList.toggle('active', el.id === 'tab-mehr');
    if (el.id === 'tab-mehr') { el.hidden = false; el.style.setProperty('display', 'block', 'important'); }
  });
  const tabMehr = document.getElementById('tab-mehr');
  if (tabMehr) {
    let node = tabMehr.parentElement;
    while (node && node !== document.body) {
      if (getComputedStyle(node).display === 'none') node.style.setProperty('display', 'block', 'important');
      node = node.parentElement;
    }
  }
});


// App sichtbar machen, ohne die Auth-Zustandsmaschine anzufassen: der Test
// misst Klick-Routing, nicht den Login.
await page.evaluate(() => {
  const app = document.getElementById('app');
  if (app) { app.style.setProperty('display', 'block', 'important'); app.style.opacity = '1'; app.hidden = false; }
  const login = document.getElementById('login-screen');
  if (login) login.style.setProperty('display', 'none', 'important');
  // Ohne Supabase-Zugangsdaten legt vx-runtime-config.js einen bildschirm-
  // fuellenden Hinweis ueber die Seite. Er faengt jeden Klick ab -- derselbe
  // Fehlmessungs-Typ wie das blockierte Webfont: der Test meldete sonst
  // "Element nicht sichtbar" statt eines Ergebnisses.
  const notice = document.getElementById('vx-runtime-config-notice');
  if (notice) notice.style.setProperty('display', 'none', 'important');
  // Icons brauchen eine Box, sonst laeuft der Klick ins Leere (Webfont offline).
  const style = document.createElement('style');
  style.textContent = 'i[class*="ph-"]{display:inline-block!important;width:20px!important;height:20px!important;background:rgba(0,0,0,.001);}'
    + '#tab-mehr.active{display:block!important;}';
  document.head.appendChild(style);
  if (typeof window.showTab === 'function') window.showTab('mehr');
  // showTab setzt die Klasse; ohne vollstaendigen Boot bleibt sie sonst aus.
  document.querySelectorAll('.tab-page').forEach(el => el.classList.toggle('active', el.id === 'tab-mehr'));
  const main = document.getElementById('mehr-main');
  if (main) { main.hidden = false; main.removeAttribute('style'); }
});
await forceVisible();
await page.waitForTimeout(400);
await forceVisible();

// "Panel offen" wird an display und am Zustandsflag gemessen, nicht an der
// Hoehe: ohne Kundendaten rendert vxBellRender() eine leere Liste, und das
// Panel faellt nach kurzer Zeit auf Hoehe 0 zusammen, obwohl es offen ist.
// Die Hoehe zu pruefen haette hier einen Fehler gemeldet, den es nicht gibt.
const screenState = () => page.evaluate(() => {
  const visible = el => !!(el && !el.hidden && getComputedStyle(el).display !== 'none');
  const panel = document.getElementById('vx-notif-panel');
  return {
    mehrMain: visible(document.getElementById('mehr-main')),
    settingsPage: visible(document.getElementById('mehr-sub-benachrichtigungen')),
    panelOpen: visible(panel) || window._vxBellOpen === true
  };
});


// Frischer Seitenaufbau inklusive Sichtbarmachen. Ersetzt `page`, damit alle
// Helfer weiterhin gegen das aktuelle Dokument arbeiten.
async function freshPage() {
  if (page && !page.isClosed()) await page.close();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', err => console.log('  [pageerror]', String(err).slice(0, 160)));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__vxCustomerNotificationBridgeInstalledV5 === true, { timeout: 15000 });
  await page.addStyleTag({
    content: 'i[class*="ph-"]{display:inline-block!important;width:20px!important;height:20px!important;}'
  });
  await forceVisible();
  await page.waitForTimeout(350);
  await forceVisible();
}

const resetToMehrMain = () => page.evaluate(() => {
  if (typeof window.vxBellClose === 'function') window.vxBellClose();
  const panel = document.getElementById('vx-notif-panel');
  if (panel) panel.style.display = 'none';
  const backdrop = document.getElementById('vx-notif-backdrop');
  if (backdrop) backdrop.style.display = 'none';
  if (typeof window.vxMehrBack === 'function') window.vxMehrBack();
  if (typeof window.showTab === 'function') window.showTab('mehr');
  // showTab() haengt an der Boot-Zustandsmaschine, die hier bewusst nicht
  // durchlaeuft - die Tab-Sichtbarkeit deshalb nach jedem Reset erneut setzen.
  document.querySelectorAll('.tab-page').forEach(el => el.classList.toggle('active', el.id === 'tab-mehr'));
  const main = document.getElementById('mehr-main');
  if (main) { main.hidden = false; main.removeAttribute('style'); }
  const notice = document.getElementById('vx-runtime-config-notice');
  if (notice) notice.style.setProperty('display', 'none', 'important');
});

// ── Die Einstellungszeile: beide Trefferpunkte muessen dasselbe tun ─────────
//
// Geklickt wird nicht ueber Playwrights Actionability-Pruefung, sondern in zwei
// Schritten: erst wird per elementFromPoint belegt, dass das Ziel am
// Trefferpunkt tatsaechlich obenauf liegt (ein Nutzerklick landet dort), dann
// wird die echte Ereignisfolge auf genau diesem Element ausgeloest. Fuer diesen
// Bug ist das der genauere Nachweis: er haengt an der Reihenfolge der
// Capture-Listener, und die sieht exakt diese Ereignisse.
//
// Playwrights eigener Klick scheitert hier an einem Nebenumstand der Sandbox:
// customer-runtime-mobile-nav-repair.js verschiebt im 100ms-Takt Knoten, das
// Element gilt dauerhaft als "unstable".
async function clickAt(description, targetSelector) {
  return page.evaluate(({ targetSelector }) => {
    const row = [...document.querySelectorAll('button.vx-settings-entry')]
      .find(entry => /Benachrichtigungen/.test(entry.textContent));
    if (!row) return { error: 'Zeile nicht gefunden' };
    const target = row.querySelector(targetSelector);
    if (!target) return { error: 'Trefferpunkt nicht gefunden' };

    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return { error: 'Trefferpunkt hat keine Flaeche' };
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;

    const topMost = document.elementFromPoint(cx, cy);
    const reachable = Boolean(topMost && (topMost === target || target.contains(topMost) || topMost.contains(target)));

    const opts = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy };
    target.dispatchEvent(new PointerEvent('pointerdown', opts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.dispatchEvent(new MouseEvent('click', opts));

    return {
      reachable,
      topMost: topMost ? topMost.tagName.toLowerCase() + (topMost.id ? '#' + topMost.id : '') : null
    };
  }, { targetSelector });
}

await freshPage();
const rowExists = await page.evaluate(() =>
  Boolean([...document.querySelectorAll('button.vx-settings-entry')].find(e => /Benachrichtigungen/.test(e.textContent))));
check('Die Einstellungszeile "Benachrichtigungen" existiert', rowExists);

// Jeder Trefferpunkt in einem frischen Seitenaufbau: nach dem ersten Klick
// steht die App auf der Unterseite, und der Rueckweg dorthin haengt an
// derselben Boot-Zustandsmaschine, die hier nie fertig wird. Ein zweiter
// Messpunkt auf demselben Dokument misst dann den Aufraeumzustand, nicht den
// Klick.
for (const [label, selector] of [
  ['Glocken-Icon', 'span.vx-settings-entry-icon i'],
  ['Titeltext', 'span.vx-settings-entry-title']
]) {
  await freshPage();
  const hit = await clickAt(label, selector);
  await page.waitForTimeout(300);
  const state = await screenState();
  check(
    `${label}: der Trefferpunkt ist fuer einen Nutzerklick erreichbar`,
    hit.reachable === true,
    JSON.stringify(hit)
  );
  check(
    `Klick auf ${label} der Einstellungszeile oeffnet die Einstellungsseite`,
    state.settingsPage === true && state.panelOpen === false,
    JSON.stringify(state)
  );
}

// ── Die zwei echten Glocken muessen weiterhin den globalen Feed oeffnen ─────
for (const [label, id] of [
  ['Mobile-Header-Glocke', 'mobile-header-bell'],
  ['Sidebar-Glocke', 'vx-sidebar-bell-item']
]) {
  await freshPage();
  const opened = await page.evaluate((bellId) => {
    const bell = document.getElementById(bellId);
    if (!bell) return { missing: true };
    bell.style.display = 'flex';
    bell.style.pointerEvents = 'auto';
    bell.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    return { missing: false };
  }, id);
  await page.waitForTimeout(300);
  const state = await screenState();
  check(
    `${label} oeffnet weiterhin den globalen Feed`,
    !opened.missing && state.panelOpen === true,
    JSON.stringify({ ...opened, ...state })
  );
}

// ── Nebenfund Barrierefreiheit ─────────────────────────────────────────────
const a11y = await page.evaluate(() => {
  const icon = document.querySelector('button.vx-settings-entry span.vx-settings-entry-icon');
  const nested = [...document.querySelectorAll('[role="button"],[tabindex="0"]')]
    .filter(el => el.parentElement && el.parentElement.closest('button,a[href],[role="button"]'))
    .map(el => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`);
  return {
    iconRole: icon ? icon.getAttribute('role') : null,
    iconTabindex: icon ? icon.getAttribute('tabindex') : null,
    iconAriaLabel: icon ? icon.getAttribute('aria-label') : null,
    nestedInteractive: nested
  };
});
check('Das Icon-span traegt keine verschachtelte Button-Rolle', a11y.iconRole === null, JSON.stringify(a11y));
check('Das Icon-span ist kein zusaetzlicher Tab-Stopp', a11y.iconTabindex === null, JSON.stringify(a11y));
check('Das Icon-span traegt keine irrefuehrende Screenreader-Ansage', a11y.iconAriaLabel === null, JSON.stringify(a11y));
check('Keine verschachtelten interaktiven Rollen im Dokument', a11y.nestedInteractive.length === 0, JSON.stringify(a11y.nestedInteractive));

// ── Auftrag Punkt 4: ueberstimmt der Abfaenger noch andere Handler? ────────
const collateral = await page.evaluate(() => {
  // Alles, was die alte Heuristik als Glocke akzeptiert haette.
  const OLD = '[class*="ph-bell" i],[data-lucide*="bell" i],svg[class*="bell" i],i[class*="bell" i],'
    + '[aria-label*="Benachrichtigung" i],[title*="Benachrichtigung" i],'
    + '[aria-label*="notification" i],[title*="notification" i]';
  const GUARD = '#vx-notif-panel,#vx-notif-backdrop,#tab-benachrichtigungen';
  const hits = [...document.querySelectorAll(OLD)].filter(el => !el.closest(GUARD));
  return hits.map(el => {
    const owner = el.closest('[onclick]');
    return {
      el: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.className || '').toString().split(' ')[0]}`,
      wouldHaveHijacked: Boolean(owner && !owner.hasAttribute('data-notifications-trigger')),
      hijackedHandler: owner && !owner.hasAttribute('data-notifications-trigger')
        ? String(owner.getAttribute('onclick')).slice(0, 60)
        : null
    };
  }).filter(entry => entry.wouldHaveHijacked);
});
console.log(`\nVon der alten Heuristik ueberstimmte Handler (jetzt frei): ${collateral.length}`);
collateral.forEach(entry => console.log(`  ${entry.el} -> ${entry.hijackedHandler}`));

const stillHijacked = await page.evaluate(() => {
  const EXPLICIT = '[data-notifications-trigger],[data-notification-trigger],#notification-button,#notifications-button,#notification-bell,#notifications-bell';
  return [...document.querySelectorAll(EXPLICIT)].map(el => ({
    id: el.id || null,
    hasOwnBellHandler: String(el.getAttribute('onclick') || '').includes('vxBellToggle')
  }));
});
check(
  'Nur die zwei echten Glocken sind gekennzeichnet, beide mit eigenem Bell-Handler',
  stillHijacked.length === 2 && stillHijacked.every(entry => entry.hasOwnBellHandler),
  JSON.stringify(stillHijacked)
);

await browser.close();

const failed = results.filter(entry => !entry.passed);
console.log(`\n${results.length - failed.length}/${results.length} Pruefungen bestanden.`);
process.exit(failed.length ? 1 : 0);
