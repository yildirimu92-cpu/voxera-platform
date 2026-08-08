/**
 * Verifiziert die Listen-Zeilen-Überarbeitung im Anfragen-Screen (Live-Test-
 * Feedback nach PR #824): Namenskürzung, zusammengelegte Filter-/Unread-Zeile,
 * entfernte Zusammenfassungsbox, dezente Aktions-Icons.
 *
 * Die eigentliche Regressionsgefahr hier ist nicht "sieht falsch aus",
 * sondern "eine ältere, generische Komponentenregel gewinnt wieder gegen die
 * für diese Liste gedachte" — genau das war die Ursache der Namenskürzung
 * (.vx-ops-item/.vx-ops-list schlugen .vx-requests-item/.vx-requests-list per
 * späterer Deklaration bei gleicher Spezifität). Dieses Skript prüft die
 * Gegenmassnahme strukturell; die visuelle Prüfung lief per Headless-Browser
 * gegen synthetische Namen unterschiedlicher Länge.
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
    new vm.Script(m[1], { filename: `${INDEX} inline#${n}` });
  }
  assert.ok(n > 0, 'keine Inline-Scripts gefunden — Parser-Annahme stimmt nicht mehr');
}

// ── 1. Namenskürzung: echtes CSS-Ellipsis, keine JS-Zeichenkürzung ─────────
assert.ok(
  source.includes("'<div class=\"vx-ops-title vx-requests-title\">' + _esc(name) + '</div>'"),
  'der volle Name wird nicht mehr unverändert ins Markup geschrieben — Verdacht auf neue JS-Kürzung'
);
assert.ok(!/name\.(slice|substring|substr)\(/.test(source.slice(source.indexOf('function renderAnrufeInbox'), source.indexOf('function renderAnrufeInbox') + 8000)),
  'renderAnrufeInbox() kürzt den Namen wieder per JS-Substring statt per CSS-Ellipsis');
// Geprüft wird der Ellipsis-Vertrag, nicht die Reihenfolge der Deklarationen:
// alle vier Angaben müssen im selben .vx-requests-title-Block stehen. Die
// frühere Regex verlangte eine feste Abfolge und wäre bei jeder zusätzlichen
// Deklaration (Schriftgrösse, Farbe, flex) fehlgeschlagen, ohne dass der
// Vertrag verletzt gewesen wäre.
{
  const m = /\.vx-requests-title\{([^}]*)\}/.exec(source);
  assert.ok(m, '.vx-requests-title-Regel nicht gefunden');
  for (const decl of ['min-width:0;', 'overflow:hidden;', 'text-overflow:ellipsis;', 'white-space:nowrap;']) {
    assert.ok(m[1].includes(decl),
      `.vx-requests-title hat nicht mehr die vollständige Ellipsis-Deklaration — fehlt: ${decl}`);
  }
  // Ohne flex-Wachstum bekäme der Name nur seine Inhaltsbreite und würde
  // trotz korrektem Ellipsis früher abgeschnitten als nötig.
  assert.ok(m[1].includes('flex:1 1 auto;'),
    '.vx-requests-title darf nicht mehr wachsen — der Name kürzt sonst vor der verfügbaren Breite');
}

// Die eigentliche Ursache: .vx-ops-item/.vx-ops-list (generische, ältere
// Listen-Komponente) gewannen gegen .vx-requests-item/.vx-requests-list bei
// gleicher Selektor-Spezifität durch spätere Deklaration im Cascade. Fix:
// die Anfragen-Regeln auf .vx-requests-panel scopen, um zu gewinnen.
for (const token of [
  'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-item{',
  'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-list{'
]) assert.ok(source.includes(token), 'Spezifitäts-Fix gegen die generische .vx-ops-* Kollision fehlt: ' + token);

// ── 2. Filter-Pills und "Nur ungelesene" teilen sich einen Container ───────
assert.ok(source.includes('<div class="vx-requests-filter-row">'), 'gemeinsamer Filter-Zeilen-Wrapper fehlt im Markup');
{
  const wrapStart = source.indexOf('<div class="vx-requests-filter-row">');
  assert.ok(wrapStart > 0, 'Filter-Zeilen-Wrapper nicht gefunden');
  const wrapEnd = source.indexOf('</p>', wrapStart); // reicht bis vor die retention-note
  const wrapRegion = source.slice(wrapStart, wrapEnd);
  assert.ok(wrapRegion.includes('vx-ap-filters vx-requests-filters'), 'Status-Pills liegen nicht mehr im gemeinsamen Wrapper');
  assert.ok(wrapRegion.includes('id="anrufe-inbox-subfilters"'), '"Nur ungelesene"-Gruppe liegt nicht mehr im gemeinsamen Wrapper');
}
// Der frühere 1px-Trenner vor "Nur ungelesene" ist entfernt (2026-08-08): mit
// den Heute-Pillen füllen die vier Status-Filter die Spalte genau aus, die
// Unread-Gruppe steht dadurch immer in der zweiten Zeile — dort trennte der
// Strich nichts mehr. Der gemeinsame Wrapper (Punkt 2 oben) bleibt die
// eigentliche Anforderung aus #827 und wird weiterhin geprüft.
assert.ok(!source.includes('.vx-requests-subfilters::before{'),
  'der Trenner-Stummel vor "Nur ungelesene" ist wieder da');
// Das Banner (#anrufe-active-filter-banner) darf sich nicht in den Wrapper
// hängen, sonst quetscht es sich mit in die Pill-Zeile statt darunter zu
// stehen (siehe ensureFilterBanner()).
assert.match(source, /var filterRow = subWrap\.closest\('\.vx-requests-filter-row'\)[\s\S]{0,40}filterRow\.parentNode\.insertBefore\(banner, filterRow\.nextSibling\)/,
  'das Filter-Banner hängt sich wieder direkt hinter #anrufe-inbox-subfilters statt hinter den ganzen Wrapper');

// ── 3. Zusammenfassungsbox entfernt ─────────────────────────────────────────
assert.ok(!source.includes('id="anrufe-split-count"'), 'die redundante Zusammenfassungsbox ("X offen · Y geplant...") ist wieder im Markup');
assert.ok(!/getElementById\('anrufe-split-count'\)/.test(source), 'toter JS-Verweis auf die entfernte Zusammenfassungsbox ist wieder da');

// ── 4. Dezente Icon-Aktionen statt gefüllter 40px-Boxen ─────────────────────
// Wie bei .vx-requests-title wird der Vertrag geprüft, nicht der Abstand
// zwischen den Deklarationen: kompakt (28px in beiden Achsen) und im
// Ruhezustand ohne Füllung.
{
  const m = /\.vx-requests-icon-action\{([^}]*)\}/.exec(source);
  assert.ok(m, '.vx-requests-icon-action-Regel nicht gefunden');
  for (const decl of ['width:28px;', 'height:28px;', 'min-height:28px;', 'background:transparent;']) {
    assert.ok(m[1].includes(decl),
      `Aktions-Buttons erfüllen den kompakten Icon-Vertrag nicht mehr — fehlt: ${decl}`);
  }
}
for (const forbidden of [
  '.vx-requests-icon-action.is-call{background:var(--vx-brand-dark)',
  '.vx-requests-icon-action.is-done{background:#ecfdf5',
  '.vx-requests-icon-action.is-overflow{background:#f1f5f9'
]) assert.ok(!source.includes(forbidden), 'alte gefüllte Button-Variante ist zurück: ' + forbidden);

console.log('Anfragen list row polish verification passed.');
