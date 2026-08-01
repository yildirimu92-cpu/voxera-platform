import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  runtime: 'customer-dashboard/shared/customer-runtime-assistant-profile.js',
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
  'Aktuelle Betriebsinfos',
  "request('customer-assistant-profile')",
  "request('get-available-voices')",
  "request('preview-voice'",
  "request('customer-update-assistant'",
  "data-vx-filter=\"female\"",
  "data-vx-filter=\"male\"",
  'Stimme übernehmen?',
  'Technische Sprachparameter bleiben geschützt',
  'sync_status'
]) {
  if (!source.runtime.includes(token)) failures.push(`runtime missing: ${token}`);
}

for (const forbidden of [
  'ai_instructions',
  'ai_fallback_escalation',
  'ai_response_constraints',
  'similarity_boost',
  'stability'
]) {
  if (source.runtime.includes(forbidden)) failures.push(`runtime exposes protected field: ${forbidden}`);
}

assert.match(source.loader, /customer-runtime-assistant-profile\.js\?v=/);
assert.match(source.profile, /requireCustomerCaller/);
assert.match(source.profile, /allow_custom_assistant_name,voice_selection_enabled/);
assert.match(source.profile, /ai_business_description/);
assert.match(source.profile, /ai_booking_faq/);
assert.match(source.preview, /requireCustomerCaller/);
assert.match(source.preview, /voice_not_available_on_plan/);
assert.match(source.update, /voice_not_available_on_plan/);
assert.match(source.update, /from\('voxera_voices'\)/);
assert.match(source.update, /PLAN_TIERS/);
assert.match(source.voices, /gender,language,preview_url/);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Customer assistant profile verification passed.');
