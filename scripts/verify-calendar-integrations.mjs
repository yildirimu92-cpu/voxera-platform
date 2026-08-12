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
  navigationCss: 'customer-dashboard/shared/customer-navigation-components.css',
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

// Codex-Befund vom 12.08. auf #951: die Terminlisten wurden ohne Blaetterung
// geholt. Microsoft Graph liefert fuer `calendarView` ohne `$top` nur zehn
// Eintraege pro Seite. Solange `available` als `busy.length === 0` definiert
// war, blieb das folgenlos -- eine abgeschnittene Liste war immer noch nicht
// leer. Mit der Slot-Zerlegung aus #951 wird die Luecke schaedlich: ein Termin
// auf der zweiten Seite sieht frei aus, und der Agent bietet eine Zeit an, die
// `book` anschliessend ablehnt.
try {
  const providers = require('../customer-dashboard/netlify/functions/_lib/calendar-providers.js');
  const echtesFetch = globalThis.fetch;
  const antwort = (payload) => new Response(JSON.stringify(payload), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });

  // Microsoft: zwei Seiten ueber @odata.nextLink.
  let gefragt = [];
  globalThis.fetch = async (url) => {
    gefragt.push(String(url));
    return String(url).includes('seite2')
      ? antwort({ value: [{ id: 'm2', start: { dateTime: '2026-08-11T10:00:00' }, end: { dateTime: '2026-08-11T10:30:00' } }] })
      : antwort({
          value: [{ id: 'm1', start: { dateTime: '2026-08-11T08:00:00' }, end: { dateTime: '2026-08-11T08:30:00' } }],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/seite2'
        });
  };
  try {
    const result = await providers.checkAvailability('microsoft', 'token', 'cal_1', '2026-08-11T08:00:00Z', '2026-08-11T12:00:00Z');
    if (result.busy.length !== 2) {
      failures.push(`Microsoft-Belegung wird nicht durchgeblaettert (${result.busy.length} statt 2 Eintraegen)`);
    }
    if (!gefragt.some((url) => url.includes('seite2'))) failures.push('Microsoft @odata.nextLink wird nicht gefolgt');
    if (!gefragt[0].includes('%24top=250') && !gefragt[0].includes('$top=250')) {
      failures.push('Microsoft calendarView fragt ohne $top -- Graph blaettert dann in Zehnerschritten');
    }
  } finally { globalThis.fetch = echtesFetch; }

  // Google: zwei Seiten ueber nextPageToken. Der Ausschlusspfad (reschedule)
  // benutzt dieselbe Liste.
  gefragt = [];
  globalThis.fetch = async (url) => {
    gefragt.push(String(url));
    return String(url).includes('pageToken')
      ? antwort({ items: [{ id: 'g2', start: { dateTime: '2026-08-11T10:00:00Z' }, end: { dateTime: '2026-08-11T10:30:00Z' } }] })
      : antwort({
          items: [{ id: 'g1', start: { dateTime: '2026-08-11T08:00:00Z' }, end: { dateTime: '2026-08-11T08:30:00Z' } }],
          nextPageToken: 'weiter'
        });
  };
  try {
    const result = await providers.checkAvailability('google', 'token', 'cal_1', '2026-08-11T08:00:00Z', '2026-08-11T12:00:00Z', 'evt_aus');
    if (result.busy.length !== 2) {
      failures.push(`Google-Belegung wird nicht durchgeblaettert (${result.busy.length} statt 2 Eintraegen)`);
    }
  } finally { globalThis.fetch = echtesFetch; }
} catch (error) {
  failures.push('Calendar availability paging test failed: ' + error.message);
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
  'entry.hidden = false;',
  'vxCalendarOpen',
  "entry.addEventListener('click', open)",
  'data-cal-back',
  'vx-settings-entry vx-settings-entry--calendar',
  'vx-appbar',
  'vx-cal-rules-card',
  'vx-cal-checkbox',
  "page.removeAttribute('style')",
  'if (entry) entry.hidden = false;'
]) {
  if (!source.runtime.includes(token)) failures.push('Calendar UI missing: ' + token);
}
if (source.runtime.includes('entry.hidden = !(state.enabled && providers.length)')) {
  failures.push('Calendar UI contains stale conditional entry visibility');
}
for (const token of [
  '.vx-settings-entry',
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
// The calendar page header is the shared app bar, owned by the navigation
// module — the settings module must not grow a second one.
for (const token of ['.vx-appbar', '.vx-appbar-back', '.vx-appbar-title']) {
  if (!source.navigationCss.includes(token)) failures.push('Screen header component missing: ' + token);
}
for (const forbidden of ['.vx-cal-page-header', '.vx-cal-back', '.vx-cal-header-subtitle']) {
  if (source.css.includes(forbidden)) failures.push('Settings CSS still owns a calendar page header: ' + forbidden);
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
if (!source.loader.includes('/shared/customer-runtime-calendar-settings.js?v=20260809-1')) failures.push('Calendar runtime cache version missing');
if (!source.designLoader.includes('/shared/customer-settings-components.css?v=20260809-3')) failures.push('Calendar component stylesheet loader missing');

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
