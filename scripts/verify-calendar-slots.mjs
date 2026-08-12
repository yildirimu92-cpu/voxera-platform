// Prueft die Slot-Zerlegung aus #951 (P1).
//
// Befund: `checkAvailability()` beantwortet "ist dieser Zeitraum frei" mit
// `busy.length === 0` fuer den ganzen Block. Ein einziger Termin um 09:00
// machte damit den kompletten Vormittag "unverfuegbar" -- und Schritt 4 des
// Kalenderblocks lenkt vage Terminwuensche systematisch in genau diese
// Halbtage. Die Faelle hier halten fest, dass ein Halbtag teilbar ist.
//
// Zweite Fehlerstelle derselben Klasse, mitgeprueft: `bookingWindowError()`
// wurde auf das ganze Fenster angewandt. Ein Halbtag 08:00--12:00 bei
// Buchungszeiten ab 09:00 fiel komplett durch, obwohl 09:00--12:00 buchbar ist.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SLOT_LIMIT, blockingUpdateFor, bookableSlots, freeSlots, _test } =
  require('../customer-dashboard/netlify/functions/_lib/calendar-slots.js');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (error) { failed += 1; console.error('FAIL ' + name + ': ' + error.message); }
}

const WOCHE = (von, bis) => ({
  mon: [[von, bis]], tue: [[von, bis]], wed: [[von, bis]], thu: [[von, bis]], fri: [[von, bis]], sat: [], sun: []
});
// 2026-08-11 ist ein Dienstag (in verify-booking-window.mjs geprueft).
const DI = (zeit) => `2026-08-11T${zeit}:00+02:00`;
const settings = (extra = {}) => ({
  timezone: 'Europe/Zurich',
  appointment_duration_minutes: 30,
  business_hours: WOCHE('08:00', '17:00'),
  ...extra
});
// Vergleichbare Form: nur die Ortszeit des Beginns, das liest sich im
// Fehlerfall besser als eine Liste von ISO-Zeitstempeln.
const zeiten = (slots) => slots.map((slot) => new Date(slot.start).toLocaleTimeString('de-CH', {
  timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit'
}));

const halbtag = (extra = {}, blocking = []) =>
  bookableSlots(DI('08:00'), DI('12:00'), settings(extra), WOCHE('08:00', '17:00'), blocking);

check('Ein freier Halbtag zerfaellt in acht Termine', () => {
  const plan = halbtag();
  assert.equal(plan.slots.length, 8);
  assert.deepEqual(zeiten(plan.slots).slice(0, 3), ['08:00', '08:30', '09:00']);
  assert.equal(plan.duration, 30);
});

// Der eigentliche Befund.
check('Ein einzelner Termin sperrt nicht den ganzen Vormittag', () => {
  const plan = halbtag();
  const frei = freeSlots(plan.slots, [{ start: DI('09:00'), end: DI('09:30') }], settings());
  assert.equal(frei.length, 7);
  assert.ok(!zeiten(frei).includes('09:00'));
  assert.deepEqual(zeiten(frei).slice(0, 3), ['08:00', '08:30', '09:30']);
});

check('Ein belegter Halbtag ergibt keine Termine', () => {
  const plan = halbtag();
  assert.equal(freeSlots(plan.slots, [{ start: DI('08:00'), end: DI('12:00') }], settings()).length, 0);
});

// Zweite Fehlerstelle derselben Klasse: die Fensterpruefung galt fuer den
// ganzen Block.
check('Buchungszeiten schneiden den Halbtag an, statt ihn zu verwerfen', () => {
  const plan = halbtag({ business_hours: WOCHE('09:00', '17:00') });
  assert.equal(plan.slots.length, 6);
  assert.deepEqual(zeiten(plan.slots).slice(0, 2), ['09:00', '09:30']);
  // Der Grund des ersten verworfenen Kandidaten bleibt erhalten, auch wenn
  // spaetere Kandidaten durchgehen -- er wird nur dann zur Antwort, wenn gar
  // nichts uebrig bleibt.
  assert.equal(plan.windowReason, 'calendar_booking_outside_hours');
  assert.equal(plan.candidates.length, 8);
});

check('Ein geschlossener Tag ergibt keine buchbaren Termine', () => {
  const plan = bookableSlots(DI('08:00'), DI('12:00'), settings(), { ...WOCHE('08:00', '17:00'), tue: [] }, []);
  assert.equal(plan.slots.length, 0);
  assert.equal(plan.windowReason, 'calendar_closed_on_this_day');
});

check('Die Mittagspause faellt heraus, der Rest bleibt', () => {
  const geteilt = { ...WOCHE('08:00', '17:00'), tue: [['08:00', '12:00'], ['13:00', '17:00']] };
  const plan = bookableSlots(DI('11:00'), DI('14:00'), settings({ business_hours: geteilt }), geteilt, []);
  assert.deepEqual(zeiten(plan.slots), ['11:00', '11:30', '13:00', '13:30']);
});

check('Eine Betriebssperre nimmt nur die ueberlappenden Termine weg', () => {
  const plan = halbtag({}, [{ type: 'closure', title: 'Betriebsferien', starts_at: DI('10:00'), ends_at: DI('11:00') }]);
  assert.deepEqual(zeiten(plan.slots), ['08:00', '08:30', '09:00', '09:30', '11:00', '11:30']);
  assert.equal(plan.windowReason, 'operational_block');
});

// Die Puffer gelten fuer den NEUEN Termin, nicht fuer den bereits im Kalender
// stehenden. `buffer_before` verlangt Luft VOR dem neuen Termin -- gesperrt ist
// damit der Slot NACH einem belegten Zeitraum, nicht der davor.
//
// Dieselbe Bedingung wendet der book-Pfad an: `bufferedWindow()` vergroessert
// die Abfrage um genau diese beiden Werte und verlangt dort ein leeres
// busy-Array. Waeren die Puffer hier anders gemeint, wuerde availability
// Termine vorschlagen, die book anschliessend ablehnt.
check('Der Puffer vor dem Termin sperrt den Slot nach einem belegten Zeitraum', () => {
  const withBuffer = settings({ buffer_before_minutes: 15 });
  const plan = halbtag({ buffer_before_minutes: 15 });
  const frei = freeSlots(plan.slots, [{ start: DI('08:00'), end: DI('08:30') }], withBuffer);
  assert.ok(!zeiten(frei).includes('08:30'), '08:30 beginnt ohne die verlangten 15 Minuten Luft');
  assert.ok(zeiten(frei).includes('09:00'));
});

check('Der Puffer nach dem Termin sperrt den Slot vor einem belegten Zeitraum', () => {
  const withBuffer = settings({ buffer_after_minutes: 15 });
  const plan = halbtag({ buffer_after_minutes: 15 });
  const frei = freeSlots(plan.slots, [{ start: DI('09:00'), end: DI('09:30') }], withBuffer);
  assert.ok(!zeiten(frei).includes('08:30'), '08:30 endet ohne die verlangten 15 Minuten Luft');
  assert.ok(zeiten(frei).includes('08:00'));
  assert.ok(zeiten(frei).includes('09:30'));
});

check('Ohne Puffer grenzt ein Termin nahtlos an einen belegten Zeitraum', () => {
  const plan = halbtag();
  const frei = freeSlots(plan.slots, [{ start: DI('09:00'), end: DI('09:30') }], settings());
  assert.ok(zeiten(frei).includes('08:30'));
  assert.ok(zeiten(frei).includes('09:30'));
});

check('Ein Fenster kuerzer als die Termindauer traegt keinen Kandidaten', () => {
  const plan = bookableSlots(DI('10:00'), DI('10:15'), settings(), WOCHE('08:00', '17:00'), []);
  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.slots.length, 0);
});

check('Ein angebrochener Rest am Ende faellt weg', () => {
  // 100 Minuten tragen bei 30 Minuten Dauer drei Termine, nicht dreieinhalb.
  const plan = bookableSlots(DI('08:00'), DI('09:40'), settings(), WOCHE('08:00', '17:00'), []);
  assert.deepEqual(zeiten(plan.slots), ['08:00', '08:30', '09:00']);
});

// Ohne konfigurierte Dauer gibt es kein Raster -- dann bleibt es beim alten
// Verhalten: eine Aussage ueber den ganzen angefragten Zeitraum.
check('Ohne Termindauer ist das ganze Fenster der einzige Kandidat', () => {
  const plan = halbtag({ appointment_duration_minutes: 0 });
  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.duration, 240);
  assert.equal(freeSlots(plan.slots, [{ start: DI('09:00'), end: DI('09:30') }], settings()).length, 0);
});

check('Ein unlesbarer Kalendereintrag sperrt im Zweifel alles', () => {
  const plan = halbtag();
  assert.equal(freeSlots(plan.slots, [{ start: 'kaputt', end: DI('09:30') }], settings()).length, 0);
  // Ein Google-Ganztagestermin liefert start/end als reines Datum -- lesbar,
  // und er sperrt den Tag korrekt.
  assert.equal(freeSlots(plan.slots, [{ start: '2026-08-11', end: '2026-08-12' }], settings()).length, 0);
});

check('Sommerzeit: der Halbtag wird in Ortszeit zerlegt', () => {
  // Dieselbe Anfrage in UTC ausgedrueckt -- 06:00Z ist im Sommer 08:00 in
  // Zuerich. Rechnete das Modul in Serverzeit, faellt der erste Termin aus dem
  // Buchungsfenster.
  const plan = bookableSlots('2026-08-11T06:00:00Z', '2026-08-11T10:00:00Z', settings(), WOCHE('08:00', '17:00'), []);
  assert.equal(plan.slots.length, 8);
  assert.deepEqual(zeiten(plan.slots).slice(0, 2), ['08:00', '08:30']);
});

check('Winterzeit: der Halbtag wird in Ortszeit zerlegt', () => {
  // 2026-01-13 ist ein Dienstag; 07:00Z sind im Winter 08:00 in Zuerich.
  const plan = bookableSlots('2026-01-13T07:00:00Z', '2026-01-13T11:00:00Z', settings(), WOCHE('08:00', '17:00'), []);
  assert.equal(plan.slots.length, 8);
});

check('blockingUpdateFor findet nur echte Ueberlappungen', () => {
  const sperre = [{ type: 'closure', starts_at: DI('10:00'), ends_at: DI('11:00') }];
  assert.ok(blockingUpdateFor(sperre, DI('10:30'), DI('11:00')));
  assert.equal(blockingUpdateFor(sperre, DI('11:00'), DI('11:30')), null, 'Anschluss ist keine Ueberlappung');
  assert.equal(blockingUpdateFor(sperre, DI('09:30'), DI('10:00')), null);
  assert.equal(blockingUpdateFor([{ starts_at: 'kaputt', ends_at: DI('11:00') }], DI('10:30'), DI('11:00')), null);
});

// ── Codex-Befund vom 12.08. auf dem ersten Stand dieses Moduls ──────────────
//
// Die Kandidaten liefen nur vom Fensteranfang los. Lagen die Buchungszeiten auf
// einem anderen Minutenraster, verwarf bookingWindowError() jeden Kandidaten --
// availability meldete "gar nichts frei", waehrend book denselben Termin
// gebucht haette. Eine Ablehnung, die keine ist: dieselbe Fehlerklasse wie der
// Befund, den dieses Modul behebt.
check('Ein versetztes Buchungsfenster wird trotzdem getroffen', () => {
  const versetzt = { ...WOCHE('08:00', '17:00'), tue: [['08:15', '08:45']] };
  const plan = bookableSlots(DI('08:00'), DI('12:00'), settings({ business_hours: versetzt }), versetzt, []);
  assert.deepEqual(zeiten(plan.slots), ['08:15'], 'availability findet den Termin nicht, den book akzeptiert');
});

check('Der Anker gilt auch bei einer Mittagspause auf krummem Raster', () => {
  const versetzt = { ...WOCHE('08:00', '17:00'), tue: [['08:00', '12:00'], ['13:20', '14:20']] };
  const plan = bookableSlots(DI('11:00'), DI('15:00'), settings({ business_hours: versetzt }), versetzt, []);
  // 13:20 und 13:50 kommen vom Anker, 13:30 vom Fensterraster -- alle drei
  // liegen in 13:20--14:20 und sind einzeln buchbar. Dass sich Vorschlaege
  // ueberlappen koennen, ist gewollt: es sind Alternativen, und book prueft
  // die gewaehlte ohnehin erneut.
  assert.deepEqual(zeiten(plan.slots), ['11:00', '11:30', '13:20', '13:30', '13:50']);
  assert.ok(!zeiten(plan.slots).includes('12:00'), 'Die Pause bleibt gesperrt');
});

check('Anker ausserhalb des Fensters erzeugen keine Termine', () => {
  const plan = halbtag();
  // Die erlaubte Zeitspanne beginnt um 08:00, das Fenster ebenfalls -- es darf
  // kein doppelter Kandidat entstehen.
  assert.equal(plan.candidates.length, 8);
  assert.equal(new Set(plan.candidates.map((slot) => slot.start)).size, 8);
});

check('Die Kandidaten bleiben aufsteigend sortiert', () => {
  const versetzt = { ...WOCHE('08:00', '17:00'), tue: [['08:00', '12:00'], ['09:20', '10:20']] };
  const plan = bookableSlots(DI('08:00'), DI('11:00'), settings({ business_hours: versetzt }), versetzt, []);
  const starts = plan.candidates.map((slot) => new Date(slot.start).getTime());
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});

// Codex-Befund direkt nach dem ersten Anker-Fix: gelesen wurden nur die Zeiten
// des Tages, an dem das Fenster BEGINNT. Ein Zeitraum ueber Mitternacht verlor
// damit die Anker des zweiten Tages -- wieder ein "gar nichts frei" fuer einen
// Termin, den book gebucht haette.
check('Ein Zeitraum ueber Mitternacht bekommt Anker fuer beide Tage', () => {
  // 2026-08-10 ist ein Montag, 2026-08-11 ein Dienstag.
  const nachts = { mon: [], tue: [['01:15', '01:45']], wed: [], thu: [], fri: [], sat: [], sun: [] };
  const plan = bookableSlots('2026-08-10T23:00:00+02:00', '2026-08-11T07:00:00+02:00',
    settings({ business_hours: nachts }), nachts, []);
  assert.equal(plan.slots.length, 1, 'availability findet den Termin nicht, den book akzeptiert');
  assert.equal(new Date(plan.slots[0].start).toISOString(), new Date('2026-08-11T01:15:00+02:00').toISOString());
});

check('Beide Tage steuern ihre Zeiten bei', () => {
  const nachts = { mon: [['23:10', '23:40']], tue: [['01:15', '01:45']], wed: [], thu: [], fri: [], sat: [], sun: [] };
  const plan = bookableSlots('2026-08-10T23:00:00+02:00', '2026-08-11T07:00:00+02:00',
    settings({ business_hours: nachts }), nachts, []);
  assert.deepEqual(plan.slots.map((slot) => new Date(slot.start).toISOString()), [
    new Date('2026-08-10T23:10:00+02:00').toISOString(),
    new Date('2026-08-11T01:15:00+02:00').toISOString()
  ]);
});

check('Ein Fenster innerhalb eines Tages erzeugt keine doppelten Anker', () => {
  // Anfang und Ende liegen am selben Tag -- beide Bezugspunkte leiten denselben
  // Anker her, er darf nur einmal zaehlen.
  const versetzt = { ...WOCHE('08:00', '17:00'), tue: [['09:15', '12:00']] };
  const anker = _test.slotAnchors(DI('08:00'), DI('12:00'), settings({ business_hours: versetzt }), versetzt);
  assert.equal(anker.length, 2);
  assert.equal(new Set(anker).size, 2);
});

check('Die Anker werden aus dem Fensteranfang hergeleitet', () => {
  const versetzt = { ...WOCHE('08:00', '17:00'), tue: [['09:15', '12:00']] };
  const anker = _test.slotAnchors(DI('08:00'), DI('12:00'), settings({ business_hours: versetzt }), versetzt);
  assert.equal(anker.length, 2);
  assert.equal(new Date(anker[1]).toISOString(), new Date(DI('09:15')).toISOString());
});

check('Die Kandidatenzahl ist nach oben begrenzt', () => {
  // Schutz gegen eine Endlosschleife, falls die 8-Stunden-Schranke aus
  // validateWindow() je wegfaellt.
  const lang = _test.slotCandidates('2026-08-11T00:00:00Z', '2027-08-11T00:00:00Z', 1);
  assert.equal(lang.length, 500);
  assert.deepEqual(_test.slotCandidates(DI('08:00'), DI('12:00'), 0), []);
});

check('Drei Vorschlaege sind das Limit fuer die Antwort', () => {
  assert.equal(SLOT_LIMIT, 3);
});

if (failed) { console.error(`calendar slot verification failed: ${failed}`); process.exit(1); }
console.log('calendar slots verified.');
