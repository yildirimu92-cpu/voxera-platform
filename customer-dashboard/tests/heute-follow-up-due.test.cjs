'use strict';

/**
 * Regression test: fällige Folgeaktionen auf "Braucht dich".
 *
 * Eine Folgeaktion ist calls.follow_up_at + calls.next_action (geschrieben von
 * call-save-followup.js, Status follow_up_scheduled). Sie wird an dem Tag
 * angelegt, an dem der Anruf bearbeitet wird, und ist an einem SPÄTEREN Tag
 * fällig.
 *
 * Die Grundmenge der Lara-Übergabe war "heute eingegangen ODER heute
 * abgeschlossen" (vxHeuteGetHandoverCalls). An seinem Fälligkeitstag ist der
 * Anruf weder das eine noch das andere — Heute zeigte deshalb "Alles im
 * Griff", während eine zugesagte Rückmeldung fällig oder überfällig war.
 *
 * Geprüft werden vier Invarianten:
 *   1. eine heute (oder früher) fällige, offene Folgeaktion ist Teil der
 *      Übergabe — eine erst morgen fällige und eine erledigte nicht,
 *   2. die Nachricht von Lara widerspricht den sichtbaren Karten nie
 *      ("nichts braucht dich" darf neben einer fälligen Karte nicht stehen)
 *      und zählt einen Anruf von vorgestern nicht als heutigen Eingang,
 *   3. die Karte benennt Aktion und Termin und zeigt keine fremde Uhrzeit,
 *   4. die Fälligkeit wird über parseFollowUpDate (lokale Benutzerzeit)
 *      eingeordnet, nicht über den UTC-Pfad vxHeuteParseDate.
 */

// Zeitzone und "jetzt" werden hier festgenagelt: die geprüfte Logik ist
// Kalenderlogik ("heute", "überfällig"), die sonst je nach Uhrzeit des
// CI-Laufs ein anderes Ergebnis liefert. Europe/Zurich ist die
// Anzeige-Zeitzone des Produkts (DISPLAY_TIMEZONE).
process.env.TZ = 'Europe/Zurich';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Donnerstag, 09.08.2026, 10:00 Zürich (MESZ = UTC+2).
const NOW_ISO = '2026-08-09T08:00:00.000Z';
const NOW_MS = new Date(NOW_ISO).getTime();

class FixedDate extends Date {
  constructor(...args) {
    if (args.length === 0) super(NOW_MS);
    else super(...args);
  }
  static now() { return NOW_MS; }
}

const dashboardPath = path.join(__dirname, '..', 'index.html');
const dashboard = fs.readFileSync(dashboardPath, 'utf8');
const uiComponents = fs.readFileSync(
  path.join(__dirname, '..', 'shared', 'customer-ui-components.js'),
  'utf8'
);

function extractFunction(name) {
  const start = dashboard.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' not found in index.html');
  let depth = 0;
  let seenBody = false;
  for (let i = start; i < dashboard.length; i += 1) {
    const char = dashboard[i];
    if (char === '{') { depth += 1; seenBody = true; }
    else if (char === '}') {
      depth -= 1;
      if (seenBody && depth === 0) return dashboard.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function: ' + name);
}

// Genau die Kette, an der die Einordnung hängt — inklusive der kanonischen
// Helfer aus dem übrigen Dashboard, damit der Test dieselbe Zeitlogik prüft,
// die der Browser ausführt (keine nachgebauten Parser).
const FUNCTIONS = [
  'parseLocalDateTimeParts', 'parseCallTimestamp', 'parseFollowUpDate',
  'resolveFollowUpAt', 'resolveTaskDueAt', 'getTaskDueRaw', 'parseTaskDueAt',
  'hasMeaningfulDueTime', 'formatTimeCH', 'formatDateShortCH',
  'formatTaskDueLabel', 'getFollowUpBadgeState', 'getFollowUpActionLabel',
  'normalizeStatus', 'isClosedStatus', 'isManualTaskRecord', '_esc', 'vxUiBadge',
  'vxHeuteGetRecordValue', 'vxHeuteGetTimestamp', 'vxHeuteParseDate', 'vxHeuteIsToday',
  'vxHeuteIsOutboundOrTestRecord', 'vxHeuteIsManualTask', 'vxHeuteIsDoneRecord',
  'vxHeuteRecordCreatedToday', 'vxHeuteRecordCompletedToday',
  'vxHeuteGetFollowUpValue', 'vxHeuteIsFollowUpDue', 'vxHeuteIsCarriedOverFollowUp',
  'vxHeuteDedupeByStableId', 'vxHeuteIsHandoverCall', 'vxHeuteGetHandoverCalls',
  'vxHeuteCreatedTimeValue', 'vxHeuteSortNeedsRecords',
  'vxHeuteSpellNumber', 'vxHeuteCapitalize', 'vxHeuteCallPhrase', 'vxHeuteOpenPhrase',
  'vxHeuteDuePhrase', 'vxHeuteFormatVisitTime', 'vxHeuteCountSinceVisit',
  'vxHeuteBuildLaraMessage',
  'vxHeuteRecordTitle', 'vxHeuteRecordSummary', 'vxHeuteHandoverDescription',
  'vxHeuteHandoverCardTimestamp', 'vxHeuteHandoverCardTime',
  'vxHeuteFollowUpDueRowHtml', 'vxHeuteHandoverCardHtml'
];

function loadHeute() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  sandbox.Intl = Intl;
  sandbox.Date = FixedDate;
  sandbox.Set = Set;
  sandbox.Number = Number;
  vm.createContext(sandbox);

  vm.runInContext(uiComponents, sandbox);
  vm.runInContext(
    "const DISPLAY_TIMEZONE = 'Europe/Zurich';\n"
    + "const TIME_FORMAT_CH = new Intl.DateTimeFormat('de-CH', { timeZone: DISPLAY_TIMEZONE, hour: '2-digit', minute: '2-digit' });\n"
    + "const DATE_SHORT_FORMAT_CH = new Intl.DateTimeFormat('de-CH', { timeZone: DISPLAY_TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric' });\n"
    + "const CALL_STATUS = Object.freeze({ NEW:'new', IN_PROGRESS:'in_progress', FOLLOW_UP_SCHEDULED:'follow_up_scheduled', CLOSED:'closed', ARCHIVED:'archived' });\n"
    + "function refreshLucideIcons(){}\n",
    sandbox
  );
  vm.runInContext(FUNCTIONS.map(extractFunction).join('\n'), sandbox);
  return sandbox;
}

// ── Testdaten ───────────────────────────────────────────────────────────────
// created_at kommt von Supabase als UTC (timestamp without time zone),
// follow_up_at als timestamptz mit +00:00 — dessen Wanduhrzeit ist laut
// serializeFollowUpLocal()/parseFollowUpDate() lokale Benutzerzeit.
function utcStamp(date) {
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}
function pad(n) { return String(n).padStart(2, '0'); }
function followUpStamp(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':00+00:00';
}
function shiftDays(days, hour, minute) {
  const d = new Date(NOW_MS);
  d.setDate(d.getDate() + days);
  if (hour !== undefined) d.setHours(hour, minute || 0, 0, 0);
  return d;
}

function call(id, fields) {
  return { id: id, fields: Object.assign({ direction: 'inbound', category: 'inbound' }, fields) };
}

// Anruf von vorgestern, Folgeaktion heute früh fällig → überfällig.
const overdueFollowUp = call('overdue', {
  caller_name: 'Ueberfaellig AG',
  created_at: utcStamp(shiftDays(-2, 9, 15)),
  dashboard_status: 'follow_up_scheduled',
  next_action: 'Zurückrufen',
  follow_up_at: followUpStamp(shiftDays(-1, 9, 0)),
  call_summary: 'Wollte ein Angebot besprechen.'
});
// Anruf von gestern, Folgeaktion heute in zwei Stunden fällig.
const dueTodayFollowUp = call('due-today', {
  caller_name: 'Heute Faellig GmbH',
  created_at: utcStamp(shiftDays(-1, 14, 30)),
  dashboard_status: 'follow_up_scheduled',
  next_action: 'Offerte senden',
  follow_up_at: followUpStamp(shiftDays(0, 15, 10)),
  call_summary: 'Offerte für Umbau angefragt.'
});
// Erst morgen fällig — heute keine Arbeit.
const tomorrowFollowUp = call('tomorrow', {
  caller_name: 'Morgen AG',
  created_at: utcStamp(shiftDays(-1, 10, 0)),
  dashboard_status: 'follow_up_scheduled',
  next_action: 'Termin bestätigen',
  follow_up_at: followUpStamp(shiftDays(1, 10, 0))
});
// Abgeschlossen, Termin läge in der Vergangenheit.
const closedFollowUp = call('closed', {
  caller_name: 'Erledigt AG',
  created_at: utcStamp(shiftDays(-3, 10, 0)),
  dashboard_status: 'closed',
  completed_at: utcStamp(shiftDays(-3, 11, 0)),
  next_action: 'Zurückrufen',
  follow_up_at: followUpStamp(shiftDays(-2, 10, 0))
});
// Ganz normaler offener Anruf von heute.
const todayCall = call('today', {
  caller_name: 'Heute Neu AG',
  created_at: utcStamp(new Date(NOW_MS - 60 * 60 * 1000)),
  dashboard_status: 'new',
  call_summary: 'Neue Anfrage.'
});

// ── 1. Grundmenge ───────────────────────────────────────────────────────────

test('REGRESSION: eine heute fällige Folgeaktion eines älteren Anrufs steht auf Heute', () => {
  const vx = loadHeute();
  const ids = vx.vxHeuteGetHandoverCalls([dueTodayFollowUp]).map((r) => r.id);
  assert.deepEqual(
    ids, ['due-today'],
    'Der Anruf ist weder heute eingegangen noch heute abgeschlossen — ohne die '
    + 'Fälligkeitsregel fällt er aus der Übergabe und Heute meldet "Alles im Griff"'
  );
});

test('REGRESSION: eine überfällige Folgeaktion steht auf Heute', () => {
  const vx = loadHeute();
  const ids = vx.vxHeuteGetHandoverCalls([overdueFollowUp]).map((r) => r.id);
  assert.deepEqual(ids, ['overdue']);
});

test('eine erst morgen fällige Folgeaktion steht heute nicht auf Heute', () => {
  const vx = loadHeute();
  assert.deepEqual(vx.vxHeuteGetHandoverCalls([tomorrowFollowUp]), []);
  assert.equal(vx.vxHeuteIsFollowUpDue(tomorrowFollowUp), false);
});

test('eine abgeschlossene Folgeaktion holt den Anruf nicht zurück', () => {
  const vx = loadHeute();
  assert.equal(vx.vxHeuteIsFollowUpDue(closedFollowUp), false);
  assert.deepEqual(vx.vxHeuteGetHandoverCalls([closedFollowUp]), []);
});

test('ein Anruf ohne Folgeaktion bleibt von der Regel unberührt', () => {
  const vx = loadHeute();
  const older = call('older', {
    caller_name: 'Alt AG',
    created_at: utcStamp(shiftDays(-2, 9, 0)),
    dashboard_status: 'new'
  });
  assert.deepEqual(vx.vxHeuteGetHandoverCalls([older]), []);
  assert.deepEqual(vx.vxHeuteGetHandoverCalls([todayCall]).map((r) => r.id), ['today']);
});

test('nur die übernommenen Folgeaktionen gelten als übernommen', () => {
  const vx = loadHeute();
  assert.equal(vx.vxHeuteIsCarriedOverFollowUp(dueTodayFollowUp), true);
  assert.equal(vx.vxHeuteIsCarriedOverFollowUp(todayCall), false);
  // Heute eingegangen UND heute fällig: zählt als heutiger Eingang, nicht
  // zusätzlich als übernommene Folgeaktion.
  const sameDay = call('same-day', {
    caller_name: 'Gleichentags AG',
    created_at: utcStamp(new Date(NOW_MS - 30 * 60 * 1000)),
    dashboard_status: 'follow_up_scheduled',
    next_action: 'Zurückrufen',
    follow_up_at: followUpStamp(shiftDays(0, 16, 0))
  });
  assert.equal(vx.vxHeuteIsFollowUpDue(sameDay), true);
  assert.equal(vx.vxHeuteIsCarriedOverFollowUp(sameDay), false);
});

// ── 2. Reihenfolge ──────────────────────────────────────────────────────────

test('fällige Folgeaktionen stehen oben, die am längsten überfällige zuerst', () => {
  const vx = loadHeute();
  const needs = vx.vxHeuteSortNeedsRecords([todayCall, dueTodayFollowUp, overdueFollowUp]);
  assert.deepEqual(needs.map((r) => r.id), ['overdue', 'due-today', 'today']);
});

// ── 3. Nachricht von Lara ───────────────────────────────────────────────────

test('kein heutiger Eingang, aber eine fällige Folgeaktion: die Nachricht nennt sie', () => {
  const vx = loadHeute();
  const msg = vx.vxHeuteBuildLaraMessage(null, 0, 0, 0, 0, 1);
  assert.match(msg, /Fällig ist eine Folgeaktion aus den letzten Tagen\./);
  assert.doesNotMatch(
    msg, /Ich melde mich, sobald ein Anruf reinkommt/,
    'der Leerzustands-Satz widerspricht der sichtbaren Karte'
  );
});

test('die Nachricht sagt nie "nichts braucht dich", solange etwas fällig ist', () => {
  const vx = loadHeute();
  const visitRef = new Date(NOW_MS - 3 * 60 * 60 * 1000);
  [null, visitRef].forEach((ref) => {
    [0, 1, 2].forEach((todayTotal) => {
      [0, 1].forEach((newCount) => {
        [0, 1].forEach((resolvedCount) => {
          [1, 2].forEach((dueCount) => {
            const msg = vx.vxHeuteBuildLaraMessage(ref, todayTotal, newCount, resolvedCount, 0, dueCount);
            assert.doesNotMatch(msg, /nichts braucht dich/, 'Widerspruch bei dueCount=' + dueCount);
            assert.match(msg, /Folgeaktion(en)? aus den letzten Tagen/);
          });
        });
      });
    });
  });
});

test('mehrere fällige Folgeaktionen werden ausgeschrieben und grammatikalisch korrekt angehängt', () => {
  const vx = loadHeute();
  assert.match(
    vx.vxHeuteBuildLaraMessage(null, 0, 0, 0, 0, 2),
    /Fällig sind zwei Folgeaktionen aus den letzten Tagen\./
  );
  assert.match(
    vx.vxHeuteBuildLaraMessage(null, 1, 1, 0, 1, 2),
    /Dazu sind zwei Folgeaktionen aus den letzten Tagen fällig\.$/
  );
});

test('die bestehenden Formulierungen bleiben unverändert, solange nichts fällig ist', () => {
  const vx = loadHeute();
  assert.equal(
    vx.vxHeuteBuildLaraMessage(null, 0, 0, 0, 0, 0),
    'Heute ist noch nichts eingegangen. Ich melde mich, sobald ein Anruf reinkommt.'
  );
  assert.equal(
    vx.vxHeuteBuildLaraMessage(null, 2, 0, 2, 0, 0),
    'Heute ist nichts Neues eingegangen. Alles von heute ist erledigt – nichts braucht dich.'
  );
  assert.equal(
    vx.vxHeuteBuildLaraMessage(null, 1, 1, 0, 1, 0),
    'Heute ist ein Anruf eingegangen. Einer wartet auf dich.'
  );
});

test('eine übernommene Folgeaktion zählt nicht als "seit deinem letzten Besuch eingegangen"', () => {
  const vx = loadHeute();
  // Ohne Besuchsreferenz zählt vxHeuteCountSinceVisit die ganze Liste — genau
  // deshalb darf die Liste die übernommenen Anrufe nicht enthalten.
  const todayCalls = vx.vxHeuteGetHandoverCalls([todayCall, dueTodayFollowUp, overdueFollowUp]);
  const carried = todayCalls.filter((r) => vx.vxHeuteIsCarriedOverFollowUp(r));
  const todayOnly = todayCalls.filter((r) => carried.indexOf(r) === -1);
  assert.equal(carried.length, 2);
  assert.deepEqual(todayOnly.map((r) => r.id), ['today']);
  assert.equal(vx.vxHeuteCountSinceVisit(todayOnly, null), 1);
});

// ── 4. Karte ────────────────────────────────────────────────────────────────

test('die Karte benennt die zugesagte Aktion und ihren Termin', () => {
  const vx = loadHeute();
  const html = vx.vxHeuteHandoverCardHtml(dueTodayFollowUp, 'needs');
  assert.match(html, /vx-handover-card-due/);
  assert.match(html, /Offerte senden/, 'next_action fehlt an der Karte');
  assert.match(html, /Heute, /, 'der Termin fehlt an der Karte');
  assert.match(html, /vx-ui-badge--info/, 'heute fällig ist kein Fehlerzustand');
});

test('eine überfällige Folgeaktion trägt den Danger-Chip', () => {
  const vx = loadHeute();
  const html = vx.vxHeuteHandoverCardHtml(overdueFollowUp, 'needs');
  assert.match(html, /vx-ui-badge--danger/);
  assert.match(html, /Überfällig/);
});

test('die Karte einer übernommenen Folgeaktion zeigt keine fremde Uhrzeit', () => {
  const vx = loadHeute();
  const html = vx.vxHeuteHandoverCardHtml(overdueFollowUp, 'needs');
  assert.doesNotMatch(
    html, /vx-handover-card-time/,
    'die Eingangszeit eines Anrufs von vorgestern liest sich unter "Braucht dich" wie heute'
  );
  // Gegenprobe: ein heutiger Anruf behält seine Uhrzeit.
  assert.match(vx.vxHeuteHandoverCardHtml(todayCall, 'needs'), /vx-handover-card-time/);
});

test('Anrufe ohne Folgeaktion bekommen keine Fälligkeitszeile', () => {
  const vx = loadHeute();
  assert.doesNotMatch(vx.vxHeuteHandoverCardHtml(todayCall, 'needs'), /vx-handover-card-due/);
});

// ── 5. Quelltext-Contract: Zeitzone ─────────────────────────────────────────

test('die Fälligkeit wird nicht über den UTC-Pfad vxHeuteParseDate eingeordnet', () => {
  // vxHeuteParseDate liest über parseCallTimestamp als UTC. follow_up_at ist
  // aber lokale Benutzerzeit (serializeFollowUpLocal/parseFollowUpDate) — ein
  // Termin um 09:00 wäre über den UTC-Pfad in Zürich erst um 11:00 fällig.
  const body = extractFunction('vxHeuteIsFollowUpDue');
  const code = body.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  assert.ok(code.includes('getFollowUpBadgeState'), 'kanonische Einordnung fehlt');
  assert.ok(!code.includes('vxHeuteParseDate'), 'vxHeuteIsFollowUpDue liest follow_up_at wieder als UTC');
});

test('die Grundmenge der Übergabe fragt die Fälligkeit ab', () => {
  const body = extractFunction('vxHeuteGetHandoverCalls');
  assert.ok(
    body.includes('vxHeuteIsFollowUpDue'),
    'ohne diesen Zweig fällt jede Folgeaktion an ihrem Fälligkeitstag wieder aus Heute'
  );
});

test('die Fälligkeit hängt am kanonischen Parser, nicht an einem eigenen', () => {
  const vx = loadHeute();
  // 09:00 Wanduhrzeit mit +00:00-Suffix ist 09:00 lokal, nicht 11:00.
  const due = vx.parseTaskDueAt(overdueFollowUp);
  assert.equal(due.getHours(), 9);
  assert.equal(due.getMinutes(), 0);
});
