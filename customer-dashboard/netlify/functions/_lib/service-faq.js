'use strict';

// J7: Leistungen als Eintraege, haeufige Fragen als Frage-Antwort-Paare.
//
// Zwei Aufgaben, die bewusst getrennt bleiben:
//
//   parse*  liest aus dem gewachsenen Freitext einen VORSCHLAG. Es darf raten,
//           muss aber melden, was es nicht verwerten konnte -- ein Vorschlag,
//           der Zeilen stillschweigend verschluckt, sieht vollstaendig aus und
//           ist es nicht.
//   sanitize* prueft, was gespeichert werden soll. Es darf NICHT raten. Was
//           nicht der Form entspricht, wird abgewiesen und nicht
//           zurechtgebogen -- aus einer stillschweigend reparierten Antwort
//           wuerde eine Auskunft am Telefon.
//
// Kalibriert an den 19 echten Vorlagentexten (industry_templates.
// default_services / default_booking_faq, gelesen 09.08.) und am einzigen
// Kunden, der heute eigene Texte traegt.

const MAX_SERVICES = 40;
const MAX_SERVICE_LENGTH = 200;
const MAX_FAQ = 30;
const MAX_QUESTION_LENGTH = 200;
const MAX_ANSWER_LENGTH = 600;

// Die Vorlagentexte tragen den Zeilenumbruch als zwei Zeichen -- Backslash und
// n -- und nicht als Umbruch. Der Admin-Wizard rechnet das beim Anzeigen um
// (_wNl in index.html), die Datenbank sieht es nie. Ein Kundentext, der aus
// einer Vorlage stammt und nie durch dieses Formular gelaufen ist, enthaelt
// deshalb beide Schreibweisen. Wer nur an \n splittet, bekommt eine einzige
// sehr lange Zeile.
function splitLines(value) {
  return String(value == null ? '' : value)
    .replace(/\\n/g, '\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// Aufzaehlungszeichen aller in den Vorlagen vorkommenden Formen, plus die
// Nummerierung, die Kunden von Hand schreiben.
const BULLET = /^\s*(?:[-–—•*]|\d{1,2}[.)])\s+/;

// Gleiche Fassung wie im Prompt-Builder (BRACKET_PLACEHOLDER): keine Umbrueche,
// keine Verschachtelung, hoechstens 80 Zeichen.
const BRACKET_PLACEHOLDER = /\[[^\][\n]{1,80}\]/;

const FAQ_HEADER = /^h(?:ä|ae)ufige\s+fragen\s*:?\s*$/i;

function stripBullet(line) {
  return line.replace(BULLET, '').trim();
}

function cleanValue(value, limit) {
  // Geschweifte Klammern raus, sonst schriebe eine Antwort einen Platzhalter in
  // den Prompt, den der Builder anschliessend aufloest.
  return String(value == null ? '' : value).replace(/[{}]/g, '').trim().slice(0, limit);
}

// ── Leistungen ──────────────────────────────────────────────────────────────

function parseServiceList(text) {
  const items = [];
  const ignored = [];
  splitLines(text).forEach((raw) => {
    const line = stripBullet(raw);
    if (!line) return;
    // Eine Vorlage (generic) enthaelt statt Leistungen eine Anweisung an die
    // Person, die sie ausfuellt: "Bitte die wichtigsten Leistungen ...
    // eintragen." Solche Saetze sind an ihrer Laenge erkennbar -- eine echte
    // Leistungszeile ist in allen 19 Vorlagen kuerzer.
    if (line.length > MAX_SERVICE_LENGTH) {
      ignored.push(line);
      return;
    }
    // Eine unausgefuellte Markierung ("Produktverkauf: [Marken eintragen]")
    // wird gemeldet statt entfernt: uebrig bliebe sonst "Produktverkauf:" --
    // eine halbe Angabe, die vollstaendig aussieht.
    if (BRACKET_PLACEHOLDER.test(line)) {
      ignored.push(line);
      return;
    }
    if (items.length >= MAX_SERVICES) {
      ignored.push(line);
      return;
    }
    items.push(line);
  });
  return { items, ignored };
}

function sanitizeServiceList(value) {
  if (value == null || value === '') return { value: null, errors: [] };
  if (!Array.isArray(value)) return { value: null, errors: ['service_list_not_an_array'] };
  if (value.length > MAX_SERVICES) return { value: null, errors: ['service_list_too_long'] };
  const items = [];
  const errors = [];
  value.forEach((entry) => {
    if (entry == null) return;
    if (typeof entry !== 'string' && typeof entry !== 'number') {
      errors.push('service_entry_not_text');
      return;
    }
    const cleaned = cleanValue(entry, MAX_SERVICE_LENGTH);
    // Leere Zeilen sind kein Fehler, sondern die Zeilen, die der Kunde im
    // Formular stehen gelassen hat.
    if (cleaned) items.push(cleaned);
  });
  if (errors.length) return { value: null, errors };
  return { value: items.length ? items : null, errors: [] };
}

function formatServiceList(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return items
    .map((entry) => String(entry == null ? '' : entry).trim())
    .filter(Boolean)
    .map((entry) => `- ${entry}`)
    .join('\n');
}

// ── Haeufige Fragen ─────────────────────────────────────────────────────────

// Zwei Schreibweisen kommen real vor:
//   Vorlagen:  "– Was kostet eine Zahnreinigung? → Ab CHF ..."
//   Kundentext: "Kann ich jederzeit kündigen? – Monatsplaene monatlich ..."
// Der Pfeil ist eindeutig. Der Gedankenstrich ist es nicht -- er steht in den
// Vorlagen auch mitten in Regelzeilen ("Absagen: mindestens 24 Stunden vorher
// — sonst ggf. Ausfallgebuehr."). Deshalb gilt er nur, wenn der Teil davor
// wie eine Frage endet.
const ARROW = /\s*(?:→|->|=>)\s*/;
const DASH = /\s+(?:–|—|-)\s+/;

function splitPair(line) {
  const arrow = line.split(ARROW);
  if (arrow.length >= 2) {
    const question = arrow[0].trim();
    const answer = arrow.slice(1).join(' ').trim();
    if (question && answer) return { question, answer };
    return null;
  }
  const match = DASH.exec(line);
  if (!match) return null;
  const question = line.slice(0, match.index).trim();
  const answer = line.slice(match.index + match[0].length).trim();
  if (!question.endsWith('?') || !answer) return null;
  return { question, answer };
}

function parseFaqList(text) {
  const items = [];
  const ignored = [];
  const rules = [];
  const lines = splitLines(text);
  // Traegt der Text die Ueberschrift "Häufige Fragen:", ist ALLES davor eine
  // Regelzeile -- unabhaengig davon, wie es geschrieben ist. Das ist nicht
  // uebervorsichtig: die Vorlage `zahnarzt` benutzt in einer Regelzeile
  // denselben Pfeil wie in ihren Fragen ("Notfall-Kriterien: ... → als Notfall
  // markieren"). Ohne diese Grenze wuerde daraus eine Frage, deren Antwort eine
  // Anweisung an das Praxisteam ist.
  const hasHeader = lines.some((line) => FAQ_HEADER.test(line));
  let inFaqSection = !hasHeader;
  lines.forEach((raw) => {
    if (FAQ_HEADER.test(raw)) {
      inFaqSection = true;
      return;
    }
    const line = stripBullet(raw);
    if (!line) return;
    if (!inFaqSection) {
      // In 15 von 19 Vorlagen steht hier die Aufnahme-Checkliste und die
      // Terminregeln. Sie sind kein Fehler -- sie gehoeren woandershin
      // (Befund G6). Getrennt gemeldet, damit der Vorschlag nicht so aussieht,
      // als haette er sie verworfen.
      rules.push(line);
      return;
    }
    const pair = splitPair(line);
    if (!pair) {
      ignored.push(line);
      return;
    }
    if (BRACKET_PLACEHOLDER.test(pair.question) || BRACKET_PLACEHOLDER.test(pair.answer)) {
      ignored.push(line);
      return;
    }
    if (pair.question.length > MAX_QUESTION_LENGTH || pair.answer.length > MAX_ANSWER_LENGTH) {
      ignored.push(line);
      return;
    }
    if (items.length >= MAX_FAQ) {
      ignored.push(line);
      return;
    }
    items.push({ q: pair.question, a: pair.answer });
  });
  return { items, ignored, rules };
}

function sanitizeFaqList(value) {
  if (value == null || value === '') return { value: null, errors: [] };
  if (!Array.isArray(value)) return { value: null, errors: ['faq_list_not_an_array'] };
  if (value.length > MAX_FAQ) return { value: null, errors: ['faq_list_too_long'] };
  const items = [];
  const errors = [];
  value.forEach((entry) => {
    if (entry == null) return;
    if (typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push('faq_entry_not_an_object');
      return;
    }
    const extra = Object.keys(entry).filter((key) => key !== 'q' && key !== 'a');
    if (extra.length) {
      errors.push('faq_entry_unknown_key');
      return;
    }
    const question = cleanValue(entry.q, MAX_QUESTION_LENGTH);
    const answer = cleanValue(entry.a, MAX_ANSWER_LENGTH);
    // Beides leer heisst: eine im Formular stehen gelassene Zeile. Nur eines
    // von beiden gefuellt ist dagegen eine halbe Angabe -- eine Frage ohne
    // Antwort wuerde am Telefon zu einer Frage ohne Antwort.
    if (!question && !answer) return;
    if (!question || !answer) {
      errors.push('faq_entry_incomplete');
      return;
    }
    items.push({ q: question, a: answer });
  });
  if (errors.length) return { value: null, errors };
  return { value: items.length ? items : null, errors: [] };
}

// ── Regeln rund um Termine (E1) ─────────────────────────────────────────────

// `parseFaqList()` trennt die Regelzeilen schon heute sauber heraus -- es fehlte
// bis hierher nur das Feld, in das sie gehoeren. Diese Funktion macht aus den
// gemeldeten Zeilen den Vorschlagstext; sie steht bewusst hier und nicht in der
// Oberflaeche, damit "was ist eine Regelzeile" an genau einer Stelle beantwortet
// wird.
//
// Gekuerzt wird an einer Zeilengrenze und nicht mitten im Satz: ein auf
// halbem Wort abgeschnittener Vorschlag sieht aus wie ein Fehler und wuerde,
// unbesehen bestaetigt, als halbe Regel am Telefon landen.
const MAX_APPOINTMENT_RULES_LENGTH = 1200;

function formatRuleLines(rules, limit = MAX_APPOINTMENT_RULES_LENGTH) {
  if (!Array.isArray(rules)) return '';
  const kept = [];
  let used = 0;
  for (const entry of rules) {
    const line = String(entry == null ? '' : entry).trim();
    if (!line) continue;
    const cost = line.length + (kept.length ? 1 : 0);
    if (used + cost > limit) break;
    kept.push(line);
    used += cost;
  }
  return kept.join('\n');
}

function formatFaqList(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return items
    .map((entry) => ({
      q: String(entry?.q == null ? '' : entry.q).trim(),
      a: String(entry?.a == null ? '' : entry.a).trim()
    }))
    .filter((entry) => entry.q && entry.a)
    .map((entry) => `- Frage: ${entry.q}\n  Antwort: ${entry.a}`)
    .join('\n');
}

module.exports = {
  parseServiceList,
  sanitizeServiceList,
  formatServiceList,
  parseFaqList,
  sanitizeFaqList,
  formatFaqList,
  formatRuleLines,
  MAX_SERVICES,
  MAX_FAQ,
  MAX_APPOINTMENT_RULES_LENGTH
};
