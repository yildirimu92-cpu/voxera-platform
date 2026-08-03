import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const files = {
  migration: 'supabase/migrations/2026-08-01_calendar_integrations_foundation.sql',
  crypto: 'customer-dashboard/netlify/functions/_lib/calendar-crypto.js',
  rollout: 'customer-dashboard/netlify/functions/_lib/calendar-rollout.js',
  providers: 'customer-dashboard/netlify/functions/_lib/calendar-providers.js',
  connections: 'customer-dashboard/netlify/functions/calendar-connections.js',
  callback: 'customer-dashboard/netlify/functions/calendar-oauth-callback.js',
  tool: 'customer-dashboard/netlify/functions/calendar-tool.js',
  runtime: 'customer-dashboard/shared/customer-runtime-calendar-settings.js',
  css: 'customer-dashboard/shared/customer-settings-components.css',
  loader: 'customer-dashboard/shared/offer-brand.js',
  designLoader: 'customer-dashboard/shared/customer-runtime-design-foundation.js',
  docs: 'docs/calendar-integration-setup.md'
};
const source = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')]));
const failures = [];

for (const key of ['crypto','rollout','providers','connections','callback','tool','runtime','loader','designLoader']) {
  try { new vm.Script(source[key], { filename: files[key] }); }
  catch (error) { failures.push(error.message); }
}

process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
try {
  const cryptoModule = require('../customer-dashboard/netlify/functions/_lib/calendar-crypto.js');
  const encrypted = cryptoModule.encryptSecret('calendar-secret');
  if (encrypted === 'calendar-secret' || cryptoModule.decryptSecret(encrypted) !== 'calendar-secret') {
    failures.push('Calendar secret encryption roundtrip failed');
  }
} catch (error) {
  failures.push('Calendar crypto test failed: ' + error.message);
}

process.env.CALENDAR_OAUTH_REDIRECT_URI = 'https://dashboard.voxera.ch/.netlify/functions/calendar-oauth-callback';
process.env.GOOGLE_CALENDAR_CLIENT_ID = 'google-client';
process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'google-secret';
delete process.env.MICROSOFT_CALENDAR_CLIENT_ID;
delete process.env.MICROSOFT_CALENDAR_CLIENT_SECRET;
try {
  const providerModule = require('../customer-dashboard/netlify/functions/_lib/calendar-providers.js');
  providerModule.providerConfig('google');
  let microsoftMissing = false;
  try { providerModule.providerConfig('microsoft'); }
  catch (error) { microsoftMissing = error.message === 'microsoft_calendar_oauth_configuration_missing'; }
  if (!microsoftMissing) failures.push('Unconfigured Microsoft provider must remain unavailable');
} catch (error) {
  failures.push('Optional provider configuration test failed: ' + error.message);
}

for (const token of ['calendar_connections','calendar_settings','calendar_oauth_states','calendar_booking_audit','customer_id, request_id','enable row level security']) {
  if (!source.migration.includes(token)) failures.push('Migration missing: ' + token);
}
for (const token of ['CALENDAR_INTEGRATION_ENABLED','CALENDAR_ROLLOUT_CUSTOMER_IDS',"allowed.has('*')"]) {
  if (!source.rollout.includes(token)) failures.push('Calendar rollout guard missing: ' + token);
}
for (const key of ['connections','callback','tool']) {
  if (!source[key].includes('calendarEnabledForCustomer')) failures.push('Calendar customer guard missing in ' + files[key]);
}
for (const token of ["google:", "microsoft:", 'calendar.calendarlist.readonly', 'Calendars.ReadWrite', 'ensureAccessToken', 'checkAvailability', 'createEvent', 'updateEvent', 'deleteEvent']) {
  if (!source.providers.includes(token)) failures.push('Provider adapter missing: ' + token);
}
for (const token of ["process.env.CALENDAR_INTEGRATION_ENABLED !== 'true'"]) {
  if (!source.rollout.includes(token) && !source.tool.includes(token)) failures.push('Feature guard missing: ' + token);
}
for (const token of ['requireCustomerCaller','oauth_start','save_settings','calendar_setting_invalid','calendar_active_provider_not_ready','calendar_provider_not_configured','available_providers','select_calendar','disconnect']) {
  if (!source.connections.includes(token)) failures.push('Connection workflow missing: ' + token);
}
for (const token of ['hashState(state)',".is('used_at', null)",".gt('expires_at', now)",'encryptSecret(token.access_token)','calendar_refresh_token_missing']) {
  if (!source.callback.includes(token)) failures.push('OAuth callback guard missing: ' + token);
}
for (const token of ['Authorization','Bearer','verifyToolAuth','X-Voxera-Timestamp','X-Voxera-Signature','calendar_agent_id_required','calendar_request_id_required',".eq('customer_id', customerId)",'bufferedWindow','request_id','availability','reschedule','cancel']) {
  if (!source.tool.includes(token)) failures.push('Calendar tool contract missing: ' + token);
}
for (const token of [
  'Google Calendar',
  'Microsoft 365 / Outlook',
  'visibleProviders()',
  'state.enabled && providers.length',
  'vxCalendarOpen',
  "entry.addEventListener('click', open)",
  'data-cal-back',
  'vx-settings-entry vx-settings-entry--calendar',
  'vx-cal-rules-card',
  'vx-cal-checkbox',
  "page.removeAttribute('style')",
  'entry.hidden = !(state.enabled && providers.length)'
]) {
  if (!source.runtime.includes(token)) failures.push('Calendar UI missing: ' + token);
}
for (const token of [
  '.vx-settings-entry',
  '.vx-cal-page-header',
  '.vx-cal-grid',
  '.vx-cal-card',
  '.vx-cal-provider',
  '.vx-cal-pill.ok',
  '.vx-cal-banner.ok',
  '.vx-cal-status.loading',
  '.vx-cal-form',
  '.vx-cal-checkbox',
  '@media (max-width: 720px)',
  '@media (max-width: 390px)'
]) {
  if (!source.css.includes(token)) failures.push('Calendar component CSS missing: ' + token);
}
for (const forbidden of [
  "createElement('style')",
  'style.textContent',
  'vx-calendar-settings-style',
  'entry.style.cssText',
  '.style.display',
  ' style="'
]) {
  if (source.runtime.includes(forbidden)) failures.push('Calendar runtime still owns presentation: ' + forbidden);
}
if ((source.css.match(/!important/g) || []).length) failures.push('Calendar component CSS must not use !important');
if (!source.loader.includes('/shared/customer-runtime-calendar-settings.js?v=20260803-2')) failures.push('Calendar runtime cache version missing');
if (!source.designLoader.includes('/shared/customer-settings-components.css?v=20260803-2')) failures.push('Calendar component stylesheet loader missing');

for (const key of ['connections','callback','tool']) {
  if (/console\.(log|warn|error)\([^\n]*(access_token|refresh_token|client_secret)/i.test(source[key])) {
    failures.push('Potential calendar secret logging in ' + files[key]);
  }
}
if (!source.docs.includes('CALENDAR_INTEGRATION_ENABLED=false')) failures.push('Disabled-by-default setup documentation missing');
if (!source.docs.includes('Microsoft OAuth variables are optional')) failures.push('Optional Microsoft setup documentation missing');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Calendar integration verification passed with canonical design ownership.');
