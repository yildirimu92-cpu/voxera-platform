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
  'Vorschau neu erzeugen',
  "callAdminFunction('admin-voices'",
  "action: 'generate_preview'",
  'assigned_customers',
  'Im Kundenportal aktiv',
  'Standardstimme'
]) assert.match(source.runtime, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

assert.match(source.endpoint, /requireAdminCaller/);
assert.match(source.endpoint, /requiredCapability: 'plan:write'/);
assert.match(source.endpoint, /from\('voxera_voices'\)/);
assert.match(source.endpoint, /from\('customers'\)/);
assert.match(source.endpoint, /storage\s*\.from\(BUCKET\)\s*\.upload/);
assert.match(source.endpoint, /output_format=mp3_44100_128/);
assert.match(source.endpoint, /text: previewText/);
assert.match(source.endpoint, /detectMp3/);
assert.match(source.endpoint, /voice_catalog\.preview\.generate/);
assert.doesNotMatch(source.endpoint, /delete\(\)/);
assert.doesNotMatch(source.endpoint, /body\.api_key/);

assert.match(source.loader, /admin-runtime-voices\.js\?v=20260802-1/);
assert.match(source.customerPreview, /environmentHost\(process\.env\.SUPABASE_URL\)/);
assert.match(source.customerPreview, /preview_url,preview_text/);
assert.match(source.customerPreview, /voice\.preview_text/);

assert.match(source.migration, /add column if not exists preview_text text/);
assert.match(source.migration, /voice-previews/);
assert.match(source.migration, /file_size_limit/);
assert.match(source.migration, /allowed_mime_types/);
assert.match(source.migration, /voxera_voices_preview_text_length/);

console.log('Admin voice catalog verification passed.');
