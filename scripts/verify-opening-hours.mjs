import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseOpeningHours,
  sanitizeOpeningHours,
  formatOpeningHours
} = require('../customer-dashboard/netlify/functions/_lib/opening-hours.js');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`); }
}

// ── Parser: gegen die echten Vorlagentexte ───────────────────────────────────
// Alle Eingaben unten sind wörtliche `default_location_hours` aus den 19
// industry_templates (Produktionsdatenbank, 09.08.). Ein Parser, der nur an
// erfundenen Beispielen geprüft ist, beweist nichts über diese Texte.

check('Tagesspanne mit Mittagspause (anwalt)', () => {
  const { hours } = parseOpeningHours(
    'Adresse: [Strasse, PLZ Ort]\\nBürozeiten: Montag–Freitag 08:30–12:00 und 13:30–17:30 Uhr\\nErstgespräch: [kostenpflichtig/kostenlos], Dauer ca. 30–60 Minuten'
  );
  assert.deepEqual(hours.mon, [['08:30', '12:00'], ['13:30', '17:30']]);
  assert.deepEqual(hours.fri, [['08:30', '12:00'], ['13:30', '17:30']]);
  assert.deepEqual(hours.sat, [], 'Samstag wurde erfunden');
  assert.deepEqual(hours.sun, []);
});

check('mehrere Segmente in einer Zeile (garage)', () => {
  const { hours } = parseOpeningHours(
    'Öffnungszeiten: Montag–Freitag 07:30–12:00 und 13:30–18:00 Uhr, Samstag 08:00–12:00 Uhr'
  );
  assert.deepEqual(hours.wed, [['07:30', '12:00'], ['13:30', '18:00']]);
  assert.deepEqual(hours.sat, [['08:00', '12:00']]);
  assert.deepEqual(hours.sun, []);
});

check('Ruhetag wird als geschlossen erkannt (coiffeur)', () => {
  const { hours } = parseOpeningHours(
    'Öffnungszeiten:\\nDienstag–Freitag 09:00–18:30 Uhr\\nSamstag 08:00–16:00 Uhr\\nMontag: Ruhetag\\nParkplätze: [Beschreibung]'
  );
  assert.deepEqual(hours.tue, [['09:00', '18:30']]);
  assert.deepEqual(hours.sat, [['08:00', '16:00']]);
  assert.deepEqual(hours.mon, [], 'Ruhetag wurde nicht als geschlossen übernommen');
});

check('unausgefüllte Platzhalter erzeugen keine Zeiten (physiotherapie)', () => {
  const { hours } = parseOpeningHours(
    'Öffnungszeiten: Montag–Freitag [Zeiten], Samstag [Zeiten oder "geschlossen"]\\nTermine nur nach Vereinbarung.'
  );
  assert.equal(hours, null, 'Aus Platzhaltern wurden Zeiten erfunden');
});

check('Notfallzeilen werden nicht zu Öffnungszeiten (handwerk)', () => {
  const { hours, ignored } = parseOpeningHours(
    'Bürozeiten: Montag–Freitag 07:30–12:00 und 13:30–17:00 Uhr\\nNotfalleinsätze: 24h/7 Tage — Notfallnummer [Nummer]'
  );
  assert.deepEqual(hours.mon, [['07:30', '12:00'], ['13:30', '17:00']]);
  assert.equal(ignored.length, 1, 'Die Notfallzeile wurde nicht als übergangen gemeldet');
  assert.match(ignored[0], /Notfalleins/);
});

check('nicht verwertete Zeilen werden gemeldet statt verschluckt (hotel)', () => {
  const { ignored } = parseOpeningHours(
    'Rezeption: 24 Stunden besetzt\\nRestaurant Frühstück: 06:30–10:30 Uhr\\nBar: [Zeiten eintragen]'
  );
  assert.ok(ignored.length >= 2, `Zeilen mit Zeiten ohne Tagesbezug müssen gemeldet werden, gemeldet: ${ignored.length}`);
});

check('Einzeltage und Kurzformen', () => {
  const { hours } = parseOpeningHours('Mo 08:00–12:00\nDi, Mi 09:00–17:00\nSo: geschlossen');
  assert.deepEqual(hours.mon, [['08:00', '12:00']]);
  assert.deepEqual(hours.tue, [['09:00', '17:00']]);
  assert.deepEqual(hours.wed, [['09:00', '17:00']]);
  assert.deepEqual(hours.sun, []);
});

check('ein Text ohne jede Zeitangabe liefert keinen Vorschlag', () => {
  const { hours } = parseOpeningHours('Adresse: Musterstrasse 1, 6000 Luzern\nParkplätze vorhanden.');
  assert.equal(hours, null);
});

check('der Parser schreibt nie mehr Tage als genannt', () => {
  const { hours } = parseOpeningHours('Samstag 09:00–13:00');
  assert.deepEqual(hours.sat, [['09:00', '13:00']]);
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sun'].forEach((day) => {
    assert.deepEqual(hours[day], [], `${day} wurde erfunden`);
  });
});

// ── Schreibpfad: der prüft, er rät nicht ─────────────────────────────────────

check('gültiges Raster wird übernommen und sortiert', () => {
  const { value, errors } = sanitizeOpeningHours({
    mon: [['13:30', '17:30'], ['08:30', '12:00']],
    sat: []
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(value.mon, [['08:30', '12:00'], ['13:30', '17:30']]);
  assert.deepEqual(value.sun, [], 'Nicht genannte Tage müssen als geschlossen im Ergebnis stehen');
});

check('null bedeutet zurücknehmen, nicht Fehler', () => {
  const { value, errors } = sanitizeOpeningHours(null);
  assert.equal(value, null);
  assert.deepEqual(errors, []);
});

check('Ende vor Beginn wird abgewiesen', () => {
  const { value, errors } = sanitizeOpeningHours({ mon: [['17:00', '09:00']] });
  assert.equal(value, undefined);
  assert.ok(errors.some((e) => e.startsWith('end_before_start')), errors.join());
});

check('überschneidende Zeitspannen werden abgewiesen', () => {
  const { value, errors } = sanitizeOpeningHours({ mon: [['08:00', '13:00'], ['12:00', '17:00']] });
  assert.equal(value, undefined);
  assert.ok(errors.some((e) => e.startsWith('overlapping_intervals')), errors.join());
});

check('unbekannte Tagesschlüssel werden abgewiesen', () => {
  const { value, errors } = sanitizeOpeningHours({ montag: [['08:00', '12:00']] });
  assert.equal(value, undefined);
  assert.ok(errors.some((e) => e.startsWith('unknown_day')), errors.join());
});

check('kaputte Zeitformate werden abgewiesen', () => {
  ['8:00', '0800', 'acht', '25:00'].forEach((bad) => {
    const { value } = sanitizeOpeningHours({ mon: [[bad, '17:00']] });
    assert.equal(value, undefined, `"${bad}" wurde angenommen`);
  });
});

check('der Parser liefert nur Werte, die der Schreibpfad auch annimmt', () => {
  const texte = [
    'Montag–Freitag 08:30–12:00 und 13:30–17:30 Uhr',
    'Öffnungszeiten: Montag–Freitag 07:30–12:00 und 13:30–18:00 Uhr, Samstag 08:00–12:00 Uhr',
    'Dienstag–Freitag 09:00–18:30 Uhr\nSamstag 08:00–16:00 Uhr\nMontag: Ruhetag',
    'Mittag: Dienstag–Sonntag 11:30–14:00 Uhr\nAbend: Dienstag–Sonntag 18:00–22:00 Uhr\nMontag: Ruhetag'
  ];
  texte.forEach((text) => {
    const { hours } = parseOpeningHours(text);
    assert.ok(hours, `kein Vorschlag für: ${text.slice(0, 40)}`);
    const { value, errors } = sanitizeOpeningHours(hours);
    assert.deepEqual(errors, [], `Parser erzeugte ungültige Daten für "${text.slice(0, 40)}": ${errors.join()}`);
    assert.ok(value);
  });
});

check('Darstellung nennt jeden Tag, auch geschlossene', () => {
  const text = formatOpeningHours({ mon: [['08:00', '12:00'], ['13:00', '17:00']], sat: [] });
  assert.match(text, /Montag: 08:00–12:00 und 13:00–17:00/);
  assert.match(text, /Samstag: geschlossen/);
  assert.match(text, /Sonntag: geschlossen/);
  assert.equal(text.split('\n').length, 7);
});

if (failed) {
  console.error(`Opening hours verification failed: ${failed}`);
  process.exit(1);
}
console.log('Opening hours verification passed.');
