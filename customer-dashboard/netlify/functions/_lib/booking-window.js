'use strict';

// Buchungsfenster: wann darf der Assistent ueberhaupt einen Termin setzen?
//
// Entscheid vom 2026-08-10, nach dem Klick-Test: Oeffnungszeiten und
// Buchungszeiten beantworten ZWEI verschiedene Fragen und bleiben deshalb zwei
// Felder.
//
//   customers.ai_opening_hours          -> "ist offen"      (Geschaeftsprofil)
//   calendar_settings.business_hours    -> "darf gebucht werden"
//
// Sie duerfen sich aber nicht widersprechen. Die Regel ist bewusst
// unsymmetrisch: **Buchungszeiten sind eine Teilmenge der Oeffnungszeiten, nie
// eine Erweiterung.** Sagt das Profil fuer einen Tag "geschlossen", darf dort
// nicht gebucht werden, egal was in business_hours steht.
//
// Anlass: beim geprueften Kunden stand in business_hours Mo-Fr 08-17, waehrend
// das Geschaeftsprofil fuer dieselben Tage "geschlossen" anzeigte -- zwei
// Wahrheiten ueber dieselbe Sache. Ein Leser, der nur business_hours prueft,
// haette diesen Widerspruch festgeschrieben statt aufgeloest.
//
// Bis zum 2026-08-10 hatte `business_hours` ueberhaupt keinen Leser: die
// Terminbuchung pruefte keinerlei Zeiten. Der Agent konnte 03:00 Uhr
// bestaetigen, sofern im verbundenen Kalender nichts eingetragen war.

const DAY_KEYS = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

// Intl liefert den Wochentag sprachabhaengig; 'en-CA' ist hier nur Traeger fuer
// ein stabiles, kurzes Format. Gerechnet wird ausschliesslich mit der Zeitzone
// aus calendar_settings -- niemals mit der Serverzeit, die auf Netlify UTC ist.
function zonedParts(iso, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = {};
  for (const part of formatter.formatToParts(new Date(iso))) parts[part.type] = part.value;
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  // 24:00 kommt bei hour12:false als '24' zurueck, wenn Mitternacht getroffen
  // wird; das ist derselbe Zeitpunkt wie 00:00 des Folgetags.
  const hour = Number(parts.hour) % 24;
  return {
    dayKey: weekdayIndex >= 0 ? DAY_KEYS[weekdayIndex] : '',
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute)
  };
}

function toMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
}

// Ein Wochenraster ist {mon: [["08:00","12:00"], ["13:00","17:00"]], ...}.
// Unbrauchbare Eintraege werden verworfen statt geraten -- ein kaputter Wert
// darf nie zu einem weiteren erlaubten Zeitfenster fuehren.
function intervalsFor(week, dayKey) {
  if (!week || typeof week !== 'object' || Array.isArray(week)) return null;
  const raw = week[dayKey];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((pair) => (Array.isArray(pair) && pair.length === 2 ? [toMinutes(pair[0]), toMinutes(pair[1])] : null))
    .filter((pair) => pair && pair[0] !== null && pair[1] !== null && pair[1] > pair[0]);
}

// Schnittmenge zweier Intervalllisten. Fehlt das Geschaeftsprofil ganz (kein
// bestaetigtes Wochenraster), fuehren die Buchungszeiten allein -- dann gibt es
// keine zweite Quelle, der sie widersprechen koennten.
function intersect(bookingIntervals, openingIntervals) {
  if (openingIntervals === null) return bookingIntervals;
  const result = [];
  for (const [bookStart, bookEnd] of bookingIntervals) {
    for (const [openStart, openEnd] of openingIntervals) {
      const start = Math.max(bookStart, openStart);
      const end = Math.min(bookEnd, openEnd);
      if (end > start) result.push([start, end]);
    }
  }
  return result;
}

function allowedIntervals(settings, openingHours, dayKey) {
  const booking = intervalsFor(settings?.business_hours, dayKey);
  // Kein Wochenraster in calendar_settings -> keine Einschraenkung aus dieser
  // Quelle. Das ist der Zustand vor der Ersteinrichtung und darf die Buchung
  // nicht blockieren; die Oeffnungszeiten greifen dann trotzdem.
  if (booking === null) return intervalsFor(openingHours, dayKey);
  return intersect(booking, intervalsFor(openingHours, dayKey));
}

// Prueft, ob [startIso, endIso) vollstaendig in einem erlaubten Fenster liegt.
// Rueckgabe null = in Ordnung, sonst ein Fehlercode.
//
// Bewusst "vollstaendig in EINEM Fenster": ein Termin, der ueber die
// Mittagspause laeuft, ist keine Buchung in zwei Fenstern, sondern eine
// Buchung ueber eine Pause hinweg.
function bookingWindowError(startIso, endIso, settings, openingHours) {
  const timeZone = String(settings?.timezone || 'Europe/Zurich');
  let start;
  let end;
  try {
    start = zonedParts(startIso, timeZone);
    end = zonedParts(endIso, timeZone);
  } catch (_error) {
    // Ungueltige Zeitzone: nicht stillschweigend durchlassen.
    return 'calendar_timezone_invalid';
  }
  if (!start.dayKey) return 'calendar_time_window_invalid';
  // Ende exakt um Mitternacht gehoert noch zum Vortag.
  const endsAtMidnight = end.minutes === 0 && end.date !== start.date;
  if (!endsAtMidnight && end.date !== start.date) return 'calendar_booking_outside_hours';

  const windows = allowedIntervals(settings, openingHours, start.dayKey);
  // Leer heisst: an diesem Tag ist keine Buchung erlaubt. Das ist die
  // Ausgangslage bei "geschlossen" im Profil -- und der Grund, warum die
  // Schnittmenge nie erweitern darf.
  if (!windows.length) return 'calendar_closed_on_this_day';

  const endMinutes = endsAtMidnight ? 24 * 60 : end.minutes;
  const fits = windows.some(([from, to]) => start.minutes >= from && endMinutes <= to);
  return fits ? null : 'calendar_booking_outside_hours';
}

// Vorlauf und Buchungshorizont: darf ein Termin zu DIESEM Zeitpunkt gesetzt
// werden? Anders als bookingWindowError() geht es nicht um die Uhrzeit im
// Wochenraster, sondern um den Abstand zu jetzt.
//
// Stand bis zum 2026-08-12 in validateWindow() und galt damit fuer den ANFANG
// des angefragten Zeitraums. Codex-Befund: bei einem Halbtag ist das die
// gleiche Unteilbarkeit wie beim Kalender selbst. Ruft jemand um 13:00 an und
// der Agent prueft 14:00--18:00, verwarf der Zweistundenvorlauf den ganzen
// Nachmittag -- obwohl ab 15:00 alles buchbar ist. Mit der Halbtagsanweisung
// aus #951 ist das kein Randfall, sondern der Normalfall.
//
// Pro Termin gefragt faellt nur weg, was wirklich zu frueh oder zu weit weg
// ist. `book` und `reschedule` fragen weiterhin fuer den einen Termin, den sie
// setzen -- dort sind Fenster und Termin dasselbe.
function bookingTimingError(startIso, settings, now = Date.now()) {
  const start = new Date(startIso).getTime();
  if (!Number.isFinite(start)) return 'calendar_time_window_invalid';
  const notice = Number(settings?.minimum_notice_minutes || 0) * 60000;
  if (start < now + notice) return 'calendar_minimum_notice_not_met';
  const horizon = Number(settings?.booking_horizon_days || 60) * 86400000;
  if (start > now + horizon) return 'calendar_booking_horizon_exceeded';
  return null;
}

// `zonedParts` steht seit dem 2026-08-12 oeffentlich und nicht mehr nur unter
// `_test`: calendar-slots.js braucht die Minute-im-Tag des Fensteranfangs, um
// Terminkandidaten an den erlaubten Zeiten auszurichten. Der Alternativweg
// waere eine zweite Zeitzonenrechnung im Slot-Modul gewesen -- also genau die
// Doppelquelle, die dieses Modul vermeidet.
// ── Die Spanne des ANGEFRAGTEN Zeitraums ────────────────────────────────────
//
// Steht hier und nicht in calendar-tool.js, weil dort `@supabase/supabase-js`
// haengt: die Pruefskripte koennen die Datei nicht laden, und die Regel waere
// nur ueber eine Textsuche im Quelltext pruefbar. Was sich rechnen laesst,
// gehoert dorthin, wo man es rechnen lassen kann.

// Obergrenze fuer den angefragten Zeitraum. Steht als "hoechstens 8 Stunden"
// auch im Kalenderblock und in der Feldbeschreibung des Werkzeugs -- wer sie
// hier aendert, muss dort mitziehen.
const MAX_WINDOW_MS = 8 * 60 * 60 * 1000;

// Vergroessert den ABFRAGE-Zeitraum um die Puffer. Der Termin selbst bleibt
// unveraendert -- gefragt wird nur weiter, damit ein angrenzender Termin den
// Puffer verletzt und auffaellt.
function bufferedWindow(startIso, endIso, settings = {}) {
  return {
    start: new Date(new Date(startIso).getTime() - Number(settings.buffer_before_minutes || 0) * 60000).toISOString(),
    end: new Date(new Date(endIso).getTime() + Number(settings.buffer_after_minutes || 0) * 60000).toISOString()
  };
}

/**
 * Prueft die SPANNE des angefragten Zeitraums -- nicht seine Lage im Kalender,
 * das macht bookingWindowError(), und nicht seinen Vorlauf, das macht
 * bookingTimingError().
 *
 * ── Gemessen wird der ANGEFRAGTE Zeitraum, NICHT der gepufferte ─────────────
 *
 * Diese Schranke bewacht die ZUSAGE an das Modell, nicht die Abfrage beim
 * Anbieter. Der Werkzeugvertrag sagt "start bis end hoechstens 8 Stunden" -- ein
 * Modell, das sich daran haelt, muss durchkommen. Wuerde hier die gepufferte
 * Spanne gemessen, scheiterte eine vertragskonforme Anfrage ueber genau acht
 * Stunden, sobald ein Puffer konfiguriert ist: das Modell bekaeme
 * `calendar_time_window_too_large` fuer etwas, das der Prompt ihm ausdruecklich
 * erlaubt, und haette keine Moeglichkeit, es zu vermeiden.
 *
 * Am 12.08. war genau das kurzzeitig gebaut -- mit der Begruendung, die
 * Schranke muesse bewachen, was tatsaechlich abgefragt wird. Die Begruendung
 * war falsch herum: eine Zusage und eine Abfragegrenze sind zwei verschiedene
 * Dinge, und diese Funktion ist die Zusage.
 *
 * `>` und nicht `>=`: "hoechstens 8 Stunden" heisst, dass genau 8 Stunden
 * erlaubt sind. Der Kalenderblock sagt dem Modell genau das.
 *
 * Dass die Abfrage um die Puffer groesser ausfaellt, ist damit unbeaufsichtigt.
 * Bei zehn Minuten ist das folgenlos; bei zwei Stunden Puffer wird aus acht
 * Stunden eine Zwoelfstundenabfrage. Das braucht eine ZWEITE, groessere Grenze
 * oder eine Schranke auf den Puffern selbst -- nicht das Schrumpfen dieser hier.
 * Eigenes Ticket.
 *
 * @returns {null|'calendar_time_window_invalid'|'calendar_time_window_too_large'}
 */
function windowSpanError(startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'calendar_time_window_invalid';
  if (end <= start) return 'calendar_time_window_invalid';
  return (end - start) > MAX_WINDOW_MS ? 'calendar_time_window_too_large' : null;
}

module.exports = {
  bookingWindowError,
  bookingTimingError,
  allowedIntervals,
  zonedParts,
  bufferedWindow,
  windowSpanError,
  MAX_WINDOW_MS,
  _test: { zonedParts, intervalsFor, intersect, toMinutes }
};
