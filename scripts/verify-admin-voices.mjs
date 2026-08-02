import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  runtime: 'admin-panel/shared/admin-runtime-voices.js',
  endpoint: 'admin-panel/netlify/functions/admin-voices.js',
  loader: 'admin-panel/shared/offer-brand.js',
  customerPreview: 'customer-dashboard/netlify/functions/preview-voice.js',
  migration: 'supabase/migrations/2026-08-02_admin_voice_catalog_previews.sql'
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')])
);

for (const key of ['runtime', 'endpoint', 'loader', 'customerPreview']) {
  new vm.Script(source[key], { filename: files[key] });
}

for (const token of [
  'Stimmenkatalog',
  'Vorschautext',
  'Vorschau erzeugen und speichern',
  'Test anhören',
  "callAdminFunction('admin-voices'",
  "action: 'test_preview'",
  "action: 'generate_preview'",
  'assigned_customers',
  'Im Kundenportal aktiv',
  'Standardstimme',
  'section-ai-setup',
  'ai-tab-voices',
  'ai-panel-voices'
]) assert.match(source.runtime, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

assert.doesNotMatch(source.runtime, /getElementById\('section-settings'\)/);
assert.match(source.runtime, /root\.aiShowTab/);
assert.match(source.runtime, /audio_base64/);
assert.match(source.runtime, /URL\.createObjectURL/);

assert.match(source.endpoint, /requireAdminCaller/);
assert.match(source.endpoint, /requiredCapability: 'plan:write'/);
assert.match(source.endpoint, /from\('voxera_voices'\)/);
assert.match(source.endpoint, /from\('customers'\)/);
assert.match(source.endpoint, /storage\s*\.from\(BUCKET\)\s*\.upload/);
assert.match(source.endpoint, /output_format=mp3_44100_128/);
assert.match(source.endpoint, /text: previewText/);
assert.match(source.endpoint, /detectMp3/);
assert.match(source.endpoint, /action === 'test_preview'/);
assert.match(source.endpoint, /audio_base64: result\.audio\.toString\('base64'\)/);
assert.match(source.endpoint, /preview-\$\{Date\.now\(\)\}\.mp3/);
assert.match(source.endpoint, /upsert: false/);
assert.match(source.endpoint, /voice_catalog\.preview\.generate/);
assert.doesNotMatch(source.endpoint, /delete\(\)/);
assert.doesNotMatch(source.endpoint, /body\.api_key/);

assert.match(source.loader, /admin-runtime-voices\.js\?v=20260802-2/);
assert.match(source.customerPreview, /environmentHost\(process\.env\.SUPABASE_URL\)/);
assert.match(source.customerPreview, /preview_url,preview_text/);
assert.match(source.customerPreview, /hasManagedPreviewText/);
assert.match(source.customerPreview, /isManagedPreviewUrl/);
assert.match(source.customerPreview, /isLegacyManagedPreviewUrl/);
assert.match(source.customerPreview, /ignored_non_versioned_or_provider_preview/);
assert.match(source.customerPreview, /managed_preview_missing_and_tts_unavailable/);
assert.match(source.customerPreview, /'Cache-Control': 'no-store'/);

assert.match(source.migration, /add column if not exists preview_text text/);
assert.match(source.migration, /voice-previews/);
assert.match(source.migration, /file_size_limit/);
assert.match(source.migration, /allowed_mime_types/);
assert.match(source.migration, /voxera_voices_preview_text_length/);

console.log('Admin voice catalog verification passed.');
