// Prueft die Buchungsfenster-Regel aus #930.
//
// Kern: Buchungszeiten sind eine TEILMENGE der Oeffnungszeiten, nie eine
// Erweiterung. Anlass war ein Kunde, bei dem calendar_settings.business_hours
// Mo-Fr 08-17 sagte, waehrend das Geschaeftsprofil fuer dieselben Tage
// "geschlossen" anzeigte. Ein Leser, der nur business_hours prueft, haette
// diesen Widerspruch festgeschrieben statt aufgeloest.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { bookingWindowError } = require('../customer-dashboard/netlify/functions/_lib/booking-window.js');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (error) { failed += 1; console.error('FAIL ' + name + ': ' + error.message); }
}

const WOCHE = (von, bis) => ({
  mon: [[von, bis]], tue: [[von, bis]], wed: [[von, bis]], thu: [[von, bis]], fri: [[von, bis]], sat: [], sun: []
});
const settings = (business_hours) => ({ timezone: 'Europe/Zurich', business_hours });

// 2026-08-11 ist ein Dienstag, 2026-08-15 ein Samstag (beide geprueft).
const DI = (zeit) => `2026-08-11T${zeit}:00+02:00`;
const SA = (zeit) => `2026-08-15T${zeit}:00+02:00`;

check('Termin innerhalb beider Fenster ist erlaubt', () => {
  assert.equal(bookingWindowError(DI('10:00'), DI('10:30'), settings(WOCHE('08:00', '17:00')), WOCHE('08:00', '17:00')), null);
});

check('Termin ausserhalb der Buchungszeiten wird abgelehnt', () => {
  assert.equal(bookingWindowError(DI('03:00'), DI('03:30'), settings(WOCHE('08:00', '17:00')), WOCHE('08:00', '17:00')),
    'calendar_booking_outside_hours');
});

check('Ein Tag ohne Buchungsfenster ist gesperrt', () => {
  assert.equal(bookingWindowError(SA('10:00'), SA('10:30'), settings(WOCHE('08:00', '17:00')), WOCHE('08:00', '17:00')),
    'calendar_closed_on_this_day');
});

// Der eigentliche Befund: zwei Wahrheiten ueber denselben Tag.
check('Geschlossenes Geschaeftsprofil schlaegt offene Buchungszeiten', () => {
  const profilZu = { ...WOCHE('08:00', '17:00'), tue: [] };
  assert.equal(bookingWindowError(DI('10:00'), DI('10:30'), settings(WOCHE('08:00', '17:00')), profilZu),
    'calendar_closed_on_this_day');
});

check('Buchungszeiten koennen die Oeffnungszeiten nicht erweitern', () => {
  // Profil 09-12, Buchung 08-17 -> erlaubt ist nur 09-12.
  const s = settings(WOCHE('08:00', '17:00'));
  const profil = WOCHE('09:00', '12:00');
  assert.equal(bookingWindowError(DI('09:30'), DI('10:00'), s, profil), null);
  assert.equal(bookingWindowError(DI('08:15'), DI('08:45'), s, profil), 'calendar_booking_outside_hours');
  assert.equal(bookingWindowError(DI('13:00'), DI('13:30'), s, profil), 'calendar_booking_outside_hours');
});

check('Buchungszeiten engen die Oeffnungszeiten wirksam ein', () => {
  // Profil 08-17, Buchung nur 13-17 -> vormittags keine Termine.
  assert.equal(bookingWindowError(DI('09:00'), DI('09:30'), settings(WOCHE('13:00', '17:00')), WOCHE('08:00', '17:00')),
    'calendar_booking_outside_hours');
});

check('Ohne Geschaeftsprofil fuehren die Buchungszeiten allein', () => {
  assert.equal(bookingWindowError(DI('10:00'), DI('10:30'), settings(WOCHE('08:00', '17:00')), null), null);
  assert.equal(bookingWindowError(DI('20:00'), DI('20:30'), settings(WOCHE('08:00', '17:00')), null),
    'calendar_booking_outside_hours');
});

check('Ohne Buchungszeiten fuehren die Oeffnungszeiten allein', () => {
  assert.equal(bookingWindowError(DI('10:00'), DI('10:30'), settings(null), WOCHE('08:00', '17:00')), null);
  assert.equal(bookingWindowError(DI('20:00'), DI('20:30'), settings(null), WOCHE('08:00', '17:00')),
    'calendar_booking_outside_hours');
});

check('Ein Termin ueber die Mittagspause hinweg wird abgelehnt', () => {
  const geteilt = { ...WOCHE('08:00', '12:00'), tue: [['08:00', '12:00'], ['13:00', '17:00']] };
  assert.equal(bookingWindowError(DI('11:45'), DI('13:15'), settings(geteilt), geteilt), 'calendar_booking_outside_hours');
  assert.equal(bookingWindowError(DI('13:00'), DI('13:30'), settings(geteilt), geteilt), null);
});

// Gerechnet wird in der Zeitzone des Kunden, nicht in der Serverzeit. Auf
// Netlify ist die Serverzeit UTC -- im Sommer eine Stunde daneben, im Winter
// zwei. Ohne diese Pruefung waeren Termine am Rand des Fensters je nach
// Jahreszeit unterschiedlich erlaubt.
check('Sommerzeit: 08:30 Ortszeit liegt im Fenster', () => {
  assert.equal(bookingWindowError('2026-07-14T06:30:00Z', '2026-07-14T07:00:00Z', settings(WOCHE('08:00', '17:00')), null), null);
});

check('Winterzeit: 08:30 Ortszeit liegt im Fenster', () => {
  assert.equal(bookingWindowError('2026-01-13T07:30:00Z', '2026-01-13T08:00:00Z', settings(WOCHE('08:00', '17:00')), null), null);
});

check('Winterzeit: 07:30 Ortszeit liegt davor', () => {
  assert.equal(bookingWindowError('2026-01-13T06:30:00Z', '2026-01-13T07:00:00Z', settings(WOCHE('08:00', '17:00')), null),
    'calendar_booking_outside_hours');
});

check('Ein Termin ueber Mitternacht hinaus wird abgelehnt', () => {
  assert.equal(bookingWindowError(DI('23:30'), '2026-08-12T00:30:00+02:00', settings(WOCHE('00:00', '23:59')), null),
    'calendar_booking_outside_hours');
});

check('Kaputte Zeitangaben im Raster erzeugen kein zusaetzliches Fenster', () => {
  const kaputt = { ...WOCHE('08:00', '17:00'), tue: [['08:00'], ['25:00', '26:00'], ['17:00', '09:00']] };
  assert.equal(bookingWindowError(DI('10:00'), DI('10:30'), settings(kaputt), null), 'calendar_closed_on_this_day');
});

if (failed) { console.error(`booking window verification failed: ${failed}`); process.exit(1); }
console.log('booking window verified.');
