// Verifikation der Assistenz-Identität: Name, Stimme, Sprache, Sync-Diagnose.
//
// Deckt die vier Defekte aus VOICE_ASSISTANT_ARCHITECTURE_MAP_2026-08-07.md ab:
//   1. ai_greeting fror den Assistenznamen als Literal ein
//   2. fehlende voice_id liess Stimme und Rollen-Geschlecht unsynchronisiert
//   3. das Admin-Panel schrieb NULL in sechs Identitätsfelder
//   4. languageMap-Mismatch, toter selected_languages-Pfad, nie gepatchte
//      Agent-Sprache
// sowie das nie geschriebene elevenlabs_sync_log.changed_fields.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
  buildPromptV2,
  buildGreeting,
  resolveLanguages,
  languageInstruction
} = require('../admin-panel/netlify/functions/_lib/prompt-builder-v2.js');
const { resolveAssistantVoice } = require('../admin-panel/netlify/functions/_lib/assistant-voice.js');
const { buildChangedFields } = require('../admin-panel/netlify/functions/_lib/sync-change-log.js');

const adminIndex = fs.readFileSync('admin-panel/index.html', 'utf8');
const source = {
  trigger: fs.readFileSync('admin-panel/netlify/functions/trigger-elevenlabs-sync.js', 'utf8'),
  preview: fs.readFileSync('admin-panel/netlify/functions/prompt-preview.js', 'utf8'),
  provision: fs.readFileSync('admin-panel/netlify/functions/elevenlabs-provision-agent.js', 'utf8'),
  customerUpdate: fs.readFileSync('customer-dashboard/netlify/functions/customer-update-assistant.js', 'utf8')
};

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

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

// Schneidet den Rumpf einer Top-Level-Funktion aus dem Admin-HTML heraus,
// damit Assertions nicht versehentlich andere Funktionen treffen.
function functionBody(src, header) {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `Funktion nicht gefunden: ${header}`);
  const rest = src.slice(start + header.length);
  const nextHeader = rest.search(/\n(?:async )?function [A-Za-z_$]/);
  return rest.slice(0, nextHeader > 0 ? nextHeader : rest.length);
}

const CATALOG = [
  { voice_id: '1iF3vHdwHKuVKSPDK23Z', display_name: 'Freundlich', gender: 'female', is_default: true, is_active: true, sort_order: 1 },
  { voice_id: 'uvysWDLbKpA4XvpD3GI6', display_name: 'Natürlich', gender: 'female', is_default: false, is_active: true, sort_order: 2 },
  { voice_id: 'elrPOnQZaau5IoISMrJe', display_name: 'Seriös', gender: 'male', is_default: false, is_active: true, sort_order: 3 },
  { voice_id: 'RETIRED', display_name: 'Abgeschaltet', gender: 'male', is_default: false, is_active: false, sort_order: 9 }
];

function fakeSupabase(voices) {
  return {
    from() {
      const filters = {};
      const builder = {
        select() { return builder; },
        eq(column, value) { filters[column] = value; return builder; },
        order() { return builder; },
        limit() { return builder; },
        rows() {
          return voices.filter(row => Object.entries(filters).every(([column, value]) => row[column] === value));
        },
        maybeSingle() { return Promise.resolve({ data: builder.rows()[0] || null, error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: builder.rows(), error: null }).then(resolve, reject); }
      };
      return builder;
    }
  };
}

const baseCustomer = {
  customer_name: 'E2E Test AG',
  customer_legal_name: 'E2E Test AG',
  customer_display_name: 'E2E Test AG',
  assistant_name: 'Umuttt',
  ai_customer_type: 'company',
  ai_address_form: 'sie',
  ai_tone: 'professional',
  ai_language: 'de',
  ai_business_description: 'AI-Telefonassistenz.',
  ai_services: 'Telefonannahme.',
  ai_response_constraints: 'Keine Preise erfinden.'
};

const MASTER = '# ROLLE\nDu bist {{ASSISTANT_NAME}}, {{ASSISTANT_ROLE}} von {{CUSTOMER_DISPLAY_NAME}}.\nSPRACHE: {{SPRACHE}}\nERSTE NACHRICHT: {{BEGRUESSUNG}}\n\n{{CUSTOMER_LAYER}}';

const build = (overrides = {}, options = {}) => buildPromptV2({
  customer: { ...baseCustomer, ...overrides },
  masterPrompt: MASTER,
  ...options
});

// ── 1. Namens-Bug ───────────────────────────────────────────────────────────

check('Produktionsfall: eingefrorene Lara-Begrüssung wird auf den aktuellen Namen nachgeführt', () => {
  // Exakter Datenstand aus der Produktion am 2026-08-07:
  // assistant_name = 'Umuttt', ai_greeting nennt weiterhin 'Lara'.
  const result = build({
    ai_greeting: 'Grüezi, hier ist Lara von E2E Test AG. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?'
  });
  assert.match(result.firstMessage, /hier ist Umuttt von E2E Test AG/);
  assert.ok(!result.firstMessage.includes('Lara'), 'Begrüssung nennt weiterhin Lara');
  assert.ok(!result.prompt.includes('Lara'), 'Prompt enthält weiterhin Lara');
});

check('Begrüssung und Prompt-Body nennen denselben Namen', () => {
  const result = build({
    ai_greeting: 'Grüezi, hier ist Lara von E2E Test AG. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?'
  });
  const bodyNames = new Set((result.prompt.match(/Du bist ([^,]+),/g) || []).map(item => item.slice(8, -1)));
  const greetingName = result.firstMessage.match(/hier ist ([^,.]+) von/)[1];
  assert.deepEqual([...bodyNames], ['Umuttt']);
  assert.equal(greetingName, 'Umuttt');
});

check('Begrüssung mit Platzhaltern wird aufgelöst', () => {
  const result = build({ ai_greeting: 'Guten Tag, {{ASSISTANT_NAME}} von {{CUSTOMER_DISPLAY_NAME}} am Apparat.' });
  assert.equal(result.firstMessage, 'Guten Tag, Umuttt von E2E Test AG am Apparat.');
});

check('individuell formulierte Begrüssung bleibt unverändert', () => {
  const custom = 'Salü, schön dass Sie anrufen. Was kann ich für Sie tun?';
  assert.equal(build({ ai_greeting: custom }).firstMessage, custom);
});

check('ohne gespeicherte Begrüssung wird dynamisch generiert', () => {
  assert.match(build({ ai_greeting: null }).firstMessage, /hier ist Umuttt von E2E Test AG/);
});

check('Nachführung greift auch bei Einzelperson und Fremdsprache', () => {
  const result = build({
    ai_customer_type: 'individual',
    ai_person_name: 'Dr. Meier',
    ai_language: 'fr',
    ai_greeting: "Bonjour, ici Lara, l'assistante de Dr. Meier. Cet appel est enregistré. Comment puis-je vous aider?"
  });
  assert.match(result.firstMessage, /ici Umuttt/);
  assert.ok(!result.firstMessage.includes('Lara'));
});

check('Wizard persistiert eine unveraenderte Auto-Begruessung nicht mehr', () => {
  const body = functionBody(adminIndex, 'async function wizardFinish(');
  assert.match(body, /if\(value===buildAutoGreeting\(d\)\) return null;/);
});

check('Meta-Header mit CRLF-Zeilenenden wird abgetrennt (Live-Master ist CRLF-kodiert)', () => {
  // Zusatzbefund beim Verifizieren gegen den produktiven Master-Prompt: die
  // alte Trennung suchte den Literal-String '\n---\n' und fand ihn bei
  // CRLF-Zeilenenden nicht. Der Header dokumentiert u.a. den Standardnamen
  // "Lara" - er landete dadurch zusätzlich im ausgelieferten Prompt und war
  // im Live-Snapshot für 2 der 3 "Lara"-Treffer verantwortlich.
  const crlfMaster = 'Dokumentation: {{ASSISTANT_NAME}} = Standard "Lara"\r\n\r\n---\r\n\r\n# ROLLE\r\nDu bist {{ASSISTANT_NAME}}.';
  const result = build({}, { masterPrompt: crlfMaster });
  assert.ok(!result.prompt.includes('Dokumentation'), 'CRLF-Meta-Header wurde nicht abgetrennt');
  assert.ok(!result.prompt.includes('"Lara"'), 'Dokumentierter Standardname aus dem Header sickert weiterhin durch');
});

// ── 2. Stimmen-Bug ──────────────────────────────────────────────────────────

await checkAsync('gewählte Stimme wird übernommen', async () => {
  const voice = await resolveAssistantVoice(fakeSupabase(CATALOG), { voice_id: 'elrPOnQZaau5IoISMrJe' });
  assert.equal(voice.voiceId, 'elrPOnQZaau5IoISMrJe');
  assert.equal(voice.gender, 'male');
  assert.equal(voice.source, 'customer');
});

await checkAsync('fehlende voice_id fällt auf die Katalog-Standardstimme zurück', async () => {
  const voice = await resolveAssistantVoice(fakeSupabase(CATALOG), { voice_id: null });
  assert.equal(voice.voiceId, '1iF3vHdwHKuVKSPDK23Z');
  assert.equal(voice.gender, 'female');
  assert.equal(voice.source, 'catalog_default');
});

await checkAsync('inaktive Stimme fällt nachvollziehbar auf den Standard zurück', async () => {
  const voice = await resolveAssistantVoice(fakeSupabase(CATALOG), { voice_id: 'RETIRED' });
  assert.equal(voice.voiceId, '1iF3vHdwHKuVKSPDK23Z');
  assert.equal(voice.source, 'catalog_fallback');
});

await checkAsync('leerer Katalog liefert einen benannten Zustand statt stillem Nichts', async () => {
  const voice = await resolveAssistantVoice(fakeSupabase([]), { voice_id: null });
  assert.equal(voice.voiceId, null);
  assert.equal(voice.gender, 'female');
  assert.equal(voice.source, 'none');
});

check('männliche Stimme ergibt männliche Rollenbezeichnung in Prompt und Begrüssung', () => {
  const result = build({ ai_customer_type: 'individual', ai_person_name: 'Dr. Meier' }, { assistantGender: 'male' });
  assert.match(result.prompt, /Du bist Umuttt, der Assistent von/);
  assert.match(result.firstMessage, /der Assistent von Dr\. Meier/);
  assert.equal(result.assistantGender, 'male');
});

check('weibliche Stimme bleibt der Standard', () => {
  const result = build({ ai_customer_type: 'individual', ai_person_name: 'Dr. Meier' });
  assert.match(result.prompt, /Du bist Umuttt, die Assistentin von/);
  assert.match(result.firstMessage, /die Assistentin von Dr\. Meier/);
});

check('Begrüssung ist in allen Sprachen geschlechtssensitiv', () => {
  assert.match(buildGreeting('Max', 'individual', 'Dr. Meier', 'Praxis', 'fr', 'male'), /l'assistant de/);
  assert.match(buildGreeting('Max', 'individual', 'Dr. Meier', 'Praxis', 'fr', 'female'), /l'assistante de/);
  assert.match(buildGreeting('Max', 'individual', 'Dr. Meier', 'Praxis', 'de', 'male'), /der Assistent von/);
});

check('Sync sendet die aufgelöste Stimme statt customer.voice_id', () => {
  assert.match(source.trigger, /const \{ resolveAssistantVoice \} = require\('\.\/_lib\/assistant-voice'\)/);
  assert.match(source.trigger, /tts: voice\.voiceId \? \{ voice_id: voice\.voiceId \} : undefined/);
  assert.ok(!source.trigger.includes('customer.voice_id ?'), 'Sync entscheidet weiterhin direkt auf customer.voice_id');
});

check('Sync und Vorschau teilen dieselbe Stimmenauflösung', () => {
  assert.match(source.preview, /resolveAssistantVoice/);
  assert.ok(!source.preview.includes("let assistantRole = 'die Assistentin'"), 'Vorschau hat weiterhin eigene Gender-Logik');
  assert.match(source.provision, /resolveAssistantVoice/);
  assert.ok(!source.provision.includes('function buildDefaultGreeting'), 'Provisionierung hat weiterhin einen eigenen Greeting-Builder');
});

// ── 3. Admin-Panel Null-Overwrite ───────────────────────────────────────────

check('saveCustomerAiConfig schreibt keine Identitätsfelder mehr', () => {
  const body = functionBody(adminIndex, 'async function saveCustomerAiConfig(');
  for (const field of ['assistant_name', 'ai_customer_type', 'ai_address_form', 'ai_tone', 'ai_language', 'ai_greeting']) {
    assert.ok(!new RegExp(`${field}:\\s*cfg\\.`).test(body), `${field} wird weiterhin aus cfg geschrieben`);
  }
  assert.ok(!/cfg\.assistantName/.test(body), 'cfg.assistantName wird weiterhin gelesen');
  assert.ok(/ai_business_description: cfg\.businessDescription/.test(body), 'Geschäftsfelder fehlen im Patch');
});

check('der Speichern-Button hat genau einen Handler', () => {
  assert.ok(!/id="ai-save-customer"[^>]*onclick/.test(adminIndex), 'Inline-onclick existiert weiterhin zusätzlich zum Listener');
  assert.equal((adminIndex.match(/getElementById\('ai-save-customer'\)\.addEventListener/g) || []).length, 1);
});

// ── 4. Sprach-Handling ──────────────────────────────────────────────────────

check('einzelne Sprachcodes ergeben eine Anweisung statt eines rohen Codes', () => {
  const result = build({ ai_language: 'fr' });
  assert.match(result.prompt, /SPRACHE: Französisch \(Standard\)/);
  assert.ok(!/SPRACHE: fr\b/.test(result.prompt), 'Sprachcode landet weiterhin wörtlich im Prompt');
  assert.equal(result.language, 'fr');
});

check('selected_languages steuert den automatischen Sprachwechsel', () => {
  const result = build({ ai_language: 'de', selected_languages: ['de', 'fr', 'it', 'en'] });
  assert.match(result.prompt, /Zusätzlich freigegeben: Französisch, Italienisch, Englisch/);
  assert.match(result.prompt, /Wechsle automatisch in eine dieser Sprachen/);
  assert.deepEqual(result.languages, ['de', 'fr', 'it', 'en']);
});

check('einsprachige Konfiguration verbietet den Wechsel ausdrücklich', () => {
  const result = build({ ai_language: 'de', selected_languages: ['de'] });
  assert.match(result.prompt, /ausschliesslich auf Deutsch/);
  assert.ok(!result.prompt.includes('Wechsle automatisch'));
});

check('historische Sammelwerte bleiben lesbar', () => {
  assert.deepEqual(resolveLanguages({ ai_language: 'de_en_fr' }), { primary: 'de', languages: ['de', 'en', 'fr'] });
  assert.deepEqual(resolveLanguages({ ai_language: 'de_fr_it_en' }).languages, ['de', 'fr', 'it', 'en']);
});

check('unbekannte Sprachwerte fallen auf Deutsch zurück', () => {
  assert.equal(resolveLanguages({ ai_language: 'klingon' }).primary, 'de');
  assert.equal(resolveLanguages({}).primary, 'de');
  assert.match(languageInstruction('de', ['de']), /Deutsch \(Standard\)/);
});

check('unbekannte Einträge in selected_languages werden verworfen', () => {
  assert.deepEqual(resolveLanguages({ ai_language: 'de', selected_languages: ['de', 'xx', '', null] }).languages, ['de']);
});

check('Sync patcht die Agent-Sprache', () => {
  assert.match(source.trigger, /language: compiled\.language/);
});

// ── 5. changed_fields ───────────────────────────────────────────────────────

check('prev_values werden nicht mehr verworfen', () => {
  assert.ok(!source.trigger.includes('void prev_values'), 'prev_values wird weiterhin verworfen');
  assert.match(source.trigger, /changed_fields: buildChangedFields\(prev_values, customer, changedFieldsHint\)/);
});

check('changed_fields enthält Feldliste sowie Vorher und Nachher', () => {
  const diff = buildChangedFields(
    { assistant_name: 'Umut', ai_tone: 'professional' },
    { assistant_name: 'Umuttt', ai_tone: 'professional', ai_language: 'de' },
    null
  );
  assert.deepEqual(diff.fields, ['assistant_name']);
  assert.equal(diff.before.assistant_name, 'Umut');
  assert.equal(diff.after.assistant_name, 'Umuttt');
});

check('changed_fields ist NULL wenn sich nichts geändert hat', () => {
  assert.equal(buildChangedFields({ ai_tone: 'professional' }, { ai_tone: 'professional' }, null), null);
  assert.equal(buildChangedFields({}, {}, []), null);
});

check('NULL und leerer String gelten nicht als Änderung', () => {
  assert.equal(buildChangedFields({ ai_greeting: '' }, { ai_greeting: null }, null), null);
});

check('explizite Feldliste des Aufrufers wird übernommen', () => {
  const diff = buildChangedFields({}, { voice_id: 'abc' }, ['voice_id']);
  assert.deepEqual(diff.fields, ['voice_id']);
  assert.equal(diff.after.voice_id, 'abc');
});

check('lange Werte werden gekürzt gespeichert', () => {
  const diff = buildChangedFields({ ai_services: 'x' }, { ai_services: 'y'.repeat(1000) }, null);
  assert.ok(diff.after.ai_services.length <= 301);
});

check('Customer-Dashboard liefert prev_values und changed_fields an den Sync', () => {
  assert.match(source.customerUpdate, /changed_fields: patchKeys/);
  assert.match(source.customerUpdate, /prev_values: patchKeys\.reduce/);
});

if (failed) {
  console.error(`Assistant identity verification failed: ${failed}`);
  process.exit(1);
}
console.log('Assistant identity verification passed.');
