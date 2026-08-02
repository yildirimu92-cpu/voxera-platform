import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  runtime: 'customer-dashboard/shared/customer-runtime-assistant-profile.js',
  statusRuntime: 'customer-dashboard/shared/customer-runtime-assistant-status.js',
  menu: 'customer-dashboard/shared/customer-runtime-assistant-business-menu.js',
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
  "request('preview-voice'",
  "request('customer-update-assistant'",
  "data-vx-filter=\"female\"",
  "data-vx-filter=\"male\"",
  'Stimme übernehmen?',
  'Technische Sprachparameter bleiben geschützt',
  'sync_status',
  'restoreStatus',
  'bootAttempts < 80',
  '/\\/activate(?:\\.html)?$/'
]) {
  if (!source.runtime.includes(token)) failures.push(`runtime missing: ${token}`);
}

for (const token of [
  'Assistent & Geschäft',
  'Aktuelle Änderungen',
  'Ferien, Sonderzeiten und vorübergehende Hinweise',
  'vx-assistant-business-section',
  'vx-assistant-profile-entry',
  'vx-business-profile-entry',
  'vx-operational-entry',
  'mehr-sub-betriebsinfos',
  '[assistant, business, operational]',
  'customer-runtime-assistant-status.js?v=20260802-1'
]) {
  if (!source.menu.includes(token)) failures.push(`menu missing: ${token}`);
}

for (const token of [
  'Aktive Fähigkeiten',
  'Systemstatus',
  'Rufnummer & Weiterleitung',
  'Konfiguration & Stimme',
  'Letzte erfolgreiche Synchronisierung',
  'vx-assistant-operational-summary',
  'vx-calendar-settings-entry',
  'vx-operational-entry'
]) {
  if (!source.statusRuntime.includes(token)) failures.push(`status runtime missing: ${token}`);
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

assert.match(source.loader, /customer-runtime-assistant-profile\.js\?v=/);
assert.match(source.loader, /customer-runtime-assistant-business-menu\.js\?v=/);
assert.match(source.profile, /requireCustomerCaller/);
assert.match(source.profile, /customer_name/);
assert.doesNotMatch(source.profile, /'company_name'/);
assert.match(source.profile, /allow_custom_assistant_name,voice_selection_enabled/);
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
assert.match(source.statusRuntime, /cache: 'no-store'/);
assert.match(source.statusRuntime, /snapshot = null/);
assert.match(source.statusRuntime, /new MutationObserver/);
assert.match(source.preview, /requireCustomerCaller/);
assert.match(source.preview, /voice_not_available_on_plan/);
assert.match(source.preview, /preview_url,preview_text/);
assert.match(source.preview, /loadCatalogPreview/);
assert.match(source.preview, /loadElevenLabsMetadataPreview/);
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

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Customer assistant profile verification passed.');
