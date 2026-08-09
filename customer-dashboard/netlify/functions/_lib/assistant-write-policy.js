'use strict';

// N6 (2026-08-09). Bis hierher entschied `customer-update-assistant.js` anhand
// einer Liste namens FORWARDING_FIELDS, ob nach einem Kunden-Speichervorgang
// ein ElevenLabs-Sync ausgeloest wird — und schloss genau die sieben
// `ai_forwarding_*`/`ai_emergency_number`-Spalten davon aus.
//
// Der Ausschluss stammt aus einer Namensverwechslung: `customers` traegt zwei
// unterschiedliche Dinge mit demselben Wort. `forwarding_setup_completed`,
// `forwarding_status`, `forwarding_mode` (geschrieben von
// `customer-update-settings.js`) sind die Rufumleitung des Telefonanbieters auf
// die Voxera-Nummer — reine Telefonie, nicht prompt-relevant. Die
// `ai_forwarding_*`-Spalten sind etwas anderes: die Personen, an die der
// Assistent im Gespraech weiterverbindet. Sie stehen als Abschnitte
// WEITERLEITUNGEN und NOTFALLNUMMER im Prompt
// (`prompt-builder-v2.js`), `ai_emergency_number` zusaetzlich als Variable
// `{{notfallnummer_lebensgefahr}}`.
//
// Deshalb klassifiziert diese Datei nicht mehr nach Feldnamen, sondern nach
// Wirkung: Ausgeloest wird ein Sync genau dann, wenn eine Spalte geschrieben
// wurde, die der Prompt-Builder auch liest. Die Liste ist gegen
// `prompt-builder-v2.js` gepruefet — siehe
// `scripts/verify-forwarding-self-edit-sync.mjs`.

// Alles, was buildPromptV2() aus `customers` liest, plus `voice_id`, das
// `trigger-elevenlabs-sync.js` sowohl als TTS-Stimme setzt als auch ueber
// `voxera_voices.gender` zu `{{ASSISTANT_ROLE}}` aufloest.
const PROMPT_RELEVANT_FIELDS = new Set([
  'assistant_name',
  'voice_id',
  'ai_customer_type',
  'ai_person_name',
  'ai_address_form',
  'ai_tone',
  'ai_language',
  'ai_greeting',
  'ai_summary',
  'ai_business_description',
  'ai_services',
  'ai_location_hours',
  'ai_booking_faq',
  'ai_instructions',
  'ai_fallback_escalation',
  'ai_response_constraints',
  'ai_internal_notes',
  'ai_branch_extra',
  'ai_forwarding_1_name',
  'ai_forwarding_1_number',
  'ai_forwarding_1_trigger',
  'ai_forwarding_2_name',
  'ai_forwarding_2_number',
  'ai_forwarding_2_trigger',
  'ai_emergency_number',
  'customer_name',
  'customer_legal_name',
  'customer_display_name',
  // J4 / Schicht A (PR #876): die generischen Betriebsfelder liegen in
  // typisierten Spalten und werden vom Builder ueber seine eigene
  // CORE_FIELD_COLUMNS-Liste gelesen — nicht als `customer.<feld>`. Sie sind
  // damit genauso prompt-wirksam wie die Weiterleitung und muessen hier stehen,
  // sonst waere "Schicht A allein gespeichert" derselbe Fehler wie N6, nur an
  // neuen Feldern.
  'sprechstunden_modus',
  'ai_appointment_mode',
  'ai_online_booking_url'
]);

// Die sieben Spalten, die der Kunde ueber den Weiterleitungs-Editor bearbeitet.
const FORWARDING_FIELDS = [
  'ai_forwarding_1_name',
  'ai_forwarding_1_number',
  'ai_forwarding_1_trigger',
  'ai_forwarding_2_name',
  'ai_forwarding_2_number',
  'ai_forwarding_2_trigger',
  'ai_emergency_number'
];

// Einzige Stelle, an der der Plan ueber die Weiterleitungs-Selbstbearbeitung
// entscheidet. Das Frontend bekommt daraus `permissions.can_change_forwarding`
// und kennt selbst keinen Plan-Namen — dieselbe Aufteilung wie bei Ton, Name
// und Stimme (Etappe 6 / S3).
function canEditForwarding(planCode) {
  return String(planCode || '').trim().toLowerCase() === 'professional';
}

function needsPromptSync(changedKeys) {
  return (Array.isArray(changedKeys) ? changedKeys : []).some((key) => PROMPT_RELEVANT_FIELDS.has(key));
}

module.exports = {
  PROMPT_RELEVANT_FIELDS,
  FORWARDING_FIELDS,
  canEditForwarding,
  needsPromptSync
};
