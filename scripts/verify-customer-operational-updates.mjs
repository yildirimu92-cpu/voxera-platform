import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const files = {
  migration: 'supabase/migrations/2026-08-01_customer_operational_updates.sql',
  api: 'customer-dashboard/netlify/functions/customer-operational-updates.js',
  runtime: 'customer-dashboard/shared/customer-runtime-operational-updates.js',
  loader: 'customer-dashboard/shared/offer-brand.js',
  prompt: 'admin-panel/netlify/functions/_lib/prompt-builder-v2.js',
  trigger: 'admin-panel/netlify/functions/trigger-elevenlabs-sync.js',
  guard: 'admin-panel/netlify/functions/_lib/require-prompt-sync-caller.js',
  assistant: 'customer-dashboard/netlify/functions/customer-update-assistant.js',
  proxy: 'customer-dashboard/netlify/functions/elevenlabs-sync-prompt.js'
};
const source = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')]));
const failures = [];
for (const key of ['api','runtime','loader','prompt','trigger','guard','assistant','proxy']) {
  try { new vm.Script(source[key], { filename: files[key] }); }
  catch (error) { failures.push(error.message); }
}
for (const token of ['customer_id text','ends_at > starts_at',"status in ('published','cancelled')",'enable row level security','revoke all']) {
  if (!source.migration.includes(token)) failures.push('Migration missing: ' + token);
}
for (const token of ['requireCustomerCaller','allowedTypes','parseWindow',".eq('customer_id', caller.customerId)",'Authorization: authorization','sync_status']) {
  if (!source.api.includes(token)) failures.push('Customer API guard missing: ' + token);
}
for (const token of ['Aktuelle Änderungen werden geladen','Ferien / geschlossen','Geänderte Öffnungszeiten','Temporäre Angaben dürfen keine dauerhaften Leistungen, Preise','customer-operational-updates']) {
  if (!source.runtime.includes(token)) failures.push('Operational UI missing: ' + token);
}
for (const token of ['Empfohlene Gesprächslogik','Bestehende Termine','Notfälle','Termine nach dem Zeitraum anbieten']) {
  if (!source.runtime.includes(token)) failures.push('Guided operational UI missing: ' + token);
}
assert.doesNotMatch(source.runtime, /Aktuelle Betriebsinfos/);
if (!source.loader.includes('/shared/customer-runtime-operational-updates.js')) failures.push('Runtime loader missing');
for (const key of ['api','assistant','proxy']) {
  if (!source[key].includes('Authorization')) failures.push('Customer authorization forwarding missing in ' + files[key]);
}
for (const token of ['requirePromptSyncCaller','operationalUpdates','customer_operational_updates']) {
  if (!source.trigger.includes(token)) failures.push('Prompt sync missing: ' + token);
}
const { buildPromptV2 } = require('../admin-panel/netlify/functions/_lib/prompt-builder-v2.js');
const result = buildPromptV2({
  customer: {
    customer_name: 'Voxera Test AG',
    ai_business_description: 'AI-Telefonassistenz.',
    ai_services: 'Telefonannahme.',
    ai_response_constraints: 'Keine Preise erfinden.'
  },
  masterPrompt: '{{CUSTOMER_LAYER}}',
  operationalUpdates: [{
    type: 'closure',
    title: 'Betriebsferien',
    message: 'Vom 24. Dezember bis 2. Januar geschlossen.',
    behavior: 'Rückrufanfragen aufnehmen.',
    starts_at: '2026-12-24T00:00:00.000Z',
    ends_at: '2027-01-03T00:00:00.000Z',
    status: 'published'
  }]
});
assert.match(result.prompt, /AKTUELLE BETRIEBSINFORMATIONEN/);
assert.match(result.prompt, /Betriebsferien/);
assert.match(result.prompt, /Rückrufanfragen aufnehmen/);
assert.match(result.prompt, /nur innerhalb des angegebenen Zeitfensters/);
const withoutCancelled = buildPromptV2({
  customer: { customer_name: 'Test' },
  masterPrompt: '{{CUSTOMER_LAYER}}',
  operationalUpdates: [{ ...result, status: 'cancelled', title: 'Nicht anzeigen' }]
});
assert.doesNotMatch(withoutCancelled.prompt, /Nicht anzeigen/);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Customer operational updates verification passed.');
