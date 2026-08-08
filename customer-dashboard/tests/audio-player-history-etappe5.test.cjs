'use strict';

/**
 * Etappe 5 — Anfrage-Detail: Player (Richtung B "Night-Konsole") und
 * Verlauf (V2 "Kontaktzeilen").
 * Konzept und Begruendung: docs/ETAPPE_5_PLAYER_VERLAUF_EXPLORATION_2026-08-08.html
 *
 * Drei der Befunde waren keine Geschmacksfragen, und genau die sichern die
 * Tests hier ab, damit sie nicht zurueckkommen:
 *
 *   1. Die Zierwellenform hob ueber nth-child(-n+15) 15 von 42 Balken
 *      dauerhaft hervor und las sich damit als konstante "36 % abgespielt"-
 *      Anzeige — auf einer nie gestarteten Aufnahme.
 *   2. "Bereit zum Abspielen" stand zweimal auf derselben Flaeche und die
 *      beiden Stellen liefen beim Tempo-Wechsel auseinander.
 *   3. Der Aufklapper "Verlauf" trug zwei Zaehlungen mit verschiedener
 *      Definition: die Kopfzeile rechnete den offenen Eintrag heraus, die
 *      Karte darin zaehlte ihn mit.
 *
 * Dazu die Gold-Regel aus PR #848 in ihrer Etappe-5-Fassung: Gold markiert
 * eine Stelle, Gold fuellt keine Menge.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const tokens = fs.readFileSync(path.join(ROOT, 'shared', 'customer-design-tokens.css'), 'utf8');

function rule(selector, source = dashboard) {
  const escaped = selector.replace(/[.#[\]="-]/g, '\\$&');
  const m = new RegExp(`(^|[,}\\s])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(source);
  assert.ok(m, `Regel nicht gefunden: ${selector}`);
  return m[2];
}

function extractFunction(name, source = dashboard) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' nicht in index.html gefunden');
  let depth = 0;
  let seen = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') { depth += 1; seen = true; }
    else if (char === '}') {
      depth -= 1;
      if (seen && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unterminierte Funktion: ' + name);
}

/* ── 1. Die Gold-Regel ──────────────────────────────────────────────────── */

test('die Standing Rule "markieren, nicht fuellen" steht beim Marken-Gold', () => {
  assert.match(tokens, /markieren, nicht füllen|markieren, nicht fuellen/,
    'die Regel muss beim ornamentalen Gold dokumentiert sein, nicht nur im Konzeptdokument');
  assert.match(tokens, /--vx-ui-brand-playhead:\s*var\(--vx-color-gold\);/,
    'der Abspielkopf braucht ein benanntes Token statt eines verstreuten Literals');
});

test('Gold markiert den Abspielkopf und fuellt NICHT den Fortschritt', () => {
  const playhead = rule('.vx-audio-modern__playhead');
  assert.match(playhead, /var\(--vx-ui-brand-playhead/,
    'der Abspielkopf ist der zugelassene Gold-Ort in der Spur');

  // Der abgespielte Teil ist eine Menge. Traegt er Gold, konkurriert er mit
  // der Lead-Rampe, und Gold haette wieder zwei Bedeutungen.
  const base = rule('.vx-audio-modern');
  const played = /--vx-audio-played:\s*([^;]+);/.exec(base);
  assert.ok(played, '--vx-audio-played muss auf der Player-Wurzel definiert sein');
  assert.doesNotMatch(played[1], /gold|E8C547/i,
    'der abgespielte Teil der Spur darf kein Gold tragen — er ist eine Menge');

  for (const selector of ['.vx-audio-modern__bars--played span', '.vx-audio-modern__plain']) {
    assert.doesNotMatch(rule(selector), /brand-playhead|brand-initials|E8C547/i,
      `${selector} fuellt eine Menge und darf deshalb kein Gold tragen`);
  }
});

/* ── 2. Befund 1: die Wellenform luegt nicht mehr ───────────────────────── */

test('kein konstant hervorgehobener Balkenanteil mehr', () => {
  assert.doesNotMatch(dashboard, /vx-audio-modern__wave\s+span:nth-child/,
    'ein fester nth-child-Anteil liest sich als Fortschritt, der sich nie bewegt');
});

test('der Fortschritt kommt aus einer Variablen, die die Wiedergabe schreibt', () => {
  assert.match(rule('.vx-audio-modern__plain::after'), /width:var\(--vx-audio-progress\)/);
  assert.match(rule('.vx-audio-modern__bars--played'), /clip-path:inset\(0 calc\(100% - var\(--vx-audio-progress\)\)/);
  assert.match(rule('.vx-audio-modern__playhead'), /left:var\(--vx-audio-progress\)/);
  assert.match(dashboard, /setProperty\('--vx-audio-progress'/,
    'syncProgress muss die Variable tatsaechlich setzen');
});

test('ohne echte Amplituden steht eine glatte Leiste, keine erfundene Wellenform', () => {
  const markup = extractFunction('vxRenderModernAudioPlayerHtml');
  assert.match(markup, /vx-audio-modern__plain/,
    'der Ausgangszustand ist der neutrale Platzhalter');
  assert.doesNotMatch(markup, /for \(var i = 0; i < \d+; i\+\+\)/,
    'im Markup darf keine Balkenfolge mehr erzeugt werden — Balken entstehen nur aus decodeAudioData');
  assert.match(dashboard, /decodeAudioData/,
    'echte Amplituden kommen aus der Datei, nicht aus einer Formel');
});

/* ── 3. Befund 2: der Zustand steht nur noch einmal ─────────────────────── */

test('kein zweiter Statustext und kein Lautstaerkeregler mehr', () => {
  const markup = extractFunction('vxRenderModernAudioPlayerHtml');
  assert.doesNotMatch(markup, /data-vx-audio-status/,
    'der zweite Statusknoten war die Quelle der widerspruechlichen Anzeige');
  assert.doesNotMatch(markup, /data-vx-audio-volume/,
    'die Systemlautstaerke wird nicht dupliziert');
  assert.equal((markup.match(/data-vx-audio-note/g) || []).length, 1,
    'es gibt genau einen Ort fuer Notizen/Ausnahmen');
});

test('keine Textglyphen mehr in der Bedienung', () => {
  const markup = extractFunction('vxRenderModernAudioPlayerHtml');
  for (const glyph of ['▶', 'Ⅱ', '↺', '↻', '⌁']) {
    assert.ok(!markup.includes(glyph), `Textglyphe ${glyph} rendert je Geraet anders`);
  }
  assert.match(markup, /<svg/, 'Play/Pause und die Spruenge liegen als SVG vor');
});

test('die Spruenge nennen ihre Weite und sind 15 Sekunden', () => {
  const markup = extractFunction('vxRenderModernAudioPlayerHtml');
  assert.match(markup, /aria-label="15 Sekunden zurück"/);
  assert.match(markup, /aria-label="15 Sekunden vor"/);
  assert.match(dashboard, /var SKIP_SECONDS = 15;/);
});

/* ── 3b. Der Fokusring des Reglers ueberlebt seine Unsichtbarkeit ───────── */

test('der Seek-Regler wird nicht per opacity ausgeblendet', () => {
  // opacity wirkt auf den gesamten Teilbaum inklusive der eigenen outline.
  // Ein opacity:.01 auf dem Regler blendet damit auch den Fokusring auf 1 %
  // herunter — auf dem Night-Block praktisch unsichtbar.
  const decl = rule('.vx-audio-modern__range');
  assert.doesNotMatch(decl, /opacity\s*:/,
    'der Regler muss ueber transparente Bahn/Griff unsichtbar werden, nicht ueber opacity');
  assert.match(decl, /background:transparent/);
  assert.match(rule('.vx-audio-modern__range::-webkit-slider-thumb'), /background:transparent/);
  assert.match(rule('.vx-audio-modern__range::-moz-range-thumb'), /background:transparent/);
});

test('Knopf, Werkzeuge und Regler haben einen sichtbaren Fokuszustand', () => {
  // Seit der Umstellung auf die helle Karte ist der Ring Night statt weiss,
  // und der Knopf hat eine eigene Regel, weil seine Night-Kontur ein
  // box-shadow ist, das ein pauschales box-shadow:none abraeumen wuerde.
  for (const part of ['__play', '__tool', '__range']) {
    const selector = '.vx-audio-modern' + part + ':focus-visible';
    const idx = dashboard.indexOf(selector);
    assert.notEqual(idx, -1, selector + ' fehlt');
    const block = dashboard.slice(idx, dashboard.indexOf('}', idx));
    assert.match(block, /outline:2px solid var\(--vx-color-night/,
      selector + ' braucht einen Ring, der auf der hellen Karte sichtbar ist');
  }
  // Die Night-Kontur des Knopfs darf im Fokus nicht verschwinden.
  const playFocus = dashboard.slice(dashboard.indexOf('.vx-audio-modern__play:focus-visible'));
  assert.match(playFocus.slice(0, playFocus.indexOf('}')), /box-shadow:inset 0 0 0 1\.5px/,
    'der Fokuszustand des Knopfs muss seine Kontur behalten');
});

test('Gold traegt auf der hellen Karte nirgends allein die Abgrenzung', () => {
  // Gold gegen Weiss steht bei 1,68:1. Wo Gold eine Flaeche oder Linie ist,
  // die man finden koennen muss, braucht sie eine dunkle Kante.
  assert.match(rule('.vx-audio-modern__play'), /box-shadow:inset 0 0 0 1\.5px var\(--vx-color-night/,
    'der Gold-Knopf braucht eine Night-Kontur, sonst ist er als Bedienelement randlos');
  assert.match(rule('.vx-audio-modern__playhead'), /box-shadow:0 0 0 1px rgba\(13,31,60/,
    'der Gold-Abspielkopf braucht eine dunkle Kante gegen den hellen Teil der Spur');
  // Gold als TEXT faellt auf Hell ganz aus.
  assert.doesNotMatch(rule('.vx-audio-modern__kicker'), /brand-initials|E8C547/,
    'das Etikett darf auf der hellen Karte nicht in Gold stehen (1,68:1)');
});

test('die helle Karte spricht die Kartensprache des Panels', () => {
  const base = rule('.vx-audio-modern');
  assert.match(base, /background:var\(--vx-ui-row-bg/);
  assert.match(base, /border:var\(--vx-ui-row-border-width\) solid var\(--vx-ui-row-border-color\)/);
  assert.doesNotMatch(base, /background:var\(--vx-color-night/,
    'der grosse Block ist nicht mehr dunkel');
  // Die kleinen Night-Kreise bleiben dagegen ausdruecklich dunkel.
  assert.match(rule('.vx-vl-icon--call'), /background:var\(--vx-color-night/,
    'der Anruf-Kreis im Verlauf bleibt Night mit Gold');
});

/* ── 4. Befund 3: eine Zaehlung im Verlauf ──────────────────────────────── */

function runTimeline(history, options) {
  const sandbox = {
    escapeHtml: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    parseCallTimestamp: (v) => new Date(v),
    formatTimeCH: () => '09:12',
    fmtDate: () => '12.07.2026',
    formatTaskDueLabel: () => 'morgen',
    vxFormatCategoryLabelSafe: (v) => String(v),
    Intl,
    Date,
    Number,
    Math,
    String,
    Array
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extractFunction('renderTimelineHTML'), sandbox);
  return sandbox.renderTimelineHTML(history, options);
}

const HISTORY = [
  { type: 'call_inbound', call_id: 'call-1', timestamp: '2026-08-08T07:12:00Z', duration: 134, summary: 'Fassadensanierung' },
  { type: 'call_inbound', call_id: 'call-2', timestamp: '2026-07-12T12:03:00Z', duration: 48, summary: 'Erstkontakt' },
  { type: 'task', task_id: 'task-1', timestamp: '2026-07-12T13:00:00Z', action: 'callback', status: 'closed', notes: 'Termin vereinbart' }
];

test('der Verlauf traegt keine zweite Zaehlung mehr', () => {
  const html = runTimeline(HISTORY, { currentId: 'call-1' });
  assert.doesNotMatch(html, /Ereignis/,
    'die Zaehlung gehoert allein in die Kopfzeile des Aufklappers');
  assert.doesNotMatch(html, /Kontakt-Historie/,
    'die zweite Ueberschrift neben "Verlauf" ist entfallen');
});

test('der offene Eintrag wird markiert statt mitgezaehlt', () => {
  const html = runTimeline(HISTORY, { currentId: 'call-1' });
  assert.equal((html.match(/Dieser Eintrag/g) || []).length, 1);
  assert.match(html, /vx-vl-row[^"]*is-current/);
  // ... und er ist nicht anklickbar, er steht ja bereits offen.
  const currentRow = /<div class="vx-vl-row[^"]*is-current"([^>]*)>/.exec(html);
  assert.ok(currentRow, 'die Zeile des offenen Eintrags muss existieren');
  assert.doesNotMatch(currentRow[1], /onclick/);
});

test('ohne currentId markiert der Verlauf nichts', () => {
  const html = runTimeline(HISTORY, {});
  assert.doesNotMatch(html, /Dieser Eintrag/);
});

test('Zusammenfassung und Notiz gehen escaped ins HTML', () => {
  const html = runTimeline([
    { type: 'call_inbound', call_id: 'x', timestamp: '2026-08-08T07:12:00Z', duration: 10,
      summary: '<img src=x onerror=alert(1)>' }
  ], {});
  assert.doesNotMatch(html, /<img/, 'die Zusammenfassung stammt aus Transkript-Auswertung');
  assert.match(html, /&lt;img/);
});

test('der Aufdeck-Knopf nennt nur, was er aufdeckt', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({
    type: 'call_inbound', call_id: 'c' + i, timestamp: '2026-07-12T12:00:00Z', duration: 30, summary: 's'
  }));
  const html = runTimeline(many, {});
  assert.match(html, /Weitere 4 anzeigen/,
    'eine absolute Gesamtzahl waere die zweite Zahl im selben Aufklapper');
});

test('vxDv2LoadHistory reicht den offenen Eintrag an den Renderer durch', () => {
  const loader = extractFunction('vxDv2LoadHistory');
  assert.match(loader, /renderTimelineHTML\(history,\s*\{\s*currentId:\s*currentId\s*\}\)/);
});

/* ── 5. Der Verlauf spricht die Zeilensprache, nicht mehr die alte ──────── */

test('keine Altwerte mehr im Verlauf', () => {
  const timeline = extractFunction('renderTimelineHTML');
  assert.doesNotMatch(timeline, /#1A6FE8/,
    'das Blau hat die Liste beim Neubau verlassen');
  assert.doesNotMatch(timeline, /text-transform:uppercase/,
    'Versalien mit Sperrung sind die Form, die PR #848 verlassen hat');
  assert.doesNotMatch(timeline, /var\(--slate\)|var\(--ink2?\)|var\(--surface2\)/,
    'Farben kommen aus --vx-ui-*, nicht aus der Alt-Variablengeneration');
});

test('die Verlaufszeile zieht dieselben Tokens wie die Anfragen-Zeile', () => {
  const row = rule('.vx-vl-row');
  assert.match(row, /var\(--vx-ui-row-padding\)/);
  assert.match(row, /var\(--vx-ui-row-radius\)/);
  assert.match(row, /var\(--vx-ui-row-border-color\)/);
  assert.match(rule('.vx-vl-title'), /var\(--vx-ui-list-title-size/);
});

/* ── 6. Mobil ───────────────────────────────────────────────────────────── */

test('der Night-Block hat eine eigene Regel fuer 430px', () => {
  const mobile = /@media\(max-width:430px\)\{([\s\S]*?vx-audio-modern[\s\S]*?)\n\}/.exec(dashboard);
  assert.ok(mobile, 'es muss eine 430px-Regel fuer den Player geben');
  assert.match(mobile[1], /flex-wrap:wrap/,
    'Zeit und Werkzeuge muessen umbrechen duerfen, statt sich zu ueberlagern');
});
