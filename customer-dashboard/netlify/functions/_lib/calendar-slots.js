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
// Die Kandidaten laufen deshalb vom Fensteranfang los -- ZUSAETZLICH aber auch
// vom Anfang jeder erlaubten Zeitspanne des Tages.
//
// Der erste Stand hatte nur den Fensteranfang, und das war zu wenig. Codex hat
// am 12.08. den Fall gezeigt: Buchungszeiten 08:15--08:45, Anfrage
// 08:00--12:00, 30 Minuten Dauer. Die Kandidaten hiessen 08:00 und 08:30, nie
// 08:15 -- `bookingWindowError()` verwarf beide, und availability meldete "gar
// nichts frei", waehrend book denselben Termin 08:15--08:45 anstandslos
// gebucht haette. Das ist dieselbe Fehlerklasse wie der Befund, den dieses
// Modul behebt: eine Ablehnung, die keine ist.
//
// Der Anker wird aus dem Fensteranfang HERGELEITET, nicht selbst gerechnet:
// `zonedParts()` liefert die Minute-im-Tag des Fensteranfangs, die Differenz
// zur erlaubten Zeitspanne ist eine Millisekundenaddition. Eine Gegenprobe mit
// `zonedParts()` verwirft den Anker, falls dazwischen die Uhr umgestellt wurde.

const { bookingWindowError, bookingTimingError, allowedIntervals, zonedParts } = require('./booking-window');

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

// Die Startpunkte, von denen aus durchgezaehlt wird: der Fensteranfang und der
// Anfang jeder erlaubten Zeitspanne des Tages, die im Fenster liegt.
//
// Ohne den zweiten Teil meldet availability "nichts frei" fuer Zeiten, die book
// akzeptieren wuerde -- siehe der Kopfkommentar. Anker ausserhalb des Fensters
// faellt weg, ebenso einer, den die Gegenprobe nicht bestaetigt.
function slotAnchors(startIso, endIso, settings, openingHours) {
  const windowStart = millis(startIso);
  const windowEnd = millis(endIso);
  if (windowStart === null || windowEnd === null) return [];
  const timeZone = String(settings?.timezone || 'Europe/Zurich');
  const anchors = new Set([windowStart]);

  // BEIDE lokalen Tage des Zeitraums, nicht nur der des Fensteranfangs.
  //
  // Codex-Befund vom 12.08., direkt nach dem ersten Anker-Fix: bei einem
  // Fenster Montag 23:00 -- Dienstag 07:00 wurden nur die Montags-Zeiten
  // gelesen. Eine Dienstags-Zeitspanne 01:15--01:45 bekam keinen Anker, das
  // Fensterraster traf nur 01:00 und 01:30 -- wieder "gar nichts frei" fuer
  // einen Termin, den book anstandslos gebucht haette.
  //
  // `bookingWindowError()` entscheidet pro Termin nach DESSEN Wochentag; die
  // Ankerbildung muss derselben Regel folgen. Mehr als zwei lokale Tage kann
  // ein Zeitraum nicht beruehren, dafuer sorgt die 8-Stunden-Schranke aus
  // validateWindow(). Jeder Tag wird von seinem eigenen Bezugspunkt aus
  // hergeleitet, damit die Differenz klein bleibt und keine Datumsrechnung
  // noetig ist.
  for (const reference of [{ iso: startIso, ms: windowStart }, { iso: endIso, ms: windowEnd }]) {
    let parts;
    try { parts = zonedParts(reference.iso, timeZone); }
    catch (_error) { continue; }
    if (!parts.dayKey) continue;
    for (const [from] of allowedIntervals(settings, openingHours, parts.dayKey) || []) {
      const anchor = reference.ms + (from - parts.minutes) * 60000;
      if (anchor <= windowStart || anchor >= windowEnd) continue;
      // Gegenprobe: liegt der hergeleitete Zeitpunkt wirklich auf `from`? Eine
      // Zeitumstellung zwischen Bezugspunkt und Anker wuerde ihn verschieben,
      // und ein um eine Stunde verrutschter Vorschlag ist schlimmer als keiner.
      try {
        if (zonedParts(new Date(anchor).toISOString(), timeZone).minutes !== from) continue;
      } catch (_error) { continue; }
      anchors.add(anchor);
    }
  }
  return [...anchors].sort((a, b) => a - b);
}

// Zerlegt [startIso, endIso) in aufeinanderfolgende Termine der konfigurierten
// Dauer, von jedem Anker aus. Ein angebrochener Rest am Ende faellt weg: ein
// Fenster von 100 Minuten traegt bei 30 Minuten Dauer drei Termine, nicht
// dreieinhalb.
//
// Mehrere Anker koennen denselben Termin erzeugen; doppelte fallen raus, und
// sortiert wird nach Beginn, damit der Agent die frueheste Zeit zuerst nennt.
function slotCandidates(startIso, endIso, durationMinutes, anchors = null) {
  const to = millis(endIso);
  const step = Number(durationMinutes) * 60000;
  const starts = anchors || [millis(startIso)];
  if (to === null || !Number.isFinite(step) || step <= 0) return [];
  const gesehen = new Set();
  for (const anchor of starts) {
    if (anchor === null) continue;
    for (let cursor = anchor; cursor + step <= to && gesehen.size < MAX_CANDIDATES; cursor += step) {
      gesehen.add(cursor);
    }
  }
  return [...gesehen].sort((a, b) => a - b)
    .map((cursor) => ({ start: new Date(cursor).toISOString(), end: new Date(cursor + step).toISOString() }));
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
// `now` ist einspeisbar, damit die Vorlaufpruefung pruefbar bleibt. Ein
// Testdatum in der Zukunft waere die Alternative gewesen -- es verfaellt aber
// mit der Zeit und macht den Test irgendwann still gruen aus dem falschen
// Grund.
function bookableSlots(startIso, endIso, settings, openingHours, blockingUpdates, now = Date.now()) {
  const duration = slotDurationMinutes(startIso, endIso, settings);
  const anchors = slotAnchors(startIso, endIso, settings, openingHours);
  const candidates = slotCandidates(startIso, endIso, duration, anchors);
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
    // Vorlauf und Buchungshorizont ebenfalls pro Termin. Sie standen bis zum
    // 2026-08-12 in validateWindow() und galten damit fuer den Fensteranfang --
    // ein Nachmittag, der innerhalb des Vorlaufs beginnt, fiel komplett weg,
    // obwohl seine spaeteren Termine buchbar sind. Am anderen Ende dasselbe
    // umgekehrt: ein Fenster, das den Buchungshorizont ueberschreitet, haette
    // Termine jenseits davon angeboten, die `book` dann ablehnt.
    const timingError = bookingTimingError(slot.start, settings, now);
    if (timingError) {
      windowReason = windowReason || timingError;
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
  _test: { slotCandidates, slotDurationMinutes, slotAnchors }
};
