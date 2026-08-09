// Guard fuer "Prev-Values-Erweiterung": Wizard und customer_request bauen jetzt
// ebenfalls prev_values auf (gleiches Muster wie admin_save aus S9), statt mit
// prev_values = {} anzukommen (S9 liess changed_fields fuer diese zwei Ausloeser
// deshalb bewusst leer statt zu raten).
//
// Dieser Test extrahiert die echten Snippets aus admin-panel/index.html (nicht
// nachgebaut) -- die wizardPrevValues-Feldliste aus wizardFinish() und die
// prevValues-Erfassung aus confirmApplyChange() -- und fuehrt sie zusammen mit
// der echten diffPrevValues() aus trigger-elevenlabs-sync.js aus.

import fs from 'node:fs';
import vm from 'node:vm';

const indexPath = 'admin-panel/index.html';
// Seit S4 / Stufe 2 liegt diffPrevValues() im Sync-Kern, nicht mehr im
// Handler. Die Aufrufer-Pruefungen unten lesen weiterhin index.html.
const triggerPath = 'admin-panel/netlify/functions/_lib/elevenlabs-sync.js';
const indexSource = fs.readFileSync(indexPath, 'utf8');
const triggerSource = fs.readFileSync(triggerPath, 'utf8');

let failed = 0;
const check = (name, passed, detail) => {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failed += 1;
};

// ── diffPrevValues() aus trigger-elevenlabs-sync.js, echt extrahiert ────────
function extractFunction(text, signature) {
  const start = text.indexOf(signature);
  if (start === -1) throw new Error(`${signature} nicht gefunden`);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`${signature}: kein passendes Klammernende`);
}
const diffSource = extractFunction(triggerSource, 'function diffPrevValues(');
const diffSandbox = { console: { warn() {} } };
vm.createContext(diffSandbox);
new vm.Script(`${diffSource}\nglobalThis.__diff = diffPrevValues;`, { filename: triggerPath }).runInContext(diffSandbox);
const diffPrevValues = diffSandbox.__diff;

// ── Wizard: prev_values ist mitgeschickt, nicht mehr {} ─────────────────────
check(
  'wizardFinish sendet prev_values an trigger-elevenlabs-sync',
  /triggered_by:\s*'wizard',\s*\n\s*prev_values:\s*wizardPrevValues/.test(indexSource)
);

// Die echte Feldliste + forEach-Zuweisung aus wizardFinish() extrahieren.
const wizardBlockStart = indexSource.indexOf('const wizardPrevValues={};');
if (wizardBlockStart === -1) throw new Error('wizardPrevValues-Block nicht gefunden');
const wizardBlockEnd = indexSource.indexOf("].forEach(k => { wizardPrevValues[k] = c[k] || ''; });", wizardBlockStart);
if (wizardBlockEnd === -1) throw new Error('wizardPrevValues forEach nicht gefunden');
const wizardSnippet = `${indexSource.slice(
  wizardBlockStart,
  wizardBlockEnd + "].forEach(k => { wizardPrevValues[k] = c[k] || ''; });".length
)}\n}`;

function buildWizardPrevValues(c) {
  const sandbox = { c, wizardPrevValues: undefined };
  vm.createContext(sandbox);
  new vm.Script(`${wizardSnippet}\nglobalThis.__result = wizardPrevValues;`).runInContext(sandbox);
  return sandbox.__result;
}

const WIZARD_BASE_CUSTOMER = {
  spezialgebiet: 'Allgemeinmedizin',
  kanton: 'ZH',
  sprechstunden_modus: 'rund_um_die_uhr',
  notfallnummer_lebensgefahr: '144',
  notfallnummer_dringend: '',
  notfall_service_name: '',
  industry_template_id: 'tpl_medical',
  ai_business_description: 'Hausarztpraxis',
  ai_services: 'Vorsorge, Impfungen',
  ai_location_hours: 'Mo-Fr 8-18',
  ai_booking_faq: '',
  ai_website_url: '',
  ai_short_description: '',
  ai_forwarding_1_name: '',
  ai_forwarding_1_number: '',
  ai_forwarding_1_trigger: '',
  ai_forwarding_2_name: '',
  ai_forwarding_2_number: '',
  ai_forwarding_2_trigger: '',
  ai_emergency_number: '144',
  ai_instructions: '',
  ai_fallback_escalation: '',
  ai_response_constraints: '',
  ai_summary: 'Hausarztpraxis mit Vorsorge',
  assistant_name: 'Nadia',
  ai_customer_type: 'company',
  customer_display_name: 'Praxis Muster',
  customer_legal_name: 'Praxis Muster AG',
  ai_person_name: '',
  ai_address_form: 'sie',
  ai_tone: 'professional',
  ai_language: 'de',
  ai_greeting: 'Guten Tag, hier ist Nadia.',
  voice_id: 'voice_1',
  ai_internal_notes: ''
};

// Jedes Feld einzeln aendern, wie im S9-Test.
for (const key of Object.keys(WIZARD_BASE_CUSTOMER)) {
  const c = { ...WIZARD_BASE_CUSTOMER };
  const prevValues = buildWizardPrevValues(c);
  const after = { ...WIZARD_BASE_CUSTOMER, [key]: `${WIZARD_BASE_CUSTOMER[key] || 'leer'}-geaendert` };
  const changed = diffPrevValues(prevValues, after);
  check(`Wizard: einzelne Aenderung an "${key}" ergibt genau {${key}}`,
    Object.keys(changed).length === 1 && key in changed,
    `changed_fields: ${JSON.stringify(changed)}`);
}

// Zwei Felder gleichzeitig.
{
  const c = { ...WIZARD_BASE_CUSTOMER };
  const prevValues = buildWizardPrevValues(c);
  const after = { ...WIZARD_BASE_CUSTOMER, ai_tone: 'casual', ai_greeting: 'Hoi!' };
  const changed = diffPrevValues(prevValues, after);
  check('Wizard: zwei gleichzeitige Aenderungen ergeben genau diese zwei Felder',
    Object.keys(changed).sort().join(',') === 'ai_greeting,ai_tone',
    `changed_fields: ${JSON.stringify(changed)}`);
}

// ── customer_request (confirmApplyChange): prev_values ist mitgeschickt ────
check(
  'confirmApplyChange sendet prev_values an trigger-elevenlabs-sync',
  /triggered_by:\s*'customer_request',\s*\n\s*prev_values:\s*prevValues/.test(indexSource)
);

// Die echte Erfassungszeile aus confirmApplyChange() extrahieren.
const crMarker = "if (c) Object.keys(changes).forEach(k => { prevValues[k] = c[k] || ''; });";
if (!indexSource.includes(crMarker)) throw new Error('confirmApplyChange prevValues-Zeile nicht gefunden');

function buildCustomerRequestPrevValues(c, changes) {
  const sandbox = { c, changes, prevValues: {} };
  vm.createContext(sandbox);
  new vm.Script(`${crMarker}\nglobalThis.__result = prevValues;`).runInContext(sandbox);
  return sandbox.__result;
}

const CR_BASE_CUSTOMER = {
  ai_greeting: 'Guten Tag, hier ist Nadia.',
  ai_business_description: 'Hausarztpraxis',
  ai_tone: 'professional'
};

// Jedes Feld einzeln aendern (so wie eine einzelne Kundenanfrage typischerweise
// genau ein Feld patcht).
for (const key of Object.keys(CR_BASE_CUSTOMER)) {
  const c = { ...CR_BASE_CUSTOMER };
  const changes = { [key]: `${CR_BASE_CUSTOMER[key]}-geaendert` };
  const prevValues = buildCustomerRequestPrevValues(c, changes);
  const after = { ...c, ...changes };
  const changed = diffPrevValues(prevValues, after);
  check(`customer_request: einzelne Aenderung an "${key}" ergibt genau {${key}}`,
    Object.keys(changed).length === 1 && key in changed,
    `changed_fields: ${JSON.stringify(changed)}`);
}

// Mehrere Felder gleichzeitig (eine KI-Anfrage kann mehrere Felder patchen).
{
  const c = { ...CR_BASE_CUSTOMER };
  const changes = { ai_tone: 'casual', ai_greeting: 'Hoi, hier ist Nadia.' };
  const prevValues = buildCustomerRequestPrevValues(c, changes);
  const after = { ...c, ...changes };
  const changed = diffPrevValues(prevValues, after);
  check('customer_request: zwei gleichzeitige Aenderungen ergeben genau diese zwei Felder',
    Object.keys(changed).sort().join(',') === 'ai_greeting,ai_tone',
    `changed_fields: ${JSON.stringify(changed)}`);
}

if (failed) process.exit(1);
console.log('Wizard- und customer_request-prev_values verified.');
