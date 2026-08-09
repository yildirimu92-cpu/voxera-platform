'use strict';

// J5 / Schicht A: Öffnungszeiten.
//
// Zwei getrennte Aufgaben in einer Datei, weil sie dieselbe Struktur teilen:
//   parseOpeningHours()    schlaegt aus dem Freitext ein Wochenraster VOR
//   sanitizeOpeningHours() prueft, was der Kunde tatsaechlich bestaetigt hat
//
// Die Trennung ist der Kern von Entscheid F3: der Parser darf raten, der
// Schreibpfad nicht. Nichts, was der Parser liefert, wird gespeichert, bevor
// es durch sanitizeOpeningHours() gegangen ist -- und gespeichert wird nur,
// was der Kunde abgeschickt hat. Ein automatisch geparster Zeitplan, den
// niemand geprueft hat, wuerde sonst zur Aussage des Assistenten am Telefon.

const DAYS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

// Reihenfolge im Array = Wochentagsindex. Die Kurzformen stehen bewusst mit,
// die Vorlagentexte benutzen beide Schreibweisen.
const DAY_WORDS = Object.freeze([
  ['montag', 'mo'],
  ['dienstag', 'di'],
  ['mittwoch', 'mi'],
  ['donnerstag', 'do'],
  ['freitag', 'fr'],
  ['samstag', 'sa'],
  ['sonntag', 'so']
]);

// Zeilen, die zwar Zeiten enthalten, aber keine Oeffnungszeiten sind. In den
// Vorlagen stehen genau diese Faelle: Notfallnummern mit "24h/7", Fruehstuecks-
// und Restaurantzeiten im Hotel, telefonische Erreichbarkeit neben der
// Sprechstunde. Sie zu uebernehmen waere schlimmer als sie auszulassen -- der
// Kunde sieht im Vorschlag, was fehlt, und ergaenzt es.
const IGNORE_LINE = /notfall|panne|pikett|ransomware|systemausfall|st[oö]rung/i;

const MAX_INTERVALS_PER_DAY = 4;

function pad(value) {
  return String(value).padStart(2, '0');
}

// "9:00", "09.00", "0900" kommen alle vor. Rueckgabe immer HH:MM oder ''.
function normalizeTime(hour, minute) {
  const h = Number(hour);
  const m = Number(minute === undefined || minute === '' ? 0 : minute);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return '';
  if (h < 0 || h > 24 || m < 0 || m > 59) return '';
  if (h === 24 && m !== 0) return '';
  return `${pad(h)}:${pad(m)}`;
}

function minutesOf(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

function dayIndex(word) {
  const needle = String(word || '').toLowerCase().replace(/\./g, '');
  return DAY_WORDS.findIndex(([long, short]) => needle === long || needle === short);
}

function emptyWeek() {
  const week = {};
  DAYS.forEach((day) => { week[day] = []; });
  return week;
}

// Laengste Schreibweise zuerst, sonst faengt `mo` das `montag` weg.
const DAY_ALTERNATION = DAY_WORDS.flat().sort((a, b) => b.length - a.length).join('|');

// `\b` taugt hier nicht: JavaScript zaehlt Umlaute ohne /u nicht als
// Wortzeichen, deshalb sieht `\bfr\b` in "Frühstück" eine Wortgrenze und
// erklaerte die Fruehstueckszeiten eines Hotels zu Freitags-Oeffnungszeiten.
// Die Grenze wird darum ausdruecklich ueber die deutschen Buchstaben gebildet.
const NOT_LETTER_BEFORE = '(?<![A-Za-zÄÖÜäöüß])';
const NOT_LETTER_AFTER = '(?![A-Za-zÄÖÜäöüß])';

// Ein Tagesausdruck ist ein einzelner Tag oder eine Spanne, und beides steht
// mitten im Satz ("Samstag 08:00–16:00 Uhr"). Spannen werden zuerst gelesen und
// aus dem Text entfernt, damit ihre Endpunkte nicht ein zweites Mal als
// Einzeltage zaehlen. Sie duerfen die Woche umschlagen ("Samstag–Montag") --
// selten, aber billig zu unterstuetzen und sonst still falsch.
function daysFromExpression(text) {
  const day = `${NOT_LETTER_BEFORE}(${DAY_ALTERNATION})${NOT_LETTER_AFTER}\\.?`;
  const rangePattern = new RegExp(`${day}\\s*[–-]\\s*${day}`, 'gi');
  const singlePattern = new RegExp(day, 'gi');
  const days = new Set();

  const rest = String(text || '').replace(rangePattern, (match, from, to) => {
    const start = dayIndex(from);
    const end = dayIndex(to);
    if (start < 0 || end < 0) return match;
    for (let i = 0; i < 7; i += 1) {
      const index = (start + i) % 7;
      days.add(DAYS[index]);
      if (index === end) break;
    }
    return ' ';
  });

  let match = singlePattern.exec(rest);
  while (match) {
    const index = dayIndex(match[1]);
    if (index >= 0) days.add(DAYS[index]);
    match = singlePattern.exec(rest);
  }
  return [...days];
}

function intervalsFromLine(line) {
  const intervals = [];
  const pattern = /(\d{1,2})[:.](\d{2})\s*(?:Uhr)?\s*[–-]\s*(\d{1,2})[:.](\d{2})/gi;
  let match = pattern.exec(line);
  while (match) {
    const from = normalizeTime(match[1], match[2]);
    const to = normalizeTime(match[3], match[4]);
    if (from && to && minutesOf(to) > minutesOf(from)) intervals.push([from, to]);
    match = pattern.exec(line);
  }
  return intervals;
}

/**
 * Schlaegt aus einem Freitext ein Wochenraster vor.
 *
 * Bewusst zurueckhaltend: erkannt wird nur, was eindeutig Tag + Zeitspanne
 * nennt. Alles andere bleibt leer und der Kunde traegt es selbst ein. Der
 * Rueckgabewert nennt deshalb ausdruecklich, welche Zeilen nicht verwertet
 * wurden -- ohne diese Liste wuerde die Oberflaeche Vollstaendigkeit
 * suggerieren, die der Parser nicht liefern kann.
 */
function parseOpeningHours(freeText) {
  const source = String(freeText == null ? '' : freeText).replace(/\\n/g, '\n');
  const week = emptyWeek();
  const ignored = [];
  let matchedAnything = false;

  source.split('\n').forEach((rawLine) => {
    // Unausgefuellte Ausfuellmarkierungen tragen keine Aussage. Ohne diesen
    // Schritt liest der Parser aus `Samstag [Zeiten oder "geschlossen"]` ein
    // "Samstag geschlossen" heraus -- eine Behauptung, die im Vorlagentext
    // gerade nicht steht. Gleiche Behandlung wie im Prompt seit J2.
    const line = rawLine.replace(/\[[^\][\n]{1,80}\]/g, ' ').trim();
    if (!line) return;
    if (IGNORE_LINE.test(line)) {
      if (/\d{1,2}[:.]\d{2}|24\s*h|24\s*stunden/i.test(line)) ignored.push(line);
      return;
    }

    // Erst die Segmente: "Mo–Fr 08:00–12:00 und 13:30–17:30, Sa 08:00–12:00"
    // zerfaellt an Kommas in Teile mit je eigenem Tagesbezug. "und" trennt
    // dagegen zwei Zeitspannen desselben Tages und darf hier nicht schneiden.
    const segments = line.split(/[,;]/);
    let lineMatched = false;
    // Ein Komma trennt mal Segmente ("Mo–Fr 08:00–12:00, Sa 09:00–13:00"), mal
    // nur Tage, die sich eine Zeitspanne teilen ("Dienstag, Mittwoch 09:00–17:00").
    // Unterscheidungsmerkmal: nennt ein Segment Tage, aber keine Zeit, gehoert
    // es zum naechsten Segment, das eine nennt. Gilt nur innerhalb einer Zeile.
    let pendingDays = [];

    segments.forEach((segment) => {
      const days = daysFromExpression(segment);
      const closed = /ruhetag|geschlossen/i.test(segment);
      const intervals = intervalsFromLine(segment);

      if (!days.length && !pendingDays.length) return;
      const allDays = [...new Set([...pendingDays, ...days])];

      if (closed && !intervals.length) {
        allDays.forEach((day) => { week[day] = []; });
        pendingDays = [];
        lineMatched = true;
        matchedAnything = true;
        return;
      }
      if (!intervals.length) {
        if (days.length) pendingDays = allDays;
        return;
      }
      pendingDays = [];

      allDays.forEach((day) => {
        intervals.forEach((interval) => {
          const exists = week[day].some(([from, to]) => from === interval[0] && to === interval[1]);
          if (!exists && week[day].length < MAX_INTERVALS_PER_DAY) week[day].push(interval);
        });
      });
      lineMatched = true;
      matchedAnything = true;
    });

    if (!lineMatched && /\d{1,2}[:.]\d{2}|24\s*h|24\s*stunden/i.test(line)) ignored.push(line);
  });

  DAYS.forEach((day) => {
    week[day].sort((a, b) => minutesOf(a[0]) - minutesOf(b[0]));
  });

  return { hours: matchedAnything ? week : null, ignored };
}

/**
 * Prueft, was gespeichert werden soll. Anders als der Parser raet diese
 * Funktion nichts: was nicht der Form entspricht, wird abgewiesen und der
 * Aufrufer antwortet mit einem Fehler.
 */
function sanitizeOpeningHours(input) {
  if (input === null) return { value: null, errors: [] };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { value: undefined, errors: ['opening_hours_not_an_object'] };
  }

  const errors = [];
  const week = emptyWeek();

  Object.keys(input).forEach((day) => {
    if (!DAYS.includes(day)) errors.push(`unknown_day:${day}`);
  });

  DAYS.forEach((day) => {
    const raw = input[day];
    if (raw === undefined || raw === null) return;
    if (!Array.isArray(raw)) {
      errors.push(`not_a_list:${day}`);
      return;
    }
    if (raw.length > MAX_INTERVALS_PER_DAY) {
      errors.push(`too_many_intervals:${day}`);
      return;
    }
    const intervals = [];
    raw.forEach((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2) {
        errors.push(`malformed_interval:${day}`);
        return;
      }
      const from = String(entry[0] || '').trim();
      const to = String(entry[1] || '').trim();
      if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) {
        errors.push(`malformed_time:${day}`);
        return;
      }
      if (minutesOf(from) < 0 || minutesOf(to) < 0 || Number(from.slice(0, 2)) > 24 || Number(to.slice(0, 2)) > 24) {
        errors.push(`time_out_of_range:${day}`);
        return;
      }
      if (minutesOf(to) <= minutesOf(from)) {
        errors.push(`end_before_start:${day}`);
        return;
      }
      intervals.push([from, to]);
    });
    intervals.sort((a, b) => minutesOf(a[0]) - minutesOf(b[0]));
    // Ueberschneidungen sind kein Schoenheitsfehler: aus ihnen laesst sich
    // "ausserhalb der Oeffnungszeiten" nicht eindeutig bestimmen, und genau
    // darauf baut sprechstunden_modus auf.
    for (let i = 1; i < intervals.length; i += 1) {
      if (minutesOf(intervals[i][0]) < minutesOf(intervals[i - 1][1])) {
        errors.push(`overlapping_intervals:${day}`);
        break;
      }
    }
    week[day] = intervals;
  });

  if (errors.length) return { value: undefined, errors };
  return { value: week, errors: [] };
}

const DAY_LABELS = Object.freeze({
  mon: 'Montag', tue: 'Dienstag', wed: 'Mittwoch', thu: 'Donnerstag',
  fri: 'Freitag', sat: 'Samstag', sun: 'Sonntag'
});

function formatOpeningHours(week) {
  if (!week || typeof week !== 'object') return '';
  return DAYS.map((day) => {
    const intervals = Array.isArray(week[day]) ? week[day] : [];
    const times = intervals.length
      ? intervals.map(([from, to]) => `${from}–${to}`).join(' und ')
      : 'geschlossen';
    return `${DAY_LABELS[day]}: ${times}`;
  }).join('\n');
}

module.exports = {
  DAYS,
  DAY_LABELS,
  MAX_INTERVALS_PER_DAY,
  parseOpeningHours,
  sanitizeOpeningHours,
  formatOpeningHours
};
