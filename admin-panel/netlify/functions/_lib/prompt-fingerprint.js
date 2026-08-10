'use strict';

// S4 / Stufe 1 — der Soll-Zustand, den es vorher nicht gab.
//
// Diagnose 2026-08-09: buildPromptV2() liefert eine Version, die nur in
// HTTP-Antworten auftaucht und nirgends gespeichert wird. Master-Prompt und
// Branchenvorlagen werden ausschliesslich gelesen. Deshalb war die Frage
// "welche Kunden laufen auf einem veralteten Prompt?" aus den Daten nicht
// beantwortbar -- und genau diese Antwort setzt jeder Fan-out voraus.
//
// Der Fingerprint fasst alle Eingaben zusammen, die NICHT vom Kunden kommen:
// die Version des Builders, den Master-Prompt (Layer 1) und den Branchenblock
// (Layer 2). Kundendaten gehen bewusst NICHT ein -- eine Aenderung daran loest
// ohnehin sofort einen Sync aus. Der Fingerprint beantwortet die andere Frage:
// hat sich die Plattform unter dem Kunden weg veraendert?
//
// Der Soll-Wert ist jederzeit ohne einen einzigen ElevenLabs-Aufruf
// berechenbar. Der Ist-Wert steht auf customers.prompt_fingerprint und wird
// nur nach einem ERFOLGREICHEN Sync geschrieben. soll !== ist heisst veraltet.

const crypto = require('crypto');
const { PROMPT_BUILDER_VERSION } = require('./prompt-builder-v2');

// Version des Fingerprint-Formats selbst. Aendert sich die Zusammensetzung
// (z.B. weil eine vierte Eingabe dazukommt), macht das Praefix alle
// gespeicherten Werte bewusst ungleich -- ein Fan-out laeuft dann einmal
// ueber alle Kunden, statt stillschweigend Aepfel mit Birnen zu vergleichen.
// Version des Fingerprint-Formats. v2 seit dem Merge mit N6/#876: der Builder
// verarbeitet seit J1/J4 zwei weitere gemeinsame Eingaben (core_field_steps und
// industry_templates.extra_steps). Waeren sie nicht Teil des Fingerprints,
// koennte eine Aenderung daran den erzeugten Prompt veraendern, waehrend
// findStaleCustomers() jeden betroffenen Agenten weiter als aktuell einstuft --
// exakt die Blindstelle, gegen die S4 gebaut wurde.
//
// Der Praefix-Wechsel macht alle gespeicherten Werte bewusst ungleich: es laeuft
// einmal ein Fan-out ueber alle Agenten, statt still Aepfel mit Birnen zu
// vergleichen.
// v3 (J8): eine fuenfte Eingabe -- die Aufnahme-Checkliste der Branche. Der
// Praefix wird mit angehoben, weil sich damit die ZUSAMMENSETZUNG aendert und
// nicht nur ein Wert. Alte und neue Fingerprints bedeuten Verschiedenes und
// duerfen nicht still miteinander verglichen werden; jeder gespeicherte Wert
// gilt ab hier als veraltet, was er sachlich auch ist.
const FINGERPRINT_SCHEMA = 'v3';
const MASTER_PROMPT_KEY = 'prompt_master_l1';
const CORE_FIELD_KEY = 'core_field_steps';

// 12 Hex-Zeichen (48 Bit) pro Teil. Das ist keine Sicherheitsgrenze, sondern
// eine Kollisionsgrenze fuer eine Handvoll Vorlagentexte; der Wert soll in
// einem Log und in einer Badge noch lesbar sein.
function digest(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex').slice(0, 12);
}

// extra_steps kommt als jsonb-Array an, core_field_steps als Text. Objekte
// muessen vor dem Hashen serialisiert werden, sonst waere jeder Wert
// '[object Object]' und die Eingabe faktisch nicht im Fingerprint.
function serialize(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

// ZWEI NACHWEISE, NICHT EINER. Bitte vor dem naechsten Deploy-Nachweis lesen.
//
// Der Fingerprint belegt den CODE-STAND: welcher Builder mit welchen
// gemeinsamen Vorlagen gerechnet hat. Er belegt NICHT, was der Anrufende
// tatsaechlich hoert. Die Begruessung -- und damit auch die gesetzlich
// vorgeschriebene Offenlegungsformel aus mitOffenlegung() -- ist bewusst
// KEINE Eingabe dieser Funktion. Weder `greeting` noch `firstMessage` noch
// `ai_greeting` tauchen unten auf.
//
// Konsequenz, an der sich am 2026-08-10 fast eine Fehlmessung entzuendet
// haette: setzt ein Kunde eine eigene ai_greeting und wird neu synchronisiert,
// aendert sich der ausgelieferte erste Satz vollstaendig -- der Fingerprint
// bleibt Zeichen fuer Zeichen derselbe. Das ist korrekt und kein Fehlschlag.
// Wer ihn als Beleg dafuer nimmt, dass "die neue Begruessung live ist",
// misst die falsche Groesse und bekommt ein gruenes Ergebnis geschenkt.
//
// Die Aufteilung:
//   Fingerprint (customers.prompt_fingerprint)  -> ist der neue CODE live?
//   customers.ai_effective_greeting             -> welcher SATZ geht raus?
//     (geschrieben in elevenlabs-sync.js aus compiled.firstMessage, also
//      exakt der String, der als first_message an ElevenLabs geht)
//   customers.elevenlabs_last_sync_at           -> hat der Sync ueberhaupt
//                                                  stattgefunden?
//
// Ob die Offenlegungsformel zusaetzlich in den Fingerprint gehoert, ist
// offen und bewusst nicht hier entschieden -- siehe das Ticket dazu. Bis
// dahin gilt: fuer Aussagen ueber den gesprochenen Satz ist diese Funktion
// die falsche Quelle.
function promptFingerprint({
  masterPrompt = '',
  industryPrompt = '',
  coreFields = '',
  industryFields = null,
  // J8: Die Aufnahme-Checkliste der Branche geht in den Prompt jedes Kunden
  // ein, der keine eigene hinterlegt hat. Aendert eine Vorlage sie, muessen
  // genau diese Agenten nachgezogen werden -- ohne diese Eingabe bliebe der
  // Fingerprint gleich und der Planer hielte sie fuer aktuell.
  industryRequiredInformation = ''
} = {}) {
  return [
    FINGERPRINT_SCHEMA,
    PROMPT_BUILDER_VERSION,
    digest(masterPrompt),
    digest(industryPrompt),
    digest(serialize(coreFields)),
    digest(serialize(industryFields)),
    digest(serialize(industryRequiredInformation))
  ].join('.');
}

// Laedt die gemeinsamen Eingaben genau einmal. Ein einzelner Kunde und ein
// Fan-out ueber alle Kunden benutzen damit denselben Code -- der Soll-Wert
// kann nicht auf zwei Wegen unterschiedlich herauskommen.
async function loadFingerprintContext(sb) {
  const [masterResult, coreResult, templateResult] = await Promise.all([
    sb.from('system_config').select('value').eq('key', MASTER_PROMPT_KEY).maybeSingle(),
    sb.from('system_config').select('value').eq('key', CORE_FIELD_KEY).maybeSingle(),
    sb.from('industry_templates').select('id, prompt_block, extra_steps, default_required_information')
  ]);
  if (masterResult.error) throw masterResult.error;
  if (coreResult.error) throw coreResult.error;
  if (templateResult.error) throw templateResult.error;

  const industryTemplates = new Map();
  for (const row of templateResult.data || []) {
    industryTemplates.set(String(row.id), {
      promptBlock: row.prompt_block || '',
      extraSteps: Array.isArray(row.extra_steps) ? row.extra_steps : [],
      requiredInformation: row.default_required_information || ''
    });
  }
  return {
    masterPrompt: masterResult.data?.value || '',
    coreFields: coreResult.data?.value || '',
    industryTemplates
  };
}

// Fehlt die Vorlage zum hinterlegten industry_template_id, sind Branchenblock
// und Zusatzfelder leer -- genau wie in loadPromptInputs() der Sync-Funktion, wo
// eine fehlende Zeile ebenfalls '' bzw. [] ergibt. Beide Seiten muessen hier
// gleich rechnen, sonst gilt ein Kunde dauerhaft als veraltet und wird bei jedem
// Fan-out erneut angefasst.
function fingerprintFor(context, customer) {
  const templateId = String(customer?.industry_template_id || '').trim();
  const template = templateId ? context.industryTemplates?.get(templateId) : null;
  return promptFingerprint({
    masterPrompt: context.masterPrompt,
    industryPrompt: template?.promptBlock || '',
    coreFields: context.coreFields,
    industryFields: template?.extraSteps || [],
    industryRequiredInformation: template?.requiredInformation || ''
  });
}

module.exports = {
  FINGERPRINT_SCHEMA,
  MASTER_PROMPT_KEY,
  promptFingerprint,
  loadFingerprintContext,
  fingerprintFor
};
