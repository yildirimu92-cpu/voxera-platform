/**
 * Verifiziert die Konsolidierung der Anfrage-/Aufgaben-Detailansicht
 * (Etappe 4, Teil A).
 *
 * Die Regressionsgefahr in dieser Datei ist nicht "ein Detail sieht falsch
 * aus", sondern "es entsteht wieder eine zweite Implementierung": ein
 * weiterer Wrapper um den Renderer, eine weitere host-gescopte CSS-Kopie,
 * ein weiterer direkter Mount-Pfad in eine Detailfläche. Genau das prüft
 * dieses Skript strukturell — die visuelle Prüfung läuft im Headless-Browser
 * gegen synthetische Daten (siehe docs/CUSTOMER_REQUEST_DETAIL_CONSOLIDATION_2026-08-07.md).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const INDEX = 'customer-dashboard/index.html';
const source = fs.readFileSync(INDEX, 'utf8');

// ── 0. Jedes Inline-Script muss parsebar bleiben ────────────────────────────
{
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(source))) {
    n++;
    const line = source.slice(0, m.index).split('\n').length;
    new vm.Script(m[1], { filename: `${INDEX} inline#${n}@L${line}` });
  }
  assert.ok(n > 0, 'keine Inline-Scripts gefunden — Parser-Annahme stimmt nicht mehr');
}

// ── 1. Genau EIN Renderer ───────────────────────────────────────────────────
for (const token of [
  'function vxRenderEntryDetail(record, options)',
  'window.vxRenderEntryDetail = vxRenderEntryDetail',
  'window.vxRenderRequestsDetailV2 = vxRenderEntryDetail'
]) assert.ok(source.includes(token), 'Detailkomponente fehlt: ' + token);

{
  // Der Bestandsname darf nur noch als Alias auf die Komponente gesetzt
  // werden — jede weitere Zuweisung ist eine neue Wrapper-Schicht.
  const assignments = source.match(/window\.vxRenderRequestsDetailV2\s*=/g) || [];
  assert.equal(
    assignments.length, 1,
    `window.vxRenderRequestsDetailV2 wird ${assignments.length}x zugewiesen — erwartet: genau 1 (Alias auf vxRenderEntryDetail). ` +
    'Eine zusätzliche Zuweisung ist eine neue Wrapper-Schicht um den Renderer.'
  );
}

// Marker der früheren Detail-Wrapper. _vxJ4Wrapped/_vxPrNWrapped bewusst NICHT
// in dieser Liste: dieselben Marker sitzen auch auf den Listen-Wrappern
// (renderAnrufe/renderDashboard), die hier nicht zur Debatte stehen.
for (const forbidden of [
  '_vxPrMWrapped',
  '_vxPrPTypeAware',
  '__vxPrV2TaskCallValidation'
]) assert.ok(!source.includes(forbidden), 'alte Detail-Wrapper-Schicht wieder vorhanden: ' + forbidden);

// Kein Weiterreichen an einen vorherigen Detail-Renderer — das ist die Form,
// in der die Kette entstanden ist.
for (const chaining of [
  'var prevDetail = window.vxRenderRequestsDetailV2',
  'var prevRender = window.vxRenderRequestsDetailV2',
  'var previousRenderer = window.vxRenderRequestsDetailV2'
]) assert.ok(!source.includes(chaining), 'Detail-Renderer wird wieder umhüllt: ' + chaining);

// ── 2. Genau EIN Aufgaben-Zweig, innerhalb der Komponente ───────────────────
assert.ok(source.includes('function buildTaskBodyHtml(record)'), 'Aufgaben-Zweig der Komponente fehlt');
assert.ok(source.includes('function buildCallBodyHtml(record)'), 'Anfragen-Zweig der Komponente fehlt');
{
  const shells = source.match(/data-entry-type="/g) || [];
  assert.equal(shells.length, 1,
    'Die Shell darf nur an einer Stelle erzeugt werden (data-entry-type) — gefunden: ' + shells.length);
}

// ── 3. Genau EIN Stylesheet, an die Shell-Klasse gebunden ───────────────────
assert.ok(source.includes('<style id="vx-entry-detail-css">'), 'Stylesheet der Detailkomponente fehlt');
for (const forbidden of [
  'vx-pr-j1-detail-v2-style',
  'vx-pr-o2-fullscreen-detail-css',
  'vx-pr-p-task-detail-v2-style',
  'vx-pr-r3-detail-v2-initial-style-hydration',
  'vx-pr-v2-task-call-detail-css'
]) assert.ok(!source.includes(forbidden), 'host-gescopte CSS-Kopie wieder vorhanden: ' + forbidden);

// Die CSS-Kopien wurden zur Laufzeit per String-Replace erzeugt — jede neue
// Fläche kostete eine Kopie, und der Block verdoppelte sich dabei selbst.
assert.ok(
  !/style\.textContent\s*\+=\s*style\.textContent\.replace/.test(source),
  'Detail-CSS wird wieder per String-Replace auf weitere Hosts kopiert'
);
for (const hostScope of [
  '#requests-detail-v2 .vx-dv2-',
  '#vx-detail-v2-fullscreen .vx-dv2-',
  '#vx-detail-v2-full-content .vx-dv2-',
  '#archiv-detail-v2 .vx-dv2-',
  '#call-detail-content .vx-dv2-'
]) assert.ok(!source.includes(hostScope),
  'Detail-CSS ist wieder an einen Host gebunden statt an die Shell-Klasse: ' + hostScope);

// Card-Radius über das kanonische Token der Design-System-Checkliste.
assert.ok(source.includes('.vx-dv2-card{background:var(--vx-surface,#fff);border-radius:var(--vx-ui-card-radius,12px)'),
  '.vx-dv2-card nutzt nicht den kanonischen Card-Radius-Token');
{
  const tokens = fs.readFileSync('customer-dashboard/shared/customer-design-tokens.css', 'utf8');
  assert.match(tokens, /--vx-ui-card-radius:\s*12px/,
    'kanonischer Card-Radius im Token-Owner ist nicht mehr 12px');
}

// ── 4. Genau EIN Mount-Pfad in die Detailflächen ────────────────────────────
assert.ok(source.includes('function mountDetail(record, hostEl, frame)'), 'zentraler Mount-Pfad fehlt');
assert.ok(source.includes('function releaseAllHostsExcept(keepEl)'),
  'Single-Mount-Invariante (nur eine Fläche hält Inhalt) fehlt');
assert.ok(source.includes("function openPanelV2(record, panel)") && source.includes("function openFullscreenV2(record, preferredType)"),
  'die beiden Rahmen (Panel / Vollbild) fehlen');

{
  // Nur die Rahmen-Funktionen dürfen die Komponente aufrufen. Jeder weitere
  // Aufruf ist ein zweiter Einstieg in eine Detailfläche.
  const calls = source.match(/window\.vxRenderEntryDetail\(record, \{ hostEl:/g) || [];
  assert.equal(calls.length, 1,
    'die Komponente wird an ' + calls.length + ' Stellen direkt gemountet — erwartet: nur in mountDetail()');
}

// ── 5. Legacy-Vollseite ist entkoppelt ──────────────────────────────────────
// Renderer A bleibt in diesem Schritt bewusst bestehen (Löschung folgt als
// eigener Schritt), darf aber keine Detailfläche mehr bespielen.
assert.ok(!/vxRenderRequestsDetailV2\(rec, \{ hostEl: detailV2El \}\)/.test(source),
  'die Legacy-Seite rendert wieder in den Split-Host #requests-detail-v2');
assert.ok(!/renderCallDetailPage\(rec\.fields \|\| rec, \[\]\)/.test(source),
  'es gibt wieder einen direkten UI-Aufruf der Legacy-Seite (vxArchivRowClick)');
{
  // Die Legacy-Seite darf sich nicht mehr in die Panel-Fläche umhängen.
  const reparents = source.match(/splitRight\.appendChild\(page\)/g) || [];
  assert.equal(reparents.length, 0,
    '#call-detail-page wird wieder in #anrufe-split-right umgehängt (' + reparents.length + 'x)');
}
// openDetail() ist nur noch Einstiegspunkt, kein eigenes Overlay-Template.
assert.ok(!/document\.getElementById\('detail-content'\)\.innerHTML\s*=/.test(source),
  'openDetail() hat wieder ein eigenes Detail-Template');

// ── 6. Lebenszyklus: Live-Phase, nicht vxIsLiveCall ─────────────────────────
assert.ok(/window\.vxIsCallInLivePhase\(record\)\) return false;/.test(source),
  'der Detail-Router prüft die Live-Phase nicht');
{
  // Im Router-/Komponentenbereich darf das weitere Prädikat nicht auftauchen.
  const start = source.indexOf('<style id="vx-entry-detail-css">');
  assert.ok(start > 0, 'Ankerpunkt für den Detail-Bereich nicht gefunden');
  const codeLines = source.slice(start).split('\n')
    .filter((line) => !/^\s*(\/\/|\*|<!--)/.test(line)); // Kommentare dürfen das Prädikat benennen
  const offenders = codeLines.filter((line) => line.includes('vxIsLiveCall('));
  assert.equal(offenders.length, 0,
    'im Detail-Bereich wird wieder vxIsLiveCall() statt vxIsCallInLivePhase() verwendet: ' + offenders.join(' | '));
}

// ── 7. Kein post-hoc DOM-Nachschreiben nach dem Rendern ─────────────────────
for (const forbidden of [
  "actionBar.innerHTML = vxRenderDetailV2Actions",
  "sanitizeVisibleLabels((options && options.hostEl)"
]) assert.ok(!source.includes(forbidden),
  'die Detailansicht wird nach dem Rendern wieder im DOM nachkorrigiert: ' + forbidden);

// ── 8. Status-Chip im Header: gleicher Wert, gleiche Farbe wie die Liste ────
// Bug (2026-08-08): "Geplant" erschien in der Anfragen-Liste gefüllt
// hellblau (vxUiBadge/'info'), im Detailpanel dagegen grau/weiss mit Rand
// (chipHtml()'s eigene 'status'-Palette) — derselbe Datensatz, zwei
// unabhängige Farbquellen. Die zweite, gröbere Ursache: chipHtml() wählte
// die Farbe über `done ? 'green' : 'status'`, also nur zweiwertig — ein
// ARCHIVIERTER Datensatz (isCompleted() ist für 'done' UND 'archived' wahr)
// bekam dadurch "Archiviert" als Text in derselben grünen Farbe wie
// "Erledigt". statusToneOf() leitet wie statusLabelOf() alle vier Werte aus
// derselben lifecycleOf()-Ableitung ab und zieht die Farbe aus denselben
// --vx-ui-badge-* Tokens, die auch das Listen-Badge verwendet.
assert.ok(source.includes("function statusToneOf(record){"),
  'statusToneOf() fehlt — der Status-Chip im Detailpanel hat keine token-gebundene Farbableitung mehr');
assert.match(source, /function statusToneOf\(record\)\{\s*var s = lifecycleOf\(record\);\s*return s === 'archived' \? 'statusNeutral' : s === 'done' \? 'statusSuccess' : s === 'planned' \? 'statusInfo' : 'statusQuiet';\s*\}/,
  'statusToneOf() deckt nicht mehr alle vier lifecycleOf()-Werte (archived/done/planned/offen) ab');
for (const tone of ['statusInfo', 'statusSuccess', 'statusNeutral', 'statusQuiet']) {
  assert.ok(source.includes(`      ${tone}:'background:var(--vx-ui-badge-`),
    `chipHtml()-Palette hat kein ${tone}-Eintrag mehr, oder er zieht nicht mehr aus --vx-ui-badge-* (derselben Quelle wie die Liste)`);
}
// Beide Aufrufstellen (Anruf- und Aufgaben-Header) müssen den Status-Chip
// über statusToneOf() einfärben statt über eine eigene done/gold-Fallunterscheidung.
assert.ok(source.includes("var chips = [chipHtml(statusLabelOf(record), statusToneOf(record))];"),
  'buildCallHeaderHtml() färbt den Status-Chip wieder über eine eigene done/status-Fallunterscheidung statt über statusToneOf()');
assert.ok(source.includes("var chips = [chipHtml(status, statusToneOf(record))];"),
  'buildTaskHeaderHtml() färbt den Status-Chip wieder über eine eigene done/gold-Fallunterscheidung statt über statusToneOf()');
// Die alte, zu grobe done-basierte Status-Einfärbung darf nicht zurückkehren.
for (const forbidden of [
  "chipHtml(statusLabelOf(record), done ? 'green' : 'status')",
  "chipHtml(status, done ? 'green' : (status === 'Geplant' ? 'gold' : 'status'))"
]) assert.ok(!source.includes(forbidden), 'die alte, nur zweiwertige Status-Chip-Einfärbung ist zurück: ' + forbidden);

console.log('Customer request detail consolidation verification passed.');
