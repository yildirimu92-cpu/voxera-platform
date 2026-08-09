import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  runtime: 'customer-dashboard/shared/customer-runtime-assistant-profile.js',
  statusRuntime: 'customer-dashboard/shared/customer-runtime-assistant-status.js',
  operational: 'customer-dashboard/shared/customer-runtime-operational-updates.js',
  loader: 'customer-dashboard/shared/offer-brand.js',
  profile: 'customer-dashboard/netlify/functions/customer-assistant-profile.js',
  update: 'customer-dashboard/netlify/functions/customer-update-assistant.js',
  preview: 'customer-dashboard/netlify/functions/preview-voice.js',
  voices: 'customer-dashboard/netlify/functions/get-available-voices.js'
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')])
);
const failures = [];

for (const [key, path] of Object.entries(files)) {
  try { new vm.Script(source[key], { filename: path }); }
  catch (error) { failures.push(`${key}: ${error.message}`); }
}

for (const token of [
  'Mein Assistent',
  'Geschäftsprofil',
  "request('customer-assistant-profile')",
  "request('get-available-voices')",
  "fetch('/.netlify/functions/preview-voice'",
  "request('customer-update-assistant'",
  "data-vx-filter=\"female\"",
  "data-vx-filter=\"male\"",
  'Stimme übernehmen?',
  'Technische Sprachparameter bleiben geschützt',
  'sync_status',
  'restoreStatus',
  'bootAttempts < 80',
  'previewLoading = false',
  'previewErrorMessage',
  'custom-preview-pending',
  'Vorläufige Standardvorschau',
  'payment_required',
  "querySelectorAll('[data-vx-preview]')",
  "cache: 'no-store'",
  'X-Voxera-Preview-Notice',
  // Etappe 6 / S2 — Kopfbereich "So meldet sich Ihr Assistent". Der
  // Begruessungssatz kommt aus dem Endpoint, wird nicht im Dashboard erzeugt,
  // und die eine Statuszeile des Screens entsteht hier statt in der
  // Betriebsstatus-Karte.
  // E8 (09.08.): aus dem Kopfbereich ist der Abschnitt "Kernidentität"
  // geworden — derselbe Satz, aber mit den fünf Feldern, die ihn erzeugen,
  // in derselben Karte. Ansprache und Ton standen vorher doppelt auf dem
  // Screen (D7).
  'function identityCard',
  'function statusSummary',
  'vx-ap-hero-greeting',
  'vx-ap-hero-status',
  'sobald Ihr Assistent aktiviert ist',
  // Etappe 6 / S3 — Ansprache und Ton sind wieder bedienbar, und zwar dort, wo
  // ihre Wirkung steht. Die Sperre haengt allein an permissions.can_change_tone;
  // ein Plan-Name im Frontend waere ein Rueckschritt zur verdrahteten Regel.
  'function toneEditor',
  'data-vx-tone-edit',
  'async function saveTune',
  'can_change_tone === true',
  // Vier Abschnitte, sortiert nach Beständigkeit, jeder mit Herkunftsangabe.
  // Die Herkunftsmarke ist die zweite Achse der Gliederung (S5/E4) und darf
  // nicht wieder zu einer eigenen Karte werden.
  'function bandCard',
  'function knowledgeCard',
  'function boundariesCard',
  'function originChip',
  'Grenzen und Eskalation',
  'Was Ihr Assistent weiss',
  'vx-assistant-capabilities-anchor',
  // I8: die Feldliste kommt aus der Branchenvorlage, nicht aus dem Frontend.
  'function branchCard',
  'ai_branch_extra',
  // A4/E11: die eingefrorene Begrüssung wird angezeigt und zurückgesetzt,
  // nicht bearbeitet — buildGreeting bleibt die einzige Erzeugungsstelle.
  'async function resetGreeting',
  'let loadPromise = null',
  'let loadSequence = 0',
  'if (loadPromise) return loadPromise',
  'sequence !== loadSequence',
  '/\\/activate(?:\\.html)?$/'
]) {
  if (!source.runtime.includes(token)) failures.push(`runtime missing: ${token}`);
}

for (const token of [
  'showLoadingSkeleton',
  'Noch keine aktuelle Änderung',
  'Neue aktuelle Änderung',
  'mehr-sub-betriebsinfos',
  'root.vxOperationalUpdatesOpen=open'
]) {
  if (!source.operational.includes(token)) failures.push(`operational runtime missing: ${token}`);
}

for (const token of [
  'Fähigkeiten',
  '<div class="vx-ap-title">Betriebsstatus</div>',
  // Etappe 6 / S2: Die Statusaussage ist in den Kopfbereich gewandert. Die
  // Betriebsstatus-Karte formuliert keine zweite Zusammenfassung mehr und
  // erscheint nur noch bei einer Abweichung — deshalb steht hier jetzt
  // hasDeviation() statt technicalSummary(), und vx-nav-status-summary wird
  // von diesem Modul bewusst nicht mehr erzeugt (siehe runtime-Liste oben).
  'Diese Einrichtungen brauchen noch Ihre Aufmerksamkeit.',
  'function hasDeviation',
  'if (!hasDeviation(technical)) return',
  // Der Render-Guard haengt nicht mehr am Vorhandensein der Statuskarte,
  // sondern an einem Marker am Stack. Ohne das erzeugt die nun optionale
  // Karte eine Render- und Fetch-Schleife.
  "stack.dataset.vxStatusRendered = '1'",
  'function capabilityToggleHtml',
  'data-vx-capability-toggle',
  'type="button"',
  'vx-as-capabilities-simple',
  'vx-as-extra-capability',
  'vx-nav-status-details',
  "technicalRow('Telefonie'",
  "technicalRow('Stimme & Einstellungen'",
  'statusObserver.observe(body, { childList: true, subtree: true })'
]) {
  if (!source.statusRuntime.includes(token)) failures.push(`status runtime missing: ${token}`);
}

for (const token of [
  'Aktive Fähigkeiten',
  'Systemstatus',
  'Rufnummer & Weiterleitung',
  'Konfiguration & Stimme',
  'Letzte erfolgreiche Synchronisierung',
  'vx-assistant-operational-summary',
  'openOperational',
  'openCalendar'
]) {
  if (source.statusRuntime.includes(token)) failures.push(`status runtime still contains removed legacy token: ${token}`);
}

for (const token of [
  'Anrufe entgegennehmen',
  'Rückrufwünsche aufnehmen',
  'Termine vereinbaren',
  'Bestehende Termine bearbeiten',
  'An zuständige Person weiterleiten',
  'Benachrichtigungen versenden'
]) {
  if (!source.profile.includes(token)) failures.push(`profile capability missing: ${token}`);
}

for (const forbidden of [
  'ai_instructions',
  'ai_fallback_escalation',
  'ai_response_constraints',
  'similarity_boost',
  'stability'
]) {
  if (source.runtime.includes(forbidden)) failures.push(`runtime exposes protected field: ${forbidden}`);
  if (source.statusRuntime.includes(forbidden)) failures.push(`status runtime exposes protected field: ${forbidden}`);
}

assert.match(source.loader, /customer-runtime-assistant-profile\.js\?v=20260809-3/);
assert.match(source.loader, /customer-runtime-assistant-status\.js\?v=20260809-1/);
assert.doesNotMatch(source.loader, /customer-runtime-assistant-business-menu\.js/);
assert.doesNotMatch(source.loader, /customer-runtime-voice-preview-fallback\.js/);
assert.doesNotMatch(source.loader, /__vxVoicePreviewFallbackLoaderInstalled/);
assert.doesNotMatch(source.runtime, /stopImmediatePropagation/);
assert.doesNotMatch(source.runtime, /__vxVoicePreviewFallbackInstalled/);
assert.match(source.profile, /requireCustomerCaller/);
assert.match(source.profile, /customer_name/);
assert.doesNotMatch(source.profile, /'company_name'/);
assert.match(source.profile, /allow_custom_assistant_name,voice_selection_enabled/);
// Etappe 6 / S3 + A1: Die Ton-Sperre lebt in plan_config und wird serverseitig
// durchgesetzt, nicht nur in der Oberflaeche. Ohne die zweite Zusicherung waere
// sie wieder blosse Optik und per direktem Aufruf umgehbar.
assert.match(source.profile, /allow_custom_tone/);
assert.match(source.profile, /can_change_tone/);
assert.match(source.update, /allow_custom_tone/);
assert.match(source.update, /tone_not_allowed_on_plan/);
// Die Anrede bleibt bewusst fuer alle Plaene frei.
assert.doesNotMatch(source.update, /address_form_not_allowed_on_plan/);
assert.match(source.profile, /ai_business_description/);
assert.match(source.profile, /ai_booking_faq/);
assert.match(source.profile, /promptProfile/);
assert.match(source.profile, /from\('calendar_settings'\)/);
assert.match(source.profile, /from\('calendar_connections'\)/);
assert.match(source.profile, /from\('customer_operational_updates'\)/);
assert.match(source.profile, /buildCapabilities/);
assert.match(source.profile, /buildTechnicalStatus/);
assert.match(source.profile, /notification_mode/);
assert.match(source.profile, /forwarding_status/);
assert.match(source.profile, /elevenlabs_sync_status/);
assert.match(source.profile, /status_version: 1/);
// I2/I4: Herkunft und Grenzen kommen aus dem Endpoint, nicht aus dem Browser.
// Layer 1 steht als Kategorienliste im Code — der Prompt-Wortlaut bleibt im
// Admin-Panel (E4).
assert.match(source.profile, /from\('industry_templates'\)/);
assert.match(source.profile, /VOXERA_RULES/);
assert.match(source.profile, /buildBoundaries/);
assert.match(source.profile, /buildBranchSections/);
// I8: der Browser bestimmt nicht, welche Branchenfelder es gibt. Ohne diese
// Allowlist waere ein freier Schluessel seit Prompt-Builder 2.2 eine
// Schreibberechtigung auf den Prompt.
assert.match(source.update, /branch_field_not_in_template/);
assert.match(source.update, /function sanitizeBranchExtra/);
assert.match(source.update, /replace\(\/\[\{\}\]\/g, ''\)/);
assert.match(source.statusRuntime, /cache: 'no-store'/);
assert.match(source.statusRuntime, /snapshot = null/);
assert.match(source.statusRuntime, /new MutationObserver/);
assert.doesNotMatch(source.statusRuntime, /observer\.observe\(document\.documentElement/);
assert.doesNotMatch(source.statusRuntime, /createElement\('style'\)|style\.textContent| style="/);
assert.match(source.preview, /requireCustomerCaller/);
assert.match(source.preview, /voice_not_available_on_plan/);
assert.match(source.preview, /preview_url,preview_text/);
assert.match(source.preview, /Access-Control-Expose-Headers/);
assert.match(source.preview, /X-Voxera-Preview-Notice/);
assert.match(source.preview, /custom-preview-pending/);
assert.match(source.preview, /elevenlabs-provider-fallback/);
assert.match(source.preview, /Customer clicks must never consume TTS credits/);
assert.match(source.preview, /loadCatalogPreview/);
assert.match(source.preview, /loadElevenLabsMetadataPreview/);
assert.doesNotMatch(
  source.preview,
  /if \(hasManagedPreviewText\)[\s\S]{0,900}synthesizePreview\(/,
  'Managed customer previews must not trigger paid TTS generation.'
);
assert.match(source.preview, /\/v1\/voices\/\$\{encodeURIComponent\(voiceId\)\}/);
assert.match(source.preview, /elevenlabs_voice_preview_lookup_failed/);
assert.match(source.preview, /isAcceptedAudioContentType/);
assert.match(source.preview, /detectAudioContentType/);
assert.match(source.preview, /resolveAudioContentType/);
assert.match(source.preview, /catalog_preview_mislabeled_content_type/);
assert.match(source.preview, /buffer\.subarray\(0, 3\)\.toString\('ascii'\) === 'ID3'/);
assert.match(source.preview, /buffer\[0\] === 0xff/);
assert.match(source.preview, /catalog_preview_fetch_failed/);
assert.match(source.preview, /voice_preview_unavailable/);
assert.match(source.preview, /DEFAULT_PREVIEW_TEXT/);
assert.match(source.preview, /text: safePreviewText/);
assert.match(source.preview, /environmentHost\(process\.env\.SUPABASE_URL\)/);
assert.match(source.preview, /output_format=mp3_44100_128/);
assert.match(source.preview, /VOICE_PREVIEW_ALLOWED_HOSTS/);
assert.doesNotMatch(source.preview, /body\.text/);
assert.doesNotMatch(source.preview, /if \(!ELEVENLABS_API_KEY\)/);
assert.match(source.update, /voice_not_available_on_plan/);
assert.match(source.update, /from\('voxera_voices'\)/);
assert.match(source.update, /PLAN_TIERS/);
assert.match(source.voices, /gender,language,preview_url/);

// ── J4 / Schicht A: der Schreibpfad der generischen Felder ───────────────────
// Die Funktionen laufen normalerweise in Netlify mit installierten
// Abhaengigkeiten. Hier wird das Modul in einer Sandbox mit gestubbtem require
// ausgewertet, damit die Allowlist echt geprueft wird und nicht nur ihr
// Quelltext — sie ist die Stelle, an der eine Zeile in system_config sonst zu
// einer Schreibberechtigung auf beliebige Kundenspalten wuerde.
function loadFunctionModule(path) {
  const stubs = {
    '@supabase/supabase-js': { createClient: () => ({}) },
    './_lib/require-customer': { requireCustomerCaller: async () => ({ ok: false, statusCode: 401, body: {} }) },
    './_lib/assistant-greeting': { buildGreetingView: () => ({}) }
  };
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: (name) => {
      if (!(name in stubs)) throw new Error('unerwartetes require: ' + name);
      return stubs[name];
    },
    console,
    process
  });
  new vm.Script(fs.readFileSync(path, 'utf8'), { filename: path }).runInContext(context);
  return module.exports;
}

const CORE_SCHEMA = [{
  id: 'betrieb_kern',
  fields: [
    { key: 'coverage_mode', column: 'ai_coverage_mode', type: 'radio', options: [{ val: 'backup' }, { val: 'rund_um_die_uhr' }] },
    { key: 'online_booking_url', column: 'ai_online_booking_url', type: 'text' }
  ]
}];

try {
  const updateModule = loadFunctionModule(files.update);
  const { parseCoreSteps, coreFieldRules, sanitizeCoreFields } = updateModule._test;

  const rules = coreFieldRules(CORE_SCHEMA);
  assert.equal(rules.get('coverage_mode').column, 'ai_coverage_mode');

  // Der Kern der Trennung: das Schema darf die Frage bestimmen, nicht das Ziel.
  const hijackRules = coreFieldRules([{ id: 'x', fields: [
    { key: 'plan_code', column: 'plan_code', type: 'text' },
    { key: 'agent', column: 'elevenlabs_agent_id', type: 'text' }
  ] }]);
  assert.equal(hijackRules.size, 0, 'Eine system_config-Zeile konnte eine fremde Spalte als Ziel setzen');

  const accepted = sanitizeCoreFields({ coverage_mode: 'backup' }, rules);
  assert.equal(JSON.stringify(accepted.patch), JSON.stringify({ ai_coverage_mode: 'backup' }));
  assert.equal(accepted.rejected.length, 0);

  const badOption = sanitizeCoreFields({ coverage_mode: 'immer_alles' }, rules);
  assert.equal(badOption.rejected.join(), 'coverage_mode', 'Ein Wert ausserhalb der Optionen wurde angenommen');
  assert.equal(Object.keys(badOption.patch).length, 0);

  const unknownKey = sanitizeCoreFields({ nicht_im_schema: 'x' }, rules);
  assert.equal(unknownKey.rejected.join(), 'nicht_im_schema');

  // Leeren muss zuruecknehmbar sein: jedes Feld hat eine eigene Spalte.
  const cleared = sanitizeCoreFields({ coverage_mode: '' }, rules);
  assert.equal(JSON.stringify(cleared.patch), JSON.stringify({ ai_coverage_mode: null }));

  // Geschweifte Klammern raus, sonst schriebe eine Antwort einen Platzhalter.
  const braces = sanitizeCoreFields({ online_booking_url: 'https://x.ch/{{ASSISTANT_NAME}}' }, rules);
  assert.equal(braces.patch.ai_online_booking_url, 'https://x.ch/ASSISTANT_NAME');

  assert.equal(parseCoreSteps('kein json').length, 0, 'Ein kaputtes Schema muss leer degradieren, nicht werfen');
} catch (error) {
  failures.push(`core field write path: ${error.message}`);
}

assert.match(source.update, /core_field_not_in_schema/);
assert.match(source.profile, /core_sections/);
assert.match(source.runtime, /data-vx-core-key/);
assert.match(source.runtime, /core_fields: payload/);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Customer assistant profile verification passed.');
