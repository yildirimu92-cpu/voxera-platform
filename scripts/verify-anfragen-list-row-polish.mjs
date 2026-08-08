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

// ── 5. Ruhige Textfarben: EIN Token für Heute und Anfragen ─────────────────
// Die beiden Screens hielten #8A93A6 vorher nur zufällig gemeinsam — fünfmal
// als Literal im Heute-Block, dreimal als Kopie in den Tokens. Diese Prüfung
// hält die Kopplung fest UND den Kontrastwert selbst, damit weder ein neues
// Literal noch ein aufgehellter Token unbemerkt durchrutscht.
{
  const TOKENS = 'customer-dashboard/shared/customer-design-tokens.css';
  const tokens = fs.readFileSync(TOKENS, 'utf8');

  // Kein Screen darf die Meta-Farbe wieder als Literal setzen. (Im
  // Token-Kommentar steht #8A93A6 als Beleg der Historie und ist erlaubt.)
  assert.ok(!/color\s*:\s*#8A93A6/i.test(source),
    'ruhige Textfarbe steht wieder als Literal in index.html statt als --vx-ui-meta-color');
  assert.ok(!/color\s*:\s*#8A93A6/i.test(tokens),
    'ein Token setzt die ruhige Textfarbe wieder direkt statt über --vx-ui-meta-color');

  // Beide Screens ziehen dieselbe Quelle.
  for (const rule of [
    '.vx-handover-card-time { font-size:12px; color:var(--vx-ui-meta-color);',
    '.vx-handover-footlink { margin-top:18px; font-size:12px; color:var(--vx-ui-meta-color);'
  ]) assert.ok(source.includes(rule), 'Heute-Screen zieht die ruhige Textfarbe nicht mehr aus dem Token: ' + rule);
  for (const alias of [
    '--vx-ui-row-time-color: var(--vx-ui-meta-color);',
    '--vx-ui-section-label-color: var(--vx-ui-meta-color);',
    '--vx-ui-section-count-color: var(--vx-ui-meta-color);',
    '--vx-ui-row-desc-color: var(--vx-ui-text-secondary);'
  ]) assert.ok(tokens.includes(alias), 'Anfragen-Token hängt nicht mehr am gemeinsamen Wert: ' + alias);

  // WCAG AA (4.5:1) auf den Flächen, auf denen diese Rollen tatsächlich liegen.
  const luminance = (hex) => {
    const parts = hex.replace('#', '').match(/../g).map((pair) => parseInt(pair, 16) / 255)
      .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  };
  const ratio = (fg, bg) => {
    const [a, b] = [luminance(fg), luminance(bg)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const value = (name) => {
    const found = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(tokens);
    assert.ok(found, `Token ${name} nicht gefunden oder kein Hex-Wert`);
    return found[1];
  };

  const meta = value('--vx-ui-meta-color');
  const secondary = value('--vx-ui-text-secondary');
  const countBg = value('--vx-ui-section-count-bg');
  const CARD = '#FFFFFF';
  const CANVAS = '#F7F8FA';
  const LARA_BUBBLE = '#EEF1F6';

  for (const [label, fg, bg] of [
    ['Meta auf Karte', meta, CARD],
    ['Meta auf Canvas', meta, CANVAS],
    ['Meta in der Zähler-Pille', meta, countBg],
    ['Sekundärtext auf Karte', secondary, CARD],
    ['Lara-Signatur auf der Bubble', secondary, LARA_BUBBLE]
  ]) {
    const measured = ratio(fg, bg);
    assert.ok(measured >= 4.5,
      `${label}: ${fg} auf ${bg} erreicht nur ${measured.toFixed(2)}:1 — WCAG AA verlangt 4.5:1`);
  }

  // Die Hierarchie muss lesbar bleiben: Meta sichtbar leichter als Fliesstext.
  assert.ok(luminance(meta) > luminance(secondary) * 1.25,
    'ruhige Textfarbe ist so dunkel geworden, dass sie sich nicht mehr vom Sekundärtext abhebt');
}

console.log('Anfragen list row polish verification passed.');
