'use strict';

/**
 * Der Post-Call-Webhook darf den Lebenszyklus nicht zurueckdrehen.
 *
 * Der Bug: beide Payload-Builder in elevenlabs-post-call.js setzen
 * dashboard_status bedingungslos auf 'new'. Fuer einen frisch angelegten
 * Datensatz ist das richtig. Auf einem bereits vorhandenen Datensatz holt es
 * einen Eintrag zurueck in den Posteingang, den jemand laengst bearbeitet,
 * geplant, abgeschlossen oder archiviert hat.
 *
 * Das passiert in drei Konstellationen, nicht nur bei doppelter Zustellung:
 *   1. ElevenLabs stellt denselben Webhook erneut zu (Retry, manuelle
 *      Wiederholung) und findet den Datensatz ueber die conversation_id.
 *   2. Der Polling-Zweig schreibt WAEHREND EINES LAUFS bis zu fuenf weitere
 *      Updates auf denselben Datensatz.
 *   3. Der Tool-Call-Pfad trifft einen Datensatz, den der Post-Call-Pfad
 *      bereits angelegt hat.
 *
 * Diese Tests fixieren beide Seiten: die Entscheidungslogik als
 * Verhaltenstest, und als Quelltext-Contract, dass keine Schreibstelle auf
 * einem gematchten Datensatz an der Absicherung vorbeischreibt.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FUNCTION_PATH = path.join(
  __dirname, '..', 'netlify', 'functions', 'elevenlabs-post-call.js'
);
const source = fs.readFileSync(FUNCTION_PATH, 'utf8');

// Die Helfer werden einzeln herausgeschnitten und echt ausgefuehrt. Die
// Function selbst laesst sich nicht laden: sie zieht @supabase/supabase-js und
// liest Env-Variablen beim Import.
function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, 'Funktion nicht gefunden: ' + name);
  let depth = 0;
  let seenBody = false;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seenBody = true; continue; }
    if (ch === '}') {
      depth--;
      if (seenBody && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('Funktion nicht terminiert: ' + name);
}

function loadGuards() {
  const constMatch = /const LIFECYCLE_ADVANCED_STATUSES = new Set\(\[[\s\S]*?\]\);/.exec(source);
  assert.ok(constMatch, 'LIFECYCLE_ADVANCED_STATUSES nicht gefunden');
  const sandbox = { console: { log() {} }, module: {}, exports: {} };
  const context = vm.createContext(sandbox);
  vm.runInContext(
    constMatch[0] + '\n' +
    extractFunction('stripDashboardStatus') + '\n' +
    extractFunction('withoutStatusDowngrade') + '\n',
    context
  );
  return context;
}

function guard(currentStatus, payload) {
  const context = loadGuards();
  context.__payload = payload || { call_summary: 'Text', dashboard_status: 'new', updated_at: 'x' };
  context.__status = currentStatus;
  return vm.runInContext('withoutStatusDowngrade(__payload, __status)', context);
}

// ── 1. Die Entscheidung selbst ──────────────────────────────────────────────

test('ein abgeschlossener Eintrag wird nicht zurueck in den Posteingang geholt', () => {
  const result = guard('closed');
  assert.ok(!('dashboard_status' in result), 'dashboard_status haette entfallen muessen');
  assert.equal(result.call_summary, 'Text', 'Inhaltsfelder muessen weiter geschrieben werden');
  assert.equal(result.updated_at, 'x');
});

test('geplant, in Bearbeitung und archiviert sind ebenso geschuetzt', () => {
  for (const status of ['in_progress', 'follow_up_scheduled', 'archived']) {
    assert.ok(!('dashboard_status' in guard(status)), 'nicht geschuetzt: ' + status);
  }
});

test('ein noch unbearbeiteter Eintrag darf weiter auf new gesetzt werden', () => {
  assert.equal(guard('new').dashboard_status, 'new');
});

test('unbekannter oder leerer Status aendert das Bestandsverhalten nicht', () => {
  for (const status of [null, undefined, '', '   ', 'irgendwas']) {
    assert.equal(guard(status).dashboard_status, 'new',
      'unerwartet unterdrueckt bei: ' + JSON.stringify(status));
  }
});

test('Grossschreibung und Leerzeichen im Status greifen trotzdem', () => {
  // dashboard_status ist ein freies text-Feld mit CHECK; defensiv normalisieren.
  for (const status of ['CLOSED', ' Closed ', 'Archived']) {
    assert.ok(!('dashboard_status' in guard(status)), 'nicht erkannt: ' + JSON.stringify(status));
  }
});

test('der Patch wird nicht in place veraendert', () => {
  const context = loadGuards();
  context.__payload = { call_summary: 'Text', dashboard_status: 'new' };
  context.__status = 'closed';
  const unchanged = vm.runInContext(
    'withoutStatusDowngrade(__payload, __status); __payload.dashboard_status', context
  );
  assert.equal(unchanged, 'new', 'der uebergebene Patch darf nicht mutiert werden');
});

test('ein Patch ohne dashboard_status bleibt unveraendert', () => {
  const context = loadGuards();
  context.__payload = { live_status: 'completed' };
  const result = vm.runInContext('stripDashboardStatus(__payload, "test")', context);
  assert.deepEqual(result, { live_status: 'completed' });
});

// ── 2. Keine Schreibstelle schreibt daran vorbei ────────────────────────────

// Alle UPDATEs auf public.calls — erkannt an einem from('calls') kurz davor,
// damit crypto.createHmac(...).update(...) nicht mitgezaehlt wird.
function callsTableUpdates() {
  const found = [];
  const re = /\.update\(/g;
  let m;
  while ((m = re.exec(source))) {
    const lookBehind = source.slice(Math.max(0, m.index - 300), m.index);
    if (!lookBehind.includes("from('calls')")) continue;
    found.push(source.slice(m.index, source.indexOf('\n', m.index)).trim());
  }
  return found;
}

test('jedes Update auf calls laeuft ueber die Absicherung oder schreibt keinen Status', () => {
  const updates = callsTableUpdates();
  assert.ok(updates.length >= 6,
    'zu wenige Update-Stellen gefunden (' + updates.length + ') — Pruefung greift ins Leere');
  for (const call of updates) {
    const ok =
      call.includes('withoutStatusDowngrade(') ||
      call.includes('stripDashboardStatus(') ||
      // Inline-Patches, die den Lebenszyklus gar nicht anfassen.
      (call.includes('{') && !call.includes('dashboard_status')) ||
      // abortPayload setzt nur live_status/duration — siehe eigener Test unten.
      call.includes('abortPayload');
    assert.ok(ok, 'Update-Stelle ohne Lebenszyklus-Absicherung: ' + call);
  }
});

test('der Abbruch-Pfad fasst den Lebenszyklus nicht an', () => {
  // Deshalb duerfen seine Match-Selects den Status auch nicht mitlesen muessen.
  const abort = /const abortPayload = \{[\s\S]*?\};/.exec(source);
  assert.ok(abort, 'abortPayload nicht gefunden');
  assert.ok(!abort[0].includes('dashboard_status'),
    'der Abbruch-Pfad schreibt jetzt dashboard_status und braucht dieselbe Absicherung');
});

test('das Polling schreibt den Status gar nicht mehr', () => {
  // Waehrend eines Laufs schreibt der Polling-Zweig bis zu fuenf Updates. Ueber
  // den Status hat der Lauf beim Initial-Update bzw. Insert entschieden.
  assert.match(source, /\.update\(stripDashboardStatus\(polledPayload, 'polling_progress_update'\)\)/);
});

test('jeder Match, der danach den Status schreibt, liest ihn vorher mit', () => {
  // Fuenf Stellen suchen den Datensatz fuer ein statusschreibendes Update:
  // Tool-Call-Pfad (conv_id, phone_match) und Haupt-Pfad (conv_id,
  // twilio_call_sid, twilio_stub). Alle muessen dashboard_status mitlesen.
  const withStatus = source.match(/\.select\('id,[^']*dashboard_status'\)/g) || [];
  assert.equal(withStatus.length, 5,
    'erwartet: 5 Match-Selects mit dashboard_status — gefunden: ' + withStatus.length +
    ' (' + withStatus.join(' | ') + ')');
  // Jede echte Zuweisung von matchedStatus stammt aus so einem Datensatz.
  // Sechs Stueck: der Stub-Match hat zwei Zweige (eindeutig / mehrdeutig) auf
  // demselben Select. Die zwei `= null`-Deklarationen zaehlen nicht mit.
  const assignments = (source.match(/matchedStatus = [^;]+;/g) || [])
    .filter((a) => !/= null;$/.test(a));
  assert.equal(assignments.length, 6,
    'erwartet: 6 Zuweisungen an matchedStatus — gefunden: ' + assignments.length +
    ' (' + assignments.join(' | ') + ')');
  for (const a of assignments) {
    assert.match(a, /\.dashboard_status;$/, 'matchedStatus kommt nicht aus dem Datensatz: ' + a);
  }
});

test('neu angelegte Datensaetze bekommen weiterhin new', () => {
  // Beide Insert-Pfade uebernehmen updatePayload unveraendert — dort ist
  // dashboard_status = 'new' korrekt.
  const inserts = source.match(/\.insert\(\{[\s\S]*?\}\)/g) || [];
  assert.ok(inserts.length >= 1, 'Insert-Pfad nicht gefunden');
  assert.match(source, /const insertPayload = \{[\s\S]*?\.\.\.updatePayload[\s\S]*?\};/,
    'der Fallback-Insert uebernimmt updatePayload nicht mehr');
  assert.ok(!/\.insert\([\s\S]{0,400}?withoutStatusDowngrade/.test(source),
    'ein Insert laeuft faelschlich ueber die Downgrade-Absicherung');
});

test('die geschuetzten Status decken die CHECK-Constraint ab', () => {
  // calls_dashboard_status_check erlaubt: new, in_progress, follow_up_scheduled,
  // closed, archived. Geschuetzt gehoert alles ausser 'new'.
  const setMatch = /const LIFECYCLE_ADVANCED_STATUSES = new Set\(\[([\s\S]*?)\]\);/.exec(source);
  assert.ok(setMatch, 'Set nicht gefunden');
  const listed = (setMatch[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, ''));
  assert.deepEqual(
    listed.slice().sort(),
    ['archived', 'closed', 'follow_up_scheduled', 'in_progress'],
    'die geschuetzten Status weichen von der CHECK-Constraint ab'
  );
});
