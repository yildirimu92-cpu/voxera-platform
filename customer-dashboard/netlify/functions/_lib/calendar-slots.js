'use strict';

// Ein Halbtag ist kein unteilbarer Block.
//
// Befund vom 2026-08-12 auf #951. `checkAvailability()` beantwortet die Frage
// "ist dieser Zeitraum frei" mit `busy.length === 0` -- also fuer den ganzen
// angefragten Block auf einmal. Fuer eine Anfrage in Termindauer ("Dienstag
// 10:00 bis 10:30") ist das genau richtig. Fuer einen Halbtag ist es falsch:
// ein einziger 30-Minuten-Termin um 09:00 macht den kompletten Vormittag
// "unverfuegbar", obwohl sieben von acht Slots frei sind.
//
// Das waere fuer sich genommen ungenau. Zusammen mit Schritt 4 des
// Kalenderblocks ist es ein Fehler mit System: dort steht, dass der Agent bei
// vagen Terminwuenschen ("naechste Woche", "irgendwann") nach einem HALBTAG
// fragen und Vormittag und Nachmittag getrennt pruefen soll. Der Prompt lenkt
// die unklaren Faelle also systematisch in genau die Fensterform, in der die
// Antwort am haeufigsten falsch ist -- und der Anrufende hoert "da ist leider
// nichts frei" fuer einen halben Tag, an dem der Kalender fast leer ist.
//
// Dieses Modul beantwortet deshalb eine andere Frage als `checkAvailability()`:
// nicht "ist der Block frei", sondern "welche buchbaren Termine liegen in
// diesem Block".
//
// ZEITZONEN: Hier wird bewusst KEINE eigene Zeitzonenrechnung gemacht. Die
// Kandidaten werden vom Fensteranfang in Schritten der Termindauer gezaehlt --
// reine Millisekundenarithmetik, die von Sommerzeit nicht beruehrt wird. Ob ein
// Kandidat in den erlaubten Zeiten liegt, entscheidet weiterhin
// `bookingWindowError()` aus booking-window.js, das die Zeitzone des Kunden
// kennt und dessen DST-Verhalten in verify-booking-window.mjs abgesichert ist.
// Eine zweite Stelle mit eigener Zeitzonenlogik waere eine zweite Stelle, an
// der die Sommerzeit falsch sein kann.
//
// Der Preis dieser Entscheidung: die Slots liegen auf dem Raster des
// ANGEFRAGTEN Fensters, nicht auf dem der Oeffnungszeiten. Fragt der Agent
// 08:00--12:00 bei 30 Minuten Dauer, kommen 08:00, 08:30, 09:00 heraus; fragt
// er 08:07--12:00, kommen 08:07, 08:37 heraus. Bei den Halbtagsanfragen, die
// Schritt 4 erzeugt, faellt das nicht an -- die beginnen zur vollen Stunde.

const { bookingWindowError } = require('./booking-window');

// Drei Vorschlaege. Der Agent spricht sie vor, und eine vorgelesene Liste mit
// acht Uhrzeiten ist am Telefon keine Hilfe, sondern eine Zumutung. Die
// Gesamtzahl steht separat in der Antwort, damit der Agent "und noch weitere"
// sagen kann, ohne sie alle aufzuzaehlen.
const SLOT_LIMIT = 3;

// Schutz gegen eine Endlosschleife, falls dieses Modul je ohne die
// 8-Stunden-Schranke aus validateWindow() aufgerufen wird. Bei 8 Stunden und
// der kuerzesten sinnvollen Dauer ist die echte Obergrenze weit darunter.
const MAX_CANDIDATES = 500;

function millis(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

// Ohne konfigurierte Termindauer gibt es kein Raster. Dann ist der einzige
// Kandidat das ganze angefragte Fenster -- und das Ergebnis ist exakt das
// bisherige Verhalten. Ein fehlender Wert soll die Verfuegbarkeitspruefung
// nicht erraten lassen, wie lang ein Termin ist.
function slotDurationMinutes(startIso, endIso, settings) {
  const configured = Number(settings?.appointment_duration_minutes || 0);
  if (configured > 0) return configured;
  const from = millis(startIso);
  const to = millis(endIso);
  if (from === null || to === null || to <= from) return 0;
  return Math.max(1, Math.round((to - from) / 60000));
}

// Zerlegt [startIso, endIso) in aufeinanderfolgende Termine der konfigurierten
// Dauer. Ein angebrochener Rest am Ende faellt weg: ein Fenster von 100 Minuten
// traegt bei 30 Minuten Dauer drei Termine, nicht dreieinhalb.
function slotCandidates(startIso, endIso, durationMinutes) {
  const from = millis(startIso);
  const to = millis(endIso);
  const step = Number(durationMinutes) * 60000;
  if (from === null || to === null || !Number.isFinite(step) || step <= 0) return [];
  const slots = [];
  for (let cursor = from; cursor + step <= to && slots.length < MAX_CANDIDATES; cursor += step) {
    slots.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + step).toISOString() });
  }
  return slots;
}

// Findet die Betriebssperre (Schliessung, Terminpause), die einen Zeitraum
// ueberlappt. Die Liste stammt aus `loadBlockingUpdates()` und ist bereits auf
// den angefragten Zeitraum eingegrenzt; diese Pruefung stellt dieselbe Frage
// noch einmal pro Termin.
//
// Stand bis zum 2026-08-12 in calendar-tool.js. Hierher gezogen, weil "welcher
// Teil des Fensters ist gesperrt" dieselbe Frage ist, die dieses Modul fuer die
// Kalendertermine beantwortet -- und der Slot-Filter sie pro Termin stellen
// muss statt einmal fuer den ganzen Block.
function blockingUpdateFor(updates, startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return (updates || []).find((item) => {
    const from = new Date(item.starts_at).getTime();
    const to = new Date(item.ends_at).getTime();
    return Number.isFinite(from) && Number.isFinite(to) && from < end && to > start;
  }) || null;
}

// Erste Stufe: welche Kandidaten sind ueberhaupt buchbar, OHNE den Kalender zu
// befragen? Buchungszeiten, Oeffnungszeiten und Betriebssperren sind hier
// bekannt, der Kalender des Kunden noch nicht.
//
// Diese Stufe behebt nebenbei dieselbe Fehlerklasse an einer zweiten Stelle:
// `bookingWindowError()` wurde bisher auf das ganze Fenster angewandt. Ein
// Halbtag 08:00--12:00 bei Buchungszeiten ab 09:00 fiel damit komplett durch,
// obwohl 09:00--12:00 buchbar ist. Pro Termin gefragt, faellt nur der Teil weg,
// der wirklich ausserhalb liegt.
//
// Der Rueckgabewert trennt "es gab nie einen Kandidaten" (Fenster kuerzer als
// die Termindauer) von "alle Kandidaten sind gesperrt" -- das sind zwei
// verschiedene Auskuenfte an den Anrufenden.
function bookableSlots(startIso, endIso, settings, openingHours, blockingUpdates) {
  const duration = slotDurationMinutes(startIso, endIso, settings);
  const candidates = slotCandidates(startIso, endIso, duration);
  const slots = [];
  let windowReason = null;
  for (const slot of candidates) {
    if (blockingUpdateFor(blockingUpdates, slot.start, slot.end)) {
      windowReason = windowReason || 'operational_block';
      continue;
    }
    const error = bookingWindowError(slot.start, slot.end, settings, openingHours);
    if (error) {
      windowReason = windowReason || error;
      continue;
    }
    slots.push(slot);
  }
  return { slots, candidates, duration, windowReason };
}

// Zweite Stufe: welche der buchbaren Termine sind im Kalender wirklich frei?
//
// Die Puffer werden hier pro Termin angewandt, nicht einmal auf das ganze
// Fenster. `bufferedWindow()` vergroessert nur die ABFRAGE, damit ein Termin
// kurz vor dem Fensterrand ueberhaupt im busy-Array auftaucht; ob er einen
// konkreten Slot blockiert, entscheidet sich erst hier.
function freeSlots(slots, busy, settings) {
  const before = Number(settings?.buffer_before_minutes || 0) * 60000;
  const after = Number(settings?.buffer_after_minutes || 0) * 60000;
  const blocks = [];
  for (const entry of busy || []) {
    const from = millis(entry?.start);
    const to = millis(entry?.end);
    // Ein Eintrag, den wir nicht lesen koennen, ist kein freier Zeitraum. Im
    // Zweifel gilt der ganze Block als belegt -- lieber eine verpasste
    // Terminmoeglichkeit als eine Doppelbuchung im Kalender des Kunden.
    if (from === null || to === null) return [];
    blocks.push([from, to]);
  }
  return (slots || []).filter((slot) => {
    const from = millis(slot.start);
    const to = millis(slot.end);
    if (from === null || to === null) return false;
    return !blocks.some(([busyFrom, busyTo]) => from - before < busyTo && to + after > busyFrom);
  });
}

module.exports = {
  SLOT_LIMIT,
  blockingUpdateFor,
  bookableSlots,
  freeSlots,
  _test: { slotCandidates, slotDurationMinutes }
};
