/**
 * Verifiziert die Neukonzeption der Erstlauf-Einfuehrung (09.08.2026):
 * Spotlight-Tour entfernt, eine einzige Willkommens-Karte, Schutz der
 * Entscheidungs-Merker im Speicher-Aufraeumer.
 *
 * Die eigentliche Regressionsgefahr hier ist nicht "sieht falsch aus",
 * sondern die stille Rueckkehr zweier konkreter Fehlerklassen:
 *
 *   1. Eine Einfuehrung, die sich an Element-IDs und Positionen haengt.
 *      Genau daran ist die alte Tour gescheitert: fehlte das Ziel-Element,
 *      zeichnete sie eine deckende Vollflaeche ueber die Seite — auf Mobile
 *      bei jedem einzelnen Schritt, weil alle mobileTarget-Angaben auf die
 *      unter 768px abgeschaltete Sidebar zeigten.
 *   2. Ein Aufraeumer, der Zustimmungs-Merker mit den Caches wegwirft und
 *      damit einen laengst weggeklickten Erstlauf-Dialog wieder aufreisst.
 *
 * Beide Klassen sind hier strukturell geprueft. Nicht geprueft (und auch
 * nicht pruefbar): das visuelle Ergebnis und das Verhalten gegen die echte
 * Datenbank — beides gehoert in den manuellen Abnahmelauf.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const INDEX = 'customer-dashboard/index.html';
const SETTINGS_CSS = 'customer-dashboard/shared/customer-settings-components.css';
const source = fs.readFileSync(INDEX, 'utf8');
const settingsCss = fs.readFileSync(SETTINGS_CSS, 'utf8');

// ── 0. Jedes Inline-Script muss parsebar bleiben ────────────────────────────
{
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(source))) {
    n++;
    new vm.Script(m[1], { filename: `${INDEX} inline#${n}` });
  }
  assert.ok(n > 0, 'keine Inline-Scripts gefunden — Parser-Annahme stimmt nicht mehr');
}

// ── 1. Die Spotlight-Tour ist vollstaendig weg ──────────────────────────────
// Geprueft werden ausfuehrbare Spuren, nicht das Wort "Tour": die Kommentare,
// die den Rueckbau begruenden, sollen ausdruecklich stehen bleiben duerfen.
{
  const executable = [
    ['id="tour-overlay"', 'Overlay-Markup'],
    ['id="tour-canvas"', 'Canvas'],
    ['id="tour-card"', 'Karten-Markup'],
    ['function tourStart', 'tourStart()'],
    ['function tourRender', 'tourRender()'],
    ['function tourDrawOverlay', 'tourDrawOverlay()'],
    ['function tourGetTargetRect', 'tourGetTargetRect()'],
    ['function tourCheckFirstLogin', 'tourCheckFirstLogin()'],
    ['TOUR_STEPS', 'Schritt-Liste'],
    ["'voxera_tour_v2_done'", 'lokaler Tour-Merker'],
    ['@keyframes tourCardIn', 'Karten-Animation'],
    ['#tour-overlay{', 'Overlay-CSS'],
  ];
  for (const [needle, label] of executable) {
    assert.ok(!source.includes(needle), `Spotlight-Tour ist zurueck (${label}: ${needle})`);
  }
  // Der Aufruf im Boot-Pfad ist die Stelle, die die Tour ueberhaupt startete.
  assert.ok(!/^\s*tourCheckFirstLogin\(\);/m.test(source),
    'tourCheckFirstLogin() wird wieder aus showApp() heraus aufgerufen');
  // Kein Escape-Eintrag mehr auf einen Dialog, den es nicht gibt.
  assert.ok(!/\{\s*id:\s*'tour-overlay'/.test(source),
    'ESCAPE_DIALOGS zeigt wieder auf #tour-overlay');
}

// ── 2. Der Vollflaechen-Rueckfall darf nicht wiederkehren ───────────────────
// Die konkrete Ursache war ein deckendes fillRect ueber die volle Viewport-
// Groesse, sobald ein Ziel-Element fehlte. Kein Canvas-Vollbild mehr im Code.
assert.ok(!/fillRect\(\s*0\s*,\s*0\s*,\s*W\s*,\s*H\s*\)/.test(source),
  'Vollflaechen-Rueckfall (fillRect ueber den ganzen Viewport) ist zurueck');

// ── 3. Genau eine Erstlauf-Ebene, und sie haengt an keiner Position ─────────
{
  assert.ok(source.includes('id="vx-onboarding-overlay"'),
    'die Willkommens-Karte fehlt — es gibt gar keine Einfuehrung mehr');
  assert.ok(source.includes('function vxOnboardingRenderBody'),
    'vxOnboardingRenderBody() fehlt — die Karte kann ihren Inhalt nicht mehr zur Laufzeit bauen');

  const body = source.slice(source.indexOf('function vxOnboardingRenderBody'));
  const end = body.indexOf('\nfunction vxOnboardingShow');
  assert.ok(end > 0, 'vxOnboardingRenderBody() ist nicht mehr abgrenzbar');
  const fn = body.slice(0, end);

  // Der Kern der Entscheidung: Namen statt Zeigefinger. Keine Geometrie.
  for (const forbidden of ['getBoundingClientRect', 'style.top', 'style.left', 'innerWidth']) {
    assert.ok(!fn.includes(forbidden),
      `vxOnboardingRenderBody() rechnet wieder mit Positionen (${forbidden}) — genau daran ist die Tour gescheitert`);
  }
  // Die Bereichsnamen kommen aus der Navigation, nicht aus einer zweiten
  // Textquelle. Der alte Text nannte "Mehr", der Eintrag hiess laengst
  // "Einstellungen" — diese Sorte Drift soll strukturell ausgeschlossen sein.
  assert.ok(fn.includes("navLabel('nav-anrufe'") && fn.includes("navLabel('nav-assistent'"),
    'die Bereichsnamen stammen nicht mehr aus der Navigation — Zweitquelle kann erneut veralten');
  // Grundsatz 13: der offene Zustand traegt seine Handlung direkt daneben.
  assert.ok(fn.includes('vxOnboardingStartForwarding()'),
    'der offene Punkt "Rufumleitung" hat keine erreichbare Handlung mehr (Grundsatz 13)');
  assert.ok(fn.includes('isForwardingSetupCompleted'),
    'die Karte prueft den Zustand der Rufumleitung nicht mehr und zeigt den Punkt unbedingt an');
}

// ── 4. Auslösung: Datenbank fuehrt, kein zweiter rein lokaler Merker ────────
{
  assert.ok(source.includes('onboarding_completed'),
    'das DB-Flag customers.onboarding_completed wird nicht mehr geschrieben');
  assert.ok(source.includes('function vxOnboardingBlockingDialogOpen'),
    'der Waechter gegen ueberlagerte Dialoge fehlt');
  const init = source.slice(source.indexOf('function vxOnboardingInit'),
                            source.indexOf('function vxOnboardingRenderBody'));
  assert.ok(init.includes('vxOnboardingBlockingDialogOpen()'),
    'vxOnboardingInit() oeffnet wieder ungeprueft ueber offenen Dialogen');
  assert.ok(init.includes('vxOnboardingIsDismissed()'),
    'vxOnboardingInit() prueft den Abschluss-Zustand nicht mehr');
}

// ── 5. Wiederholbar — und zwar auf der lebenden Hilfe-Seite ─────────────────
{
  const helpStart = source.indexOf('id="mehr-sub-hilfe"');
  assert.ok(helpStart > 0, '#mehr-sub-hilfe nicht gefunden');
  const helpBlock = source.slice(helpStart, helpStart + 6000);
  assert.ok(helpBlock.includes('vxOnboardingRestart()'),
    'die lebende Hilfe-Seite hat keinen Wiedereinstieg in die Willkommens-Karte');
  assert.ok(settingsCss.includes('.vx-help-restart{'),
    '.vx-help-restart ist ungestylt — der Knopf haette keine Einrueckung');
}

// ── 6. Speicher-Aufraeumer wirft keine Entscheidungen mehr weg ──────────────
// Das ist der eigentliche Wiederholungs-Ausloeser gewesen: der Aufraeumer
// entfernte pauschal alles mit Praefix vx_/voxera_ und traf damit auch die
// Merker "gesehen"/"abgeschlossen".
{
  assert.ok(source.includes('function vxIsProtectedDecisionStorageKey'),
    'die Positivliste fuer Entscheidungs-Merker fehlt wieder');
  const cleanup = source.slice(source.indexOf('function vxCleanupNonCriticalVoxeraStorage'));
  const cleanupFn = cleanup.slice(0, cleanup.indexOf('\nfunction '));
  assert.ok(cleanupFn.includes('vxIsProtectedDecisionStorageKey(key)'),
    'vxCleanupNonCriticalVoxeraStorage() fragt die Positivliste nicht mehr ab');

  // Der Vertrag wird am echten Verhalten geprueft, nicht am Wortlaut.
  const ctx = { result: null };
  vm.createContext(ctx);
  const fnSrc = source.slice(source.indexOf('function vxIsProtectedDecisionStorageKey'));
  vm.runInContext(fnSrc.slice(0, fnSrc.indexOf('\nfunction vxCleanupNonCriticalVoxeraStorage')), ctx);
  const protectedKeys = [
    'vx_onboarding_dismissed_abc-123',
    'voxera_setup_finished',
    'voxera_setup_finished_abc-123',
  ];
  for (const key of protectedKeys) {
    assert.equal(ctx.vxIsProtectedDecisionStorageKey(key), true,
      `Entscheidungs-Merker ${key} ist wieder loeschbar — der Erstlauf-Dialog kehrt damit zurueck`);
  }
  const disposableKeys = [
    'voxera_ai_report_abc-123',
    'voxera_seen_calls_abc-123',
    'vx_split_w',
    'vx_debug',
  ];
  for (const key of disposableKeys) {
    assert.equal(ctx.vxIsProtectedDecisionStorageKey(key), false,
      `Cache-Schluessel ${key} wird jetzt geschuetzt — der Aufraeumer kann keinen Platz mehr freigeben`);
  }
}

// ── 7. Keine verwaisten Verweise auf entfernte Bausteine ───────────────────
{
  assert.ok(!source.includes('var(--z-tour)'),
    '--z-tour wird wieder benutzt, obwohl das Token umbenannt wurde');
  assert.ok(source.includes('--z-above-mobile-nav:'),
    '--z-above-mobile-nav fehlt — die mobilen Sortiermenues verlieren ihre Ebene');
  assert.ok(source.includes('var(--z-above-mobile-nav)'),
    'die mobilen Sortiermenues nutzen die Ebene nicht mehr');
}

console.log('verify-onboarding-welcome: alle Pruefungen bestanden');
