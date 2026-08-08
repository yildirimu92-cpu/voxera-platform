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

// ── 4b. Auswahl: Fläche statt Rahmen, keine einseitige Kante ─────────────
// Historie in zwei Schritten. Bis 2026-08-08 trug die ausgewählte Zeile eine
// 3px-Night-Kante links (box-shadow:inset 3px 0 0) — nach dem Abräumen der
// Akzent-Ränder auf Heute die letzte einseitige Akzent-Kante im Produkt.
// Sie wurde durch einen umlaufenden Night-Rahmen plus 1px-Innenring ersetzt,
// zusammen rund 1.5px.
//
// Dieser Rahmen ist im selben Zug wieder gefallen: zusammengelesen war er
// lauter als jedes andere Signal in der Zeile (Ungelesen-Punkt, Status-Chip,
// Lead-Farbe) und konkurrierte mit der Karte selbst. Die Auswahl liegt jetzt
// in der Fläche (--vx-ui-row-selected-bg), der Rahmen bleibt die Haarlinie
// auf Hover-Stärke.
//
// Was diese Prüfung über beide Schritte hinweg festhält, ist nicht die
// jeweilige Technik, sondern die Anforderung dahinter: die Markierung ist
// umlaufend und nie wieder eine einseitige Kante.
{
  const rule = /\.vx-requests-item\.sp-active\{([^}]*)\}/.exec(source);
  assert.ok(rule, '.vx-requests-item.sp-active-Regel nicht gefunden');
  assert.match(rule[1], /background:var\(--vx-ui-row-selected-bg\)/,
    'die ausgewählte Zeile trägt nicht mehr die Auswahl-Tönung');
  // Ein voller Night-Rahmen wäre der Rückfall in den vorigen Stand.
  assert.ok(!/border-color:var\(--vx-color-night\)/.test(rule[1]),
    'die Auswahl trägt wieder den vollen Night-Rahmen statt der Tönung');
  assert.ok(!/box-shadow:inset/.test(rule[1]),
    'die Auswahl trägt wieder einen Innenring zusätzlich zur Tönung');

  // Die Tönung muss die Ungelesen-Regel schlagen. Beide setzen background bei
  // gleicher Spezifität, also entscheidet die Reihenfolge: steht .is-unread
  // hinter .sp-active, verliert eine ausgewählte ungelesene Zeile ihre
  // Markierung vollständig. Genau das war beim Umbau der Fall und ist ohne
  // Messung unsichtbar, weil beide Zustände einzeln richtig aussehen.
  {
    const unreadAt = source.indexOf('.vx-requests-item.is-unread{');
    const activeAt = source.indexOf('.vx-requests-item.sp-active{');
    assert.ok(unreadAt > 0 && activeAt > 0, 'Auswahl- oder Ungelesen-Regel nicht gefunden');
    assert.ok(unreadAt < activeAt,
      'die Ungelesen-Regel steht wieder hinter der Auswahl und überschreibt deren Tönung');
  }

  // Kein Regelblock darf die Auswahl der Anfragen-Karte wieder als einseitige
  // Kante zeichnen. Geprüft wird pro Regel statt per Gesamt-Regex: die
  // Legacy-Blöcke tragen ".sp-active:not(.vx-requests-item)" im Selektor und
  // setzen dort zu Recht "border-left" — eine Regex über die ganze Datei kann
  // beides nicht auseinanderhalten.
  //
  // Grundlage ist ausschliesslich echtes CSS: nur der Inhalt der
  // <style>-Blöcke, ohne Kommentare. Beides ist nötig, sonst laufen die
  // Prüfungen auf Text statt auf Regeln — die Kommentare hier nennen
  // .vx-requests-item.sp-active ausdrücklich, und mehrere Skriptstellen
  // führen '#anrufe-list .sp-active' als Query-String für querySelectorAll.
  const cssOnly = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.ok(cssOnly.includes('.vx-requests-item.sp-active'),
    'die Auswahl-Regel liegt nicht mehr in einem <style>-Block — die Prüfung greift ins Leere');
  for (const [selectors, block] of [...cssOnly.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1], m[2]])) {
    const targetsCard = selectors
      .replace(/:not\([^)]*\)/g, '')          // :not(...)-Ausnahmen ausblenden
      .includes('.vx-requests-item.sp-active');
    if (!targetsCard) continue;
    assert.ok(!/border-left\s*:/.test(block),
      'die Auswahl-Markierung ist wieder eine einseitige Kante (border-left auf der Anfragen-Karte)');
    assert.ok(!/box-shadow:\s*inset\s+(?!0\s+0\s+0\s)/.test(block),
      'die Auswahl-Markierung ist wieder eine einseitige Kante (inset-Schatten mit Versatz)');
  }

  // Die Legacy-Regeln mit ihrer ID-Spezifität müssen weiterhin auf die
  // .dpr-card-Zeilen eingegrenzt bleiben, sonst schlagen sie dem umlaufenden
  // Rahmen wieder eine Seite heraus. Gemeint sind nur Regeln, die die
  // ausgewählte KARTE selbst treffen — "#anrufe-list .sp-active .dpr-row"
  // adressiert einen Nachfahren, den die Anfragen-Karte gar nicht enthält.
  for (const sel of cssOnly.match(/#anrufe-list\s+\.sp-active[^,{]*/g) || []) {
    const trimmed = sel.trim();
    const targetsCardItself = /\.sp-active(:[a-z-]+(\([^)]*\))?)*$/.test(trimmed);
    if (!targetsCardItself) continue;
    assert.ok(/:not\(\.vx-requests-item\)/.test(trimmed),
      'eine Legacy-Regel greift wieder ungefiltert auf die Anfragen-Karte zu: ' + trimmed);
  }
}

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

  // Beide Screens ziehen dieselbe Quelle. Geprüft wird die Kopplung, nicht
  // der Wortlaut der Deklaration: seit der Akzent-Angleichung (2026-08-08)
  // zieht die Kartenzeit über --vx-ui-row-time-color, das seinerseits auf
  // --vx-ui-meta-color zeigt. Beide Wege sind zulässig, ein Literal nicht.
  const META_SOURCES = /var\(--vx-ui-(?:meta-color|row-time-color|section-label-color)\)/;
  for (const selector of ['.vx-handover-card-time', '.vx-handover-footlink']) {
    const rule = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(source);
    assert.ok(rule, `Regel ${selector} nicht gefunden`);
    assert.ok(META_SOURCES.test(rule[1]),
      `Heute-Screen zieht die ruhige Textfarbe nicht mehr aus dem Token: ${selector}`);
  }
  for (const alias of [
    '--vx-ui-row-time-color: var(--vx-ui-meta-color);',
    '--vx-ui-section-label-color: var(--vx-ui-meta-color);',
    '--vx-ui-section-count-color: var(--vx-ui-meta-color);',
    '--vx-ui-row-desc-color: var(--vx-ui-text-secondary);',
    '--vx-ui-row-icon-color: var(--vx-ui-icon-quiet);'
  ]) assert.ok(tokens.includes(alias), 'Anfragen-Token hängt nicht mehr am gemeinsamen Wert: ' + alias);

  // Zeilen-Avatare: Night + Gold, EIN Token-Paar für Heute und Anfragen
  // (Angleichung an das Detail-Panel aus #848, 2026-08-08). Löst die frühere
  // "ruhiges Icon"-Invariante ab: die Karten trugen bis dahin bewusst den
  // stillen grauen Kreis, damit Farbe in der Zeile allein den Badges gehört.
  // Der neue Vertrag kehrt das um — das Icon selbst wird zur Marken-Signatur,
  // deshalb gilt er unconditional: kein Zustand (gelesen/ungelesen, needs/
  // resolved, is-call) darf die Avatar-Farbe abweichen lassen, sonst trägt
  // Gold wieder zwei Bedeutungen neben der Lead-Qualitäts-Rampe.
  {
    const AVATAR_BG = /background:var\(--vx-ui-list-avatar-bg\)/;
    const AVATAR_FG = /color:var\(--vx-ui-list-avatar-color\)/;
    for (const selector of [
      '.vx-handover-card-icon',
      'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-icon',
      'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-icon.is-call'
    ]) {
      const escaped = selector.replace(/[.#]/g, '\\$&');
      const rule = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
      assert.ok(rule, `Regel ${selector} nicht gefunden`);
      assert.ok(AVATAR_BG.test(rule[1]) && AVATAR_FG.test(rule[1]),
        `Zeilen-Avatar zieht Night+Gold nicht mehr aus dem gemeinsamen Token: ${selector}`);
    }
    for (const alias of [
      '--vx-ui-list-avatar-bg: var(--vx-color-night, #0D1F3C);',
      '--vx-ui-list-avatar-color: var(--vx-color-gold);'
    ]) assert.ok(tokens.includes(alias), 'Avatar-Token fehlt oder hängt nicht mehr an der Basisfarbe: ' + alias);

    // Die alte ruhige Icon-Farbe darf für den Avatar-Kreis nicht zurückkehren
    // — nur die separate Aktions-Icon-Rolle (Anrufen/Mehr) darf sie noch
    // tragen, die ist hier nicht Gegenstand der Prüfung.
    for (const selector of ['.vx-handover-card-icon', 'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-icon']) {
      const escaped = selector.replace(/[.#]/g, '\\$&');
      const rule = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
      assert.ok(!/var\(--vx-ui-row-icon-(?:bg|color)\)/.test(rule[1]),
        `Zeilen-Avatar hängt noch am alten ruhigen Icon-Token statt am Avatar-Token: ${selector}`);
    }
  }

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

  // Die Lara-Nachricht lag bis 2026-08-08 auf einer getönten Fläche
  // (#EEF1F6), auf der --vx-ui-meta-color nur 4.27:1 erreichte — die
  // Signatur musste deshalb in die dunklere Sekundär-Rolle ausweichen. Seit
  // die Nachricht eine gewöhnliche weisse Karte ist, entfällt die Ausnahme;
  // kehrt die Tönung zurück, muss auch die Ausnahme zurückkehren.
  {
    const rule = /\.vx-lara-bubble\s*\{([^}]*)\}/.exec(source);
    assert.ok(rule, '.vx-lara-bubble-Regel nicht gefunden');
    assert.ok(/background:var\(--vx-ui-row-bg\)/.test(rule[1]),
      'die Lara-Nachricht trägt wieder eine eigene Fläche statt der Kartenfarbe — '
      + 'dann greift der Kontrastwert der Signatur nicht mehr');
  }

  for (const [label, fg, bg] of [
    ['Meta auf Karte', meta, CARD],
    ['Meta auf Canvas', meta, CANVAS],
    ['Meta in der Zähler-Pille', meta, countBg],
    ['Sekundärtext auf Karte', secondary, CARD],
    ['Lara-Signatur auf der Karte', meta, CARD]
  ]) {
    const measured = ratio(fg, bg);
    assert.ok(measured >= 4.5,
      `${label}: ${fg} auf ${bg} erreicht nur ${measured.toFixed(2)}:1 — WCAG AA verlangt 4.5:1`);
  }

  // Die Hierarchie muss lesbar bleiben: Meta sichtbar leichter als Fliesstext.
  assert.ok(luminance(meta) > luminance(secondary) * 1.25,
    'ruhige Textfarbe ist so dunkel geworden, dass sie sich nicht mehr vom Sekundärtext abhebt');

  // Nicht-Text (Icons) trägt die 3:1-Schwelle — auf allen vier Flächen, auf
  // denen diese Icons tatsächlich sitzen.
  const icon = value('--vx-ui-icon-quiet');
  const ICON_CIRCLE = value('--vx-ui-row-icon-bg');
  const FIELD = value('--vx-color-surface-soft');
  for (const [label, bg] of [
    ['Icon-Kreis', ICON_CIRCLE],
    ['Suchfeld', FIELD],
    ['Karte', CARD],
    ['Canvas', CANVAS]
  ]) {
    const measured = ratio(icon, bg);
    assert.ok(measured >= 3,
      `Ruhiges Icon auf ${label}: ${icon} auf ${bg} erreicht nur ${measured.toFixed(2)}:1 — WCAG verlangt 3:1 für Nicht-Text`);
  }

  // Icons dürfen leichter sein als Text, aber nicht dunkler — sonst zieht das
  // Beiwerk mehr Aufmerksamkeit als der Inhalt daneben.
  assert.ok(luminance(icon) > luminance(meta),
    'ruhige Icon-Farbe ist dunkler als die Meta-Textfarbe geworden');

  // Gold-auf-Night-Avatar: dieselbe Paarung wie die Initialen im Detail-
  // Panel (#848 nennt dort 8.9:1). Symbolschwelle 3:1, da das Icon selbst
  // Nicht-Text ist.
  {
    const night = value('--vx-color-night');
    const gold = value('--vx-color-gold');
    const measured = ratio(gold, night);
    assert.ok(measured >= 3,
      `Gold-Avatar-Icon auf Night: ${gold} auf ${night} erreicht nur ${measured.toFixed(2)}:1 — WCAG verlangt 3:1 für Nicht-Text`);
  }
}

// ── 6. Typo-Angleichung an das Detail-Panel (#848, 2026-08-08) ─────────────
// Titelgrösse und Meta-Gewicht wandern auf listen-eigene bzw. bereits
// geteilte Panel-Tokens — siehe docs/LISTEN_ANGLEICHUNG_DIAGNOSE_2026-08-08.md
// Teil B/C. Titel-FARBE und -GEWICHT bleiben bewusst am geteilten
// --vx-ui-row-title-* Satz (unverändert übertragbar, keine Kollateralwirkung
// auf das Panel oder den Audioplayer).
{
  const TOKENS = 'customer-dashboard/shared/customer-design-tokens.css';
  const tokens = fs.readFileSync(TOKENS, 'utf8');
  assert.match(tokens, /--vx-ui-list-title-size:\s*15px;/,
    'Listen-Titelgrösse ist nicht mehr 15px — Panel-Leiter wäre 15/13/12 statt 14/13/12');

  for (const selector of [
    'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-title',
    '.vx-handover-card-title'
  ]) {
    const escaped = selector.replace(/[.#]/g, '\\$&');
    const rule = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
    assert.ok(rule, `Regel ${selector} nicht gefunden`);
    assert.match(rule[1], /font-size:var\(--vx-ui-list-title-size\)/,
      `Zeilentitel zieht die Grösse nicht mehr aus dem Listen-Token: ${selector}`);
  }

  // Label/Meta 12px/600 aus dem Panel — Grösse bleibt am geteilten
  // --vx-ui-row-time-size, nur das Gewicht hebt sich von 400 auf 600.
  for (const selector of [
    'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-time',
    'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-company',
    'body.vx-customer-design-foundation .vx-requests-panel .vx-requests-meta',
    '.vx-handover-card-time'
  ]) {
    const escaped = selector.replace(/[.#]/g, '\\$&');
    const rule = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
    assert.ok(rule, `Regel ${selector} nicht gefunden`);
    assert.match(rule[1], /font-weight:var\(--vx-ui-section-label-weight\)/,
      `Meta-Text ist nicht auf das Panel-Gewicht (600) gehoben: ${selector}`);
  }

  // Beide Handover-Varianten (needs UND resolved) tragen jetzt denselben
  // Avatar — vorher hatte "resolved" gar kein Icon-Element.
  assert.match(source, /vx-handover-card--resolved[\s\S]{0,40}data-id[\s\S]{0,120}vx-handover-card-body[\s\S]{0,80}vx-handover-card-icon/,
    'die "resolved"-Handover-Karte hat wieder kein Avatar-Icon — Asymmetrie zu "needs" ist zurück');
}

console.log('Anfragen list row polish verification passed.');
