import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ladeAdminApi, ADMIN_API_PATH } from './lib/admin-api-harness.mjs';

const files = {
  runtime: 'admin-panel/shared/admin-runtime-voices.js',
  // Welle 1: admin-runtime-voice-errors.js ist aufgeloest. Es hat
  // callAdminFunction nur umwickelt, um vier ElevenLabs-Fehlercodes in
  // verstaendliche Saetze zu uebersetzen. Das ist jetzt describeError() in
  // core/admin-api.js -- kein Wrapper, sondern ein Woerterbuch.
  errorRuntime: ADMIN_API_PATH,
  endpoint: 'admin-panel/netlify/functions/admin-voices.js',
  loader: 'admin-panel/shared/offer-brand.js',
  customerPreview: 'customer-dashboard/netlify/functions/preview-voice.js',
  migration: 'supabase/migrations/2026-08-02_admin_voice_catalog_previews.sql'
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')])
);

for (const key of ['runtime', 'errorRuntime', 'endpoint', 'loader', 'customerPreview']) {
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

// Die vier Fehlercodes werden nicht mehr im Quelltext gesucht, sondern
// durchgereicht: dieselbe Funktion, die der Browser aufruft.
{
  const { api } = ladeAdminApi();
  const uebersetzt = (code) => api.describeError('admin-voices',
    Object.assign(new Error('Request failed'), { payload: { provider_code: code, error: 'Request failed' } }));

  assert.match(uebersetzt('payment_required').message, /aktives ElevenLabs-Abonnement/);
  assert.match(uebersetzt('missing_permissions').message, /Text zu Sprache/);
  assert.match(uebersetzt('quota_exceeded').message, /Guthaben ist aufgebraucht/);
  assert.match(uebersetzt('credits_exhausted').message, /Guthaben ist aufgebraucht/);
  // Die Nutzlast muss mitgezogen werden, sonst zeigt die Oberflaeche weiter den
  // englischen Rohtext an.
  assert.match(uebersetzt('payment_required').payload.error, /aktives ElevenLabs-Abonnement/);
  // Unbekannte Codes und fremde Endpunkte bleiben unberuehrt (Gegenprobe).
  assert.equal(uebersetzt('etwas_anderes').message, 'Request failed');
  assert.equal(
    api.describeError('admin-mutate', Object.assign(new Error('Request failed'), { payload: { provider_code: 'payment_required' } })).message,
    'Request failed'
  );
  // Kein Wrapper mehr: die Uebersetzung haengt nicht an einer Neuzuweisung.
  assert.doesNotMatch(source.errorRuntime, /root\.callAdminFunction\s*=\s*[^=]/);
}

assert.match(source.endpoint, /requireAdminCaller/);
// admin-voices.js gates capability per action: catalog management (list/update/preview)
// stays plan:write, the customer-scoped voice picker read (Admin-Zugriff Fix) is
// customer:write so support/admin can serve the wizard without plan-edit rights.
assert.match(source.endpoint, /list:\s*'plan:write'/);
assert.match(source.endpoint, /update:\s*'plan:write'/);
assert.match(source.endpoint, /test_preview:\s*'plan:write'/);
assert.match(source.endpoint, /generate_preview:\s*'plan:write'/);
assert.match(source.endpoint, /list_for_customer:\s*'customer:write'/);
assert.match(source.endpoint, /const requiredCapability = ACTION_CAPABILITIES\[action\]/);
assert.match(source.endpoint, /action === 'list_for_customer'/);
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
// admin-runtime-voice-errors.js wird nicht mehr nachgeladen; core/admin-api.js
// steht als Skript-Tag im Kopf von index.html, also garantiert vor dem ersten
// Aufruf statt im Nachladerennen.
assert.doesNotMatch(source.loader, /admin-runtime-voice-errors\.js/);
assert.match(fs.readFileSync('admin-panel/index.html', 'utf8'), /\/shared\/core\/admin-api\.js/);
assert.match(source.customerPreview, /environmentHost\(process\.env\.SUPABASE_URL\)/);
assert.match(source.customerPreview, /preview_url,preview_text/);
assert.match(source.customerPreview, /hasManagedPreviewText/);
assert.match(source.customerPreview, /isManagedPreviewUrl/);
assert.match(source.customerPreview, /isLegacyManagedPreviewUrl/);
assert.match(source.customerPreview, /ignored_non_versioned_or_provider_preview/);
assert.match(source.customerPreview, /managed_preview_not_generated/);
assert.match(source.customerPreview, /elevenlabs-provider-fallback/);
assert.match(source.customerPreview, /custom-preview-pending/);
assert.match(source.customerPreview, /Customer clicks must never consume TTS credits/);
assert.match(source.customerPreview, /'Cache-Control': 'no-store'/);

assert.match(source.migration, /add column if not exists preview_text text/);
assert.match(source.migration, /voice-previews/);
assert.match(source.migration, /file_size_limit/);
assert.match(source.migration, /allowed_mime_types/);
assert.match(source.migration, /voxera_voices_preview_text_length/);

console.log('Admin voice catalog verification passed.');
