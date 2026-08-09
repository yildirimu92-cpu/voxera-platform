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
const FINGERPRINT_SCHEMA = 'v1';
const MASTER_PROMPT_KEY = 'prompt_master_l1';

// 12 Hex-Zeichen (48 Bit) pro Teil. Das ist keine Sicherheitsgrenze, sondern
// eine Kollisionsgrenze fuer eine Handvoll Vorlagentexte; der Wert soll in
// einem Log und in einer Badge noch lesbar sein.
function digest(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex').slice(0, 12);
}

function promptFingerprint({ masterPrompt = '', industryPrompt = '' } = {}) {
  return [
    FINGERPRINT_SCHEMA,
    PROMPT_BUILDER_VERSION,
    digest(masterPrompt),
    digest(industryPrompt)
  ].join('.');
}

// Laedt die gemeinsamen Eingaben genau einmal. Ein einzelner Kunde und ein
// Fan-out ueber alle Kunden benutzen damit denselben Code -- der Soll-Wert
// kann nicht auf zwei Wegen unterschiedlich herauskommen.
async function loadFingerprintContext(sb) {
  const [masterResult, templateResult] = await Promise.all([
    sb.from('system_config').select('value').eq('key', MASTER_PROMPT_KEY).maybeSingle(),
    sb.from('industry_templates').select('id, prompt_block')
  ]);
  if (masterResult.error) throw masterResult.error;
  if (templateResult.error) throw templateResult.error;

  const industryPrompts = new Map();
  for (const row of templateResult.data || []) {
    industryPrompts.set(String(row.id), row.prompt_block || '');
  }
  return { masterPrompt: masterResult.data?.value || '', industryPrompts };
}

// Fehlt die Vorlage zum hinterlegten industry_template_id, ist der Branchenblock
// leer -- genau wie in loadPromptInputs() der Sync-Funktion, wo eine fehlende
// Zeile ebenfalls '' ergibt. Beide Seiten muessen hier gleich rechnen, sonst
// gilt ein Kunde dauerhaft als veraltet und wird bei jedem Fan-out erneut
// angefasst.
function fingerprintFor(context, customer) {
  const templateId = String(customer?.industry_template_id || '').trim();
  const industryPrompt = templateId ? (context.industryPrompts.get(templateId) || '') : '';
  return promptFingerprint({ masterPrompt: context.masterPrompt, industryPrompt });
}

module.exports = {
  FINGERPRINT_SCHEMA,
  MASTER_PROMPT_KEY,
  promptFingerprint,
  loadFingerprintContext,
  fingerprintFor
};
