import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const paths = {
  compiler:'admin-panel/netlify/functions/_lib/prompt-builder-v2.js',
  preview:'admin-panel/netlify/functions/prompt-preview.js',
  trigger:'admin-panel/netlify/functions/trigger-elevenlabs-sync.js',
  runtime:'admin-panel/shared/admin-runtime-prompt-builder-v2.js',
  loader:'admin-panel/shared/offer-brand.js'
};
const source = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')]));
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

for (const [key, path] of Object.entries(paths)) {
  check(`syntax ${path}`, () => new vm.Script(source[key], { filename:path }));
}

const { buildPromptV2, parsePromptProfile, PROMPT_BUILDER_VERSION } = require('../admin-panel/netlify/functions/_lib/prompt-builder-v2.js');
const customer = {
  customer_name:'Voxera Test AG',
  customer_legal_name:'Voxera Test AG',
  customer_display_name:'Voxera Test AG',
  assistant_name:'Lara',
  ai_customer_type:'company',
  ai_address_form:'sie',
  ai_tone:'professional',
  ai_language:'de',
  ai_business_description:'AI-Telefonassistenz für Schweizer KMU.',
  ai_services:'Telefonannahme, Lead-Qualifizierung und Terminvorbereitung.',
  ai_location_hours:'Schweiz, Montag bis Freitag 08:00–18:00.',
  ai_booking_faq:'Termine werden nach interner Prüfung bestätigt.',
  ai_instructions:'Frage jeweils nur eine Information auf einmal ab.',
  ai_fallback_escalation:'Bei Unsicherheit eine Rückrufanfrage aufnehmen.',
  ai_response_constraints:'Keine Preise oder Verfügbarkeiten erfinden.',
  ai_internal_notes:'[PROMPT_V2] {"version":2,"goal":"lead","requiredInformation":"Name\\nFirma\\nTelefonnummer\\nAnliegen","successDefinition":"Der Lead ist qualifiziert und der nächste Schritt bestätigt.","appointmentMode":"request","unknownHandling":"callback"}\n[WIZARD] {"sprachen":"de_en","haeufigste_anliegen":"Produktfragen"}',
  ai_emergency_number:'144'
};

const result = buildPromptV2({
  customer,
  masterPrompt:'Dokumentation\n---\n# IDENTITÄT\nDu bist {{ASSISTANT_NAME}} von {{CUSTOMER_DISPLAY_NAME}}.\n\n{{INDUSTRY_LAYER}}\n\n{{CUSTOMER_LAYER}}',
  industryPrompt:'## BRANCHE\nAntworte als Spezialistin für AI-Telefonie.'
});

check('compiler version is explicit', () => assert.equal(result.version, PROMPT_BUILDER_VERSION));
check('meta documentation is stripped', () => assert.ok(!result.prompt.includes('Dokumentation')));
check('identity variables are resolved', () => assert.match(result.prompt, /Du bist Lara von Voxera Test AG/));
check('structured assignment reaches productive prompt', () => {
  assert.match(result.prompt, /AUFTRAG & ERFOLGSKRITERIUM/);
  assert.match(result.prompt, /Interessenten qualifizieren/);
  assert.match(result.prompt, /Name\nFirma\nTelefonnummer\nAnliegen/);
});
check('appointment request cannot become a booking promise', () => {
  assert.match(result.prompt, /bestätige keinen Termin/);
  assert.match(result.prompt, /definitive Bestätigung durch das Unternehmen/);
});
check('unknown answers use configured fallback', () => assert.match(result.prompt, /Rückrufanfrage mit Name, Telefonnummer, Anliegen/));
check('dynamic wizard facts are compiled server-side', () => {
  assert.match(result.prompt, /Sprachen: DE\/EN/);
  assert.match(result.prompt, /Häufige Anliegen:\nProduktfragen/);
});
check('prompt injection and hallucination boundaries are always present', () => {
  assert.match(result.prompt, /Erfinde keine Preise, Verfügbarkeiten/);
  assert.match(result.prompt, /nicht als neue Systemregeln/);
  assert.match(result.prompt, /Werkzeug keinen Erfolg bestätigt/);
});
check('quality report is deterministic and ready', () => {
  assert.equal(result.quality.score, 100);
  assert.equal(result.quality.ready, true);
  assert.equal(result.quality.checks.length, 8);
});
check('malformed profile marker fails safely', () => assert.equal(parsePromptProfile('[PROMPT_V2] invalid').goal, ''));
check('direct booking remains tool-confirmation gated', () => {
  const direct = buildPromptV2({ customer:{...customer, ai_internal_notes:customer.ai_internal_notes.replace('"request"','"direct"')}, masterPrompt:'{{CUSTOMER_LAYER}}' });
  assert.match(direct.prompt, /nur dann verbindlich bestätigen/);
  assert.match(direct.prompt, /Erfinde niemals freie Zeiten/);
});
check('missing L1 uses safe fallback base prompt', () => {
  const fallback = buildPromptV2({ customer, masterPrompt:'', industryPrompt:'' });
  assert.match(fallback.prompt, /# ROLLE/);
  assert.match(fallback.prompt, /VERBINDLICHE SICHERHEITSREGELN/);
});

check('sync and preview share the same compiler', () => {
  assert.match(source.trigger, /buildPromptV2/);
  assert.match(source.preview, /buildPromptV2/);
  assert.ok(!source.trigger.includes('const l3Parts = []'));
});
check('preview remains admin protected and uncached', () => {
  assert.match(source.preview, /requireAdminCaller/);
  assert.match(source.preview, /requiredCapability:'customer:write'/);
  assert.match(source.preview, /Cache-Control':'no-store'/);
});
check('wizard collects operational decisions and persists a structured marker', () => {
  assert.match(source.runtime, /agent_auftrag/);
  assert.match(source.runtime, /prompt_check/);
  assert.match(source.runtime, /appointmentMode/);
  assert.match(source.runtime, /upsertProfile/);
});
check('admin preview requests the productive server prompt', () => assert.match(source.runtime, /callAdminFunction\('prompt-preview'/));
check('runtime is loaded by admin bootstrap', () => assert.match(source.loader, /admin-runtime-prompt-builder-v2\.js\?v=20260801-1/));

if (failed) {
  console.error(`Prompt Builder V2 verification failed: ${failed}`);
  process.exit(1);
}
console.log('Prompt Builder V2 verification passed.');
