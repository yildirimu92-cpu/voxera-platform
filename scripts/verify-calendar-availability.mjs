// Prueft die Verfuegbarkeitspruefung nach dem Wegfall von freeBusy (12.08.2026).
//
// Anlass: drei Testanrufe, drei Fehlschlaege, unabhaengig von Datum und
// Formulierung. Ursache war kein Grenzfall, sondern eine fehlende Berechtigung:
// `calendar/v3/freeBusy` verlangt `calendar`, `calendar.readonly` oder
// `calendar.freebusy`. Erteilt sind `calendar.calendarlist.readonly` und
// `calendar.events`. Der Endpunkt war damit nie erlaubt -- jede
// Verfuegbarkeitspruefung und jede Buchung schlug fehl, seit es sie gibt.
//
// Der Fix nimmt fuer Google immer die Terminliste. Dieses Skript haelt fest,
// was dabei nicht verlorengehen darf:
//
//   1. freeBusy kommt nicht zurueck (auch nicht "nur fuer den Sonderfall").
//   2. Die Filterregeln der Terminliste stimmen -- abgesagt, "frei", der
//      eigene Termin beim Verschieben.
//   3. Ganztaegige Termine belegen den Tag, statt durchzufallen.
//   4. Eine abgeschnittene Liste gilt nicht als "frei".
//   5. Die 8-Stunden-Schranke bewacht den Zeitraum MIT Puffern -- also den,
//      der tatsaechlich abgefragt wird.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const providersPath = 'customer-dashboard/netlify/functions/_lib/calendar-providers.js';
const toolPath = 'customer-dashboard/netlify/functions/calendar-tool.js';

const providers = require(`../${providersPath}`);
const { busyFromGoogleEvents, busyFromGraphEvents } = providers._test;
// Die Fensterregeln liegen in booking-window.js, nicht in calendar-tool.js --
// dort haengt `@supabase/supabase-js`, das in der Pruefung nicht installiert
// ist. Genau deshalb steht die Rechenregel eine Ebene tiefer.
const { windowSpanError, bufferedWindow, MAX_WINDOW_MS } =
  require('../customer-dashboard/netlify/functions/_lib/booking-window.js');

// Kommentare raus, bevor irgendetwas im Quelltext gesucht wird.
//
// Ohne das prueft man den Text ueber den Code, nicht den Code. Drei Pruefungen
// in dieser Runde sind genau daran gescheitert: sie schlugen an dem Kommentar
// an, der den behobenen Fehler BESCHREIBT. Ein Test, der das Wort statt der
// Sache sucht, verbietet am Ende die Dokumentation.
function ohneKommentare(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((zeile) => zeile.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

const providersSource = ohneKommentare(fs.readFileSync(providersPath, 'utf8'));
const toolSource = ohneKommentare(fs.readFileSync(toolPath, 'utf8'));

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (error) { failed += 1; console.error('FAIL ' + name + ': ' + error.message); }
}

// ── 1. freeBusy ist weg und bleibt weg ──────────────────────────────────────

check('freeBusy wird nicht mehr aufgerufen', () => {
  assert.ok(!/freeBusy/i.test(providersSource),
    'freeBusy steht wieder im Code -- der Bereich dafuer ist nicht erteilt');
});

check('Der angeforderte Bereich bleibt der bereits erteilte', () => {
  // Geprueft wird die Liste selbst, nicht der Dateitext -- sonst schlaegt der
  // Kommentar an, der die fehlenden Bereiche BESCHREIBT. (Erste Fassung dieser
  // Pruefung ist genau daran gescheitert.)
  const scopes = providers.PROVIDERS.google.scopes;
  assert.ok(scopes.includes('https://www.googleapis.com/auth/calendar.events'),
    'calendar.events fehlt -- ohne ihn geht auch die Terminliste nicht');
  for (const neu of [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.freebusy'
  ]) {
    assert.ok(!scopes.includes(neu),
      `${neu} wuerde jeden bestehenden Kunden durch eine neue OAuth-Zustimmung schicken`);
  }
});

// ── 2. Die Filterregeln ─────────────────────────────────────────────────────

const googlePayload = {
  items: [
    { id: 'a', status: 'confirmed', start: { dateTime: '2026-08-18T08:00:00Z' }, end: { dateTime: '2026-08-18T09:00:00Z' } },
    { id: 'b', status: 'cancelled', start: { dateTime: '2026-08-18T09:00:00Z' }, end: { dateTime: '2026-08-18T10:00:00Z' } },
    { id: 'c', transparency: 'transparent', start: { dateTime: '2026-08-18T10:00:00Z' }, end: { dateTime: '2026-08-18T11:00:00Z' } },
    { id: 'd', status: 'confirmed', start: { dateTime: '2026-08-18T11:00:00Z' }, end: { dateTime: '2026-08-18T12:00:00Z' } }
  ]
};

check('Abgesagte Termine belegen nichts', () => {
  assert.ok(!busyFromGoogleEvents(googlePayload).some((item) => item.id === 'b'));
});

check('Als "frei" markierte Termine belegen nichts', () => {
  assert.ok(!busyFromGoogleEvents(googlePayload).some((item) => item.id === 'c'));
});

check('Echte Termine belegen', () => {
  const ids = busyFromGoogleEvents(googlePayload).map((item) => item.id);
  assert.deepEqual(ids, ['a', 'd']);
});

check('Beim Verschieben zaehlt der eigene Termin nicht als Konflikt', () => {
  const ids = busyFromGoogleEvents(googlePayload, 'a').map((item) => item.id);
  assert.deepEqual(ids, ['d'], 'Der zu verschiebende Termin blockiert sich selbst');
});

check('Intervalle tragen Anfang und Ende', () => {
  const [erste] = busyFromGoogleEvents(googlePayload);
  assert.equal(erste.start, '2026-08-18T08:00:00Z');
  assert.equal(erste.end, '2026-08-18T09:00:00Z');
});

// ── 3. Ganztaegige Termine ──────────────────────────────────────────────────

check('Ein ganztaegiger Termin belegt den Tag', () => {
  // Google liefert dafuer `date` statt `dateTime`. Ohne den Rueckfall waeren
  // start/end undefined und der Tag gaelte als frei -- ein Ferientag saehe aus
  // wie ein leerer Kalender.
  const ganztags = { items: [{ id: 'x', status: 'confirmed', start: { date: '2026-08-18' }, end: { date: '2026-08-19' } }] };
  const busy = busyFromGoogleEvents(ganztags);
  assert.equal(busy.length, 1);
  assert.equal(busy[0].start, '2026-08-18');
});

check('Ein Eintrag ohne Zeitangabe wird verworfen statt halb uebernommen', () => {
  const kaputt = { items: [{ id: 'y', status: 'confirmed', start: {}, end: {} }] };
  assert.equal(busyFromGoogleEvents(kaputt).length, 0);
});

check('Leere und fehlende Antworten ergeben keine Belegung', () => {
  assert.deepEqual(busyFromGoogleEvents({}), []);
  assert.deepEqual(busyFromGoogleEvents(null), []);
  assert.deepEqual(busyFromGoogleEvents({ items: [] }), []);
});

// ── Microsoft, dieselben Regeln ─────────────────────────────────────────────

check('Microsoft: abgesagt und "frei" belegen nichts', () => {
  const graph = {
    value: [
      { id: 'm1', showAs: 'busy', start: { dateTime: '2026-08-18T08:00:00' }, end: { dateTime: '2026-08-18T09:00:00' } },
      { id: 'm2', isCancelled: true, showAs: 'busy', start: { dateTime: '2026-08-18T09:00:00' }, end: { dateTime: '2026-08-18T10:00:00' } },
      { id: 'm3', showAs: 'free', start: { dateTime: '2026-08-18T10:00:00' }, end: { dateTime: '2026-08-18T11:00:00' } },
      { id: 'm4', showAs: 'workingElsewhere', start: { dateTime: '2026-08-18T11:00:00' }, end: { dateTime: '2026-08-18T12:00:00' } }
    ]
  };
  assert.deepEqual(busyFromGraphEvents(graph).map((i) => i.id), ['m1']);
  assert.deepEqual(busyFromGraphEvents(graph, 'm1').map((i) => i.id), []);
});

// ── 4. Abgeschnittene Liste ─────────────────────────────────────────────────

check('Eine abgeschnittene Terminliste gilt nicht als frei', () => {
  // freeBusy lieferte immer den ganzen Zeitraum, die Terminliste ist
  // seitenweise. Fehlende Termine saehen aus wie freie Zeit -- also lieber ein
  // Fehler, der in den Rueckrufweg fuehrt, als eine Zusage auf halber Grundlage.
  assert.match(providersSource, /nextPageToken/,
    'Die Seitengrenze der Terminliste wird nicht geprueft');
  assert.match(providersSource, /calendar_busy_list_truncated/);
});

// ── 5. Die 8-Stunden-Schranke sitzt auf der gepufferten Spanne ──────────────

const START = '2026-08-18T08:00:00Z';
const spanne = (stunden) => new Date(new Date(START).getTime() + stunden * 3600000).toISOString();

check('validateWindow() rechnet die Spanne nicht mehr selbst', () => {
  assert.match(toolSource, /windowSpanError\(startIso, endIso, settings\)/,
    'validateWindow() benutzt die geteilte Regel nicht');
  assert.ok(!/end - start > /.test(toolSource),
    'Die alte Pruefung auf der ungepufferten Spanne steht noch im Werkzeug');
});

check('Genau 8 Stunden ohne Puffer bleiben erlaubt', () => {
  // "hoechstens 8 Stunden" heisst: 8 Stunden gehen. Der Fehler lag nie am
  // Vergleich, sondern an der Spanne, auf der er sass.
  assert.equal(windowSpanError(START, spanne(8), { buffer_before_minutes: 0, buffer_after_minutes: 0 }), null);
});

check('Acht Stunden plus Puffer werden abgelehnt', () => {
  // Der Fall aus dem Testanruf vom 12.08.: 09:00-17:00 Ortszeit bei
  // buffer_after_minutes = 10 fragt 8 Stunden 10 Minuten ab.
  assert.equal(
    windowSpanError(START, spanne(8), { buffer_before_minutes: 0, buffer_after_minutes: 10 }),
    'calendar_time_window_too_large'
  );
});

check('Auch ein Puffer davor zaehlt mit', () => {
  assert.equal(
    windowSpanError(START, spanne(8), { buffer_before_minutes: 15, buffer_after_minutes: 0 }),
    'calendar_time_window_too_large'
  );
});

check('Ein Halbtag mit Puffern bleibt bequem erlaubt', () => {
  assert.equal(windowSpanError(START, spanne(4), { buffer_before_minutes: 15, buffer_after_minutes: 10 }), null);
});

check('Die gepufferte Spanne ist genau das, was abgefragt wird', () => {
  const settings = { buffer_before_minutes: 15, buffer_after_minutes: 10 };
  const w = bufferedWindow(START, spanne(1), settings);
  assert.equal(new Date(w.end).getTime() - new Date(w.start).getTime(), (60 + 25) * 60000);
});

check('Verdrehte und unbrauchbare Zeitraeume werden abgewiesen', () => {
  assert.equal(windowSpanError(spanne(2), START, {}), 'calendar_time_window_invalid');
  assert.equal(windowSpanError(START, START, {}), 'calendar_time_window_invalid');
  assert.equal(windowSpanError('kein Datum', spanne(1), {}), 'calendar_time_window_invalid');
  // Der Fall vom 12.08. um 07:21: das Modell schickte keinen Endzeitpunkt.
  assert.equal(windowSpanError(START, null, {}), 'calendar_time_window_invalid');
});

check('Die Grenze im Code entspricht der im Prompt genannten', () => {
  assert.equal(MAX_WINDOW_MS, 8 * 60 * 60 * 1000);
});

if (failed) { console.error(`calendar availability verification failed: ${failed}`); process.exit(1); }
console.log('calendar availability verified.');
