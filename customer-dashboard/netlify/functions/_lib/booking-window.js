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

// `zonedParts` steht seit dem 2026-08-12 oeffentlich und nicht mehr nur unter
// `_test`: calendar-slots.js braucht die Minute-im-Tag des Fensteranfangs, um
// Terminkandidaten an den erlaubten Zeiten auszurichten. Der Alternativweg
// waere eine zweite Zeitzonenrechnung im Slot-Modul gewesen -- also genau die
// Doppelquelle, die dieses Modul vermeidet.
module.exports = { bookingWindowError, allowedIntervals, zonedParts, _test: { zonedParts, intervalsFor, intersect, toMinutes } };
