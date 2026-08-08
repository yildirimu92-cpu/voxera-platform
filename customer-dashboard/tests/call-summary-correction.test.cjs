'use strict';

/**
 * Etappe 4 Teil B / Feature 3 — Kundenkorrektur der KI-Zusammenfassung.
 *
 * Die Regressionsgefahr hier ist nicht "der Text sieht falsch aus", sondern:
 *
 *   1. Die Korrektur landet doch wieder in call_summary. Diese Spalte gehoert
 *      dem Post-Call-Webhook; ein verspaeteter oder wiederholter Aufruf wuerde
 *      die Korrektur still ueberschreiben und den Eintrag zusaetzlich auf
 *      dashboard_status = 'new' zuruecksetzen.
 *   2. Das Original geht verloren — dann ist nicht mehr nachvollziehbar, was
 *      die KI verstanden hat.
 *   3. Die Korrektur gilt nur im Detail, waehrend Liste und Heute weiter den
 *      Text zeigen, den der Kunde gerade weggeraeumt hat.
 *   4. Eine Kundeneingabe laesst einen noch nicht ausgewerteten Anruf als
 *      ausgewertet erscheinen ("Wird ausgewertet" verschwindet zu frueh).
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const viewModel = require('../shared/customer-call-view-model.js');
const correctionFn = fs.readFileSync(
  path.join(ROOT, 'netlify', 'functions', 'call-save-summary-correction.js'),
  'utf8'
);
const migration = fs.readFileSync(
  path.join(ROOT, '..', 'supabase', 'sql', '2026-08-08_call_summary_correction.sql'),
  'utf8'
);

// ── Quelltext-Zugriff ───────────────────────────────────────────────────────

function extractScriptBlock(id) {
  const open = dashboard.indexOf('<script id="' + id + '">');
  assert.notEqual(open, -1, 'script block not found: ' + id);
  const bodyStart = dashboard.indexOf('>', open) + 1;
  const end = dashboard.indexOf('</script>', bodyStart);
  assert.notEqual(end, -1, 'unterminated script block: ' + id);
  return dashboard.slice(bodyStart, end);
}

// Die Getter liegen in einem der grossen, id-losen Script-Bloecke. Sie werden
// deshalb einzeln ueber Klammerzaehlung herausgeschnitten, statt den ganzen
// Block auszufuehren.
function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = dashboard.indexOf(marker);
  assert.notEqual(start, -1, 'function not found: ' + name);
  let depth = 0;
  let seenBody = false;
  for (let i = dashboard.indexOf('{', start); i < dashboard.length; i++) {
    const ch = dashboard[i];
    if (ch === '{') { depth++; seenBody = true; continue; }
    if (ch === '}') {
      depth--;
      if (seenBody && depth === 0) return dashboard.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function: ' + name);
}

// ── Sandbox mit der echten Detailkomponente ─────────────────────────────────

function loadDetailComponent() {
  const windowStub = {};
  const sandbox = {
    window: windowStub,
    document: {
      // Die Komponente fasst das DOM beim Laden nicht an; die Stubs decken nur
      // die Aufrufe ab, die beim Bauen des Bodys entstehen koennten.
      getElementById() { return null; },
      querySelector() { return null; }
    },
    console
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);

  // Erst die beiden Getter, damit die Komponente die echte Schluesselkette
  // benutzt und nicht ihren internen Rueckfall.
  for (const name of ['vxGetCallSummary', 'vxGetCallSummaryOriginal', 'vxHasCallSummaryCorrection']) {
    const source = extractFunction(name);
    vm.runInContext(source + '\nwindow.' + name + ' = ' + name + ';', context);
  }
  vm.runInContext(extractScriptBlock('vx-entry-detail-component'), context);
  return { window: windowStub, context };
}

function bodyHtmlFor(fields) {
  const { window: win } = loadDetailComponent();
  assert.equal(typeof win.vxRenderDetailBodyHtml, 'function', 'vxRenderDetailBodyHtml fehlt');
  return win.vxRenderDetailBodyHtml({ id: 'call_1', fields: Object.assign({}, fields) });
}

// ── 1. Die Korrektur gewinnt, ueberall ──────────────────────────────────────

test('vxGetCallSummary bevorzugt die Korrektur, vxGetCallSummaryOriginal nicht', () => {
  const { context } = loadDetailComponent();
  const record = {
    call_summary: 'Anrufer will einen Termin am Montag.',
    call_summary_corrected: 'Anrufer will einen Termin am Dienstag, 14 Uhr.'
  };
  vm.runInContext('globalThis.__rec = ' + JSON.stringify(record) + ';', context);

  assert.equal(
    vm.runInContext('vxGetCallSummary(__rec)', context),
    'Anrufer will einen Termin am Dienstag, 14 Uhr.'
  );
  assert.equal(
    vm.runInContext('vxGetCallSummaryOriginal(__rec)', context),
    'Anrufer will einen Termin am Montag.',
    'das Original muss erreichbar bleiben, sonst ist die KI-Ausgabe verloren'
  );
  assert.equal(vm.runInContext('vxHasCallSummaryCorrection(__rec)', context), true);
});

test('ohne Korrektur bleibt die KI-Ausgabe unveraendert die Quelle', () => {
  const { context } = loadDetailComponent();
  vm.runInContext('globalThis.__rec = { call_summary: "Rueckruf erbeten." };', context);
  assert.equal(vm.runInContext('vxGetCallSummary(__rec)', context), 'Rueckruf erbeten.');
  assert.equal(vm.runInContext('vxHasCallSummaryCorrection(__rec)', context), false);
});

test('eine leere Korrektur zaehlt nicht als Korrektur', () => {
  const { context } = loadDetailComponent();
  vm.runInContext('globalThis.__rec = { call_summary: "A", call_summary_corrected: "   " };', context);
  assert.equal(vm.runInContext('vxGetCallSummary(__rec)', context), 'A');
  assert.equal(vm.runInContext('vxHasCallSummaryCorrection(__rec)', context), false);
});

test('das View-Model der Liste zieht die Korrektur vor die Kurzfassung', () => {
  assert.equal(
    viewModel.build({ id: 'c1', call_summary_short: 'Termin', call_summary_corrected: 'Termin Dienstag 14 Uhr' }).summary,
    'Termin Dienstag 14 Uhr',
    'sonst zeigt die Liste weiter den Text, den der Kunde gerade korrigiert hat'
  );
  assert.equal(
    viewModel.build({ id: 'c2', call_summary_short: 'Termin' }).summary,
    'Termin'
  );
});

test('eine Kundenkorrektur macht einen unausgewerteten Anruf nicht ausgewertet', () => {
  // isAnalysisPending haengt bewusst an der KI-Ausgabe. Sonst wuerde eine
  // Kundeneingabe den Zustand "Wird ausgewertet" vorzeitig aufloesen.
  assert.equal(
    viewModel.lifecycle({
      live_status: 'completed',
      elevenlabs_conversation_id: 'conv_1',
      call_summary_corrected: 'Von Hand erfasst'
    }),
    'analysing'
  );
});

// ── 2. Die Anliegen-Karte ───────────────────────────────────────────────────

test('ohne Korrektur zeigt die Karte "Automatisch erstellt" und bietet Korrigieren an', () => {
  const html = bodyHtmlFor({ call_summary: 'Anrufer fragt nach einer Offerte.' });
  assert.match(html, /Automatisch erstellt/);
  assert.match(html, /Anrufer fragt nach einer Offerte\./);
  assert.match(html, />Korrigieren</);
  assert.ok(!html.includes('Original ansehen'), 'ohne Korrektur gibt es kein Original zum Vergleichen');
  assert.ok(!html.includes('Korrektur entfernen'), 'ohne Korrektur gibt es nichts zu entfernen');
});

test('mit Korrektur zeigt die Karte den Kundentext und haelt das Original bereit', () => {
  const html = bodyHtmlFor({
    call_summary: 'Anrufer will Termin am Montag.',
    call_summary_corrected: 'Anrufer will Termin am Dienstag.',
    call_summary_corrected_at: '2026-08-08T12:00:00Z'
  });
  assert.match(html, /Von dir korrigiert/);
  assert.match(html, /Anrufer will Termin am Dienstag\./);
  assert.match(html, /Original ansehen/);
  assert.match(html, /Anrufer will Termin am Montag\./, 'das Original fehlt im Aufklapper');
  assert.match(html, /Korrektur bearbeiten/);
  assert.match(html, /Korrektur entfernen/);
  assert.ok(!html.includes('Automatisch erstellt'), 'der Metatext muss den korrigierten Zustand tragen');
});

test('ohne jede Zusammenfassung bietet die Karte das Ergaenzen an', () => {
  const html = bodyHtmlFor({ caller_name: 'Frau Meier' });
  assert.match(html, /Keine Zusammenfassung verfügbar\./);
  assert.match(html, /Zusammenfassung ergänzen/);
});

test('die Karte ist kein Modal und wird inline bearbeitet', () => {
  const html = bodyHtmlFor({ call_summary: 'Text' });
  assert.match(html, /id="vx-dv2-concern-input"/, 'die Bearbeitung laeuft inline in der Karte');
  assert.match(html, /class="vx-dv2-concern-edit" hidden/, 'der Bearbeitungsblock startet geschlossen');
  assert.ok(!/vx-modal|openConfirmModal|role="dialog"/.test(html), 'die Korrektur darf keinen neuen Dialog aufmachen');
});

test('Kundentext wird escaped, auch im Original und in der Textarea', () => {
  const html = bodyHtmlFor({
    call_summary: '<img src=x onerror=alert(1)>',
    call_summary_corrected: '<script>alert("xss")<\/script>'
  });
  assert.ok(!html.includes('<script>alert('), 'die Korrektur wird ungeschuetzt ausgegeben');
  assert.ok(!html.includes('<img src=x'), 'das Original wird ungeschuetzt ausgegeben');
  assert.match(html, /&lt;script&gt;/);
});

test('die Karte traegt den Hook, ueber den sie sich neu zeichnet', () => {
  // Ohne diesen Hook faende das Neuzeichnen nach dem Speichern die Karte
  // nicht und die Ansicht bliebe auf dem alten Stand stehen.
  assert.match(dashboard, /data-vx-concern-card="1"/);
  const hooks = dashboard.match(/data-vx-concern-card/g) || [];
  assert.equal(hooks.length, 2, 'Hook erwartet: Markup und Selektor, sonst nichts — gefunden: ' + hooks.length);
});

test('Erstaufbau und Neuzeichnen benutzen dieselbe Baufunktion', () => {
  const builds = dashboard.match(/buildConcernCardInnerHtml\(/g) || [];
  assert.equal(builds.length, 3,
    'erwartet: Deklaration + Erstaufbau + Neuzeichnen. Jede weitere Stelle ist ein zweites Markup der Karte.');
});

// ── 3. Der Schreibpfad ──────────────────────────────────────────────────────

test('die Function fasst call_summary und den Lebenszyklus nicht an', () => {
  // Kommentare duerfen die Spalten benennen — geprueft wird der Code.
  const code = correctionFn.replace(/^\s*\/\/.*$/gm, '');
  const patch = /const patch = \{[\s\S]*?\};/.exec(code);
  assert.ok(patch, 'Patch-Objekt nicht gefunden');
  assert.ok(!/\bcall_summary\b\s*:/.test(patch[0]),
    'die Function schreibt call_summary — der Post-Call-Webhook wuerde die Korrektur ueberschreiben');
  assert.ok(!/dashboard_status/.test(code),
    'eine Textkorrektur darf keinen Statusuebergang ausloesen');
  assert.ok(!/follow_up_at/.test(code));
});

test('die Function prueft Ownership vor dem Schreiben mit Service-Role', () => {
  assert.match(correctionFn, /requireCustomerCaller/);
  assert.match(correctionFn, /String\(callRow\.customer_id\) !== caller\.customerId/);
  assert.match(correctionFn, /\.eq\('customer_id', caller\.customerId\)/,
    'das UPDATE muss zusaetzlich auf den Mandanten eingegrenzt sein');
});

test('Zeitstempel und Urheber kommen vom Server, nicht aus dem Browser', () => {
  assert.match(correctionFn, /call_summary_corrected_by: isReset \? null : caller\.userId/);
  assert.match(correctionFn, /call_summary_corrected_at: isReset \? null : nowIso/);
});

test('das Zuruecknehmen leert alle drei Spalten gemeinsam', () => {
  // Sonst bliebe ein Zeitstempel ohne Text stehen und die Karte zeigte
  // "Von dir korrigiert" ohne Korrektur.
  assert.match(correctionFn, /call_summary_corrected: isReset \? null : corrected/);
  assert.match(correctionFn, /const isReset = corrected === '';/);
});

test('die Migration legt die drei Spalten an und erweitert kein Schreibrecht', () => {
  for (const column of ['call_summary_corrected', 'call_summary_corrected_at', 'call_summary_corrected_by']) {
    assert.match(migration, new RegExp('ADD COLUMN IF NOT EXISTS ' + column + '\\b'));
  }
  assert.ok(!/grant\s+update/i.test(migration),
    'die neuen Spalten duerfen nicht in das spaltengenaue UPDATE-Recht von authenticated wandern');
  assert.ok(!/ALTER TABLE public\.calls[\s\S]*?\bcall_summary\b\s+(?:type|drop|set)/i.test(migration),
    'call_summary selbst wird nicht angefasst');
});
