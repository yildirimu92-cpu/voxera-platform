import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  endpoint: 'customer-dashboard/netlify/functions/preview-voice.js',
  runtime: 'customer-dashboard/shared/customer-runtime-voice-preview-fallback.js',
  loader: 'customer-dashboard/shared/offer-brand.js'
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')])
);

for (const [key, path] of Object.entries(files)) {
  new vm.Script(source[key], { filename: path });
}

assert.match(source.endpoint, /Access-Control-Expose-Headers/);
assert.match(source.endpoint, /X-Voxera-Preview-Notice/);
assert.match(source.endpoint, /custom-preview-pending/);
assert.match(source.endpoint, /elevenlabs-provider-fallback/);
assert.match(source.endpoint, /Customer clicks must never consume TTS credits/);
assert.match(source.endpoint, /loadElevenLabsMetadataPreview\(/);
assert.doesNotMatch(
  source.endpoint,
  /if \(hasManagedPreviewText\)[\s\S]{0,900}synthesizePreview\(/,
  'Managed customer previews must not trigger paid TTS generation.'
);

assert.match(source.runtime, /addEventListener\('click', intercept, true\)/);
assert.match(source.runtime, /stopImmediatePropagation/);
assert.match(source.runtime, /custom-preview-pending/);
assert.match(source.runtime, /Vorläufige Standardvorschau/);
assert.match(source.runtime, /payment_required/);
assert.match(source.runtime, /loading = true/);
assert.match(source.runtime, /querySelectorAll\('\[data-vx-preview\]'\)/);
assert.match(source.runtime, /cache: 'no-store'/);

assert.match(source.loader, /customer-runtime-voice-preview-fallback\.js\?v=20260802-1/);
assert.match(source.loader, /__vxVoicePreviewFallbackLoaderInstalled/);
assert.doesNotMatch(source.loader, /customer-runtime-assistant-business-menu\.js/);

console.log('Customer voice preview fallback verification passed.');
