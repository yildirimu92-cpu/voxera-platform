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
  // Codex-Befund vom 12.08.: der Seitendeckel war als Endlossperre gedacht, ist
  // aber eine echte Grenze -- es gibt keine Zusicherung, wie dicht die Termine
  // eines Kunden liegen duerfen. Wird er erreicht und der Anbieter bietet
  // weiter an, muss GEWORFEN werden: eine abgebrochene Belegungsliste sieht wie
  // eine vollstaendige aus, und der Aufrufer wuerde belegte Zeiten anbieten.
  const echtesFetch3 = globalThis.fetch;
  globalThis.fetch = async () => antwort({
    value: [{ id: 'x', start: { dateTime: '2026-08-11T08:00:00' }, end: { dateTime: '2026-08-11T08:30:00' } }],
    '@odata.nextLink': 'https://graph.microsoft.com/v1.0/immer-weiter'
  });
  try {
    await providers.checkAvailability('microsoft', 'token', 'cal_1', '2026-08-11T08:00:00Z', '2026-08-11T12:00:00Z');
    failures.push('Microsoft-Belegung bricht am Seitendeckel still ab, statt zu scheitern');
  } catch (error) {
    if (error.message !== 'calendar_busy_list_truncated') {
      failures.push('Unerwarteter Fehler am Seitendeckel: ' + error.message);
    }
  } finally { globalThis.fetch = echtesFetch3; }

  globalThis.fetch = async () => antwort({
    items: [{ id: 'y', start: { dateTime: '2026-08-11T08:00:00Z' }, end: { dateTime: '2026-08-11T08:30:00Z' } }],
    nextPageToken: 'immer-weiter'
  });
  try {
    await providers.checkAvailability('google', 'token', 'cal_1', '2026-08-11T08:00:00Z', '2026-08-11T12:00:00Z', 'evt_aus');
    failures.push('Google-Belegung bricht am Seitendeckel still ab, statt zu scheitern');
  } catch (error) {
    if (error.message !== 'calendar_busy_list_truncated') {
      failures.push('Unerwarteter Fehler am Seitendeckel (Google): ' + error.message);
    }
  } finally { globalThis.fetch = echtesFetch3; }
  // Scope-Fix: Google wird ausschliesslich ueber die Terminliste gefragt.
  // `calendar.events` autorisiert `freebusy.query` NICHT, und die angeforderten
  // Scopes sind genau calendarlist.readonly + events. Ein breiterer Scope haette
  // jeden verbundenen Kunden zur erneuten Zustimmung gezwungen.
  gefragt = [];
  globalThis.fetch = async (url) => {
    gefragt.push(String(url));
    return antwort({ items: [{ id: 'g1', start: { dateTime: '2026-08-11T08:00:00Z' }, end: { dateTime: '2026-08-11T08:30:00Z' } }] });
  };
  try {
    // Ohne excludeEventId -- genau der Weg, der vorher auf freeBusy ging.
    await providers.checkAvailability('google', 'token', 'cal_1', '2026-08-11T08:00:00Z', '2026-08-11T12:00:00Z');
    if (gefragt.some((url) => url.includes('freeBusy'))) {
      failures.push('Google-Verfuegbarkeit fragt wieder freeBusy -- der Scope calendar.events deckt das nicht ab');
    }
    if (!gefragt.some((url) => url.includes('/events?'))) {
      failures.push('Google-Verfuegbarkeit fragt nicht die Terminliste');
    }
  } finally { globalThis.fetch = echtesFetch; }
} catch (error) {
  failures.push('Calendar availability paging test failed: ' + error.message);
}

// Der Quelltext darf freeBusy nicht mehr aufrufen. Die Suche schliesst
// Kommentarzeilen aus, damit die Begruendung stehen bleiben darf.
{
  const aufrufe = source.providers
    .split('\n')
    .filter((zeile) => !zeile.trim().startsWith('//'))
    .filter((zeile) => zeile.includes('freeBusy'));
  if (aufrufe.length) {
    failures.push('calendar-providers.js ruft weiterhin freeBusy auf: ' + aufrufe[0].trim());
  }
}
// ── Die angeforderten OAuth-Bereiche ────────────────────────────────────────
//
// Geprueft wird die LISTE, nicht der Dateitext. Vorher stand hier eine
// Textsuche nach `calendar.events` -- die haette auch ein Kommentar erfuellt,
// in dem das Wort vorkommt, und genau darueber steht einer. Was sich als Liste
// pruefen laesst, wird als Liste geprueft.
//
// Die Endpunkt-Pruefung weiter oben faengt diesen Fall NICHT: sie sieht, welche
// URL aufgerufen wird, nicht, welche Berechtigung dafuer angefordert wird.
// Traegt jemand `calendar.readonly` ein -- etwa um freeBusy "wieder zu
// ermoeglichen" --, bleibt sie gruen. Der Schaden waere still: die Bewilligung
// haengt am Refresh-Token, also braeuchte JEDER bereits verbundene Kunde eine
// neue Zustimmung, und bis dahin merkt es niemand.
{
  const providerModule = require('../customer-dashboard/netlify/functions/_lib/calendar-providers.js');
  const google = providerModule.PROVIDERS?.google?.scopes;
  if (!Array.isArray(google)) {
    failures.push('PROVIDERS.google.scopes ist keine Liste mehr -- die Bereichspruefung greift ins Leere');
  } else {
    for (const noetig of [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
    ]) {
      if (!google.includes(noetig)) failures.push('Der erteilte Bereich ' + noetig + ' fehlt');
    }
    for (const breiter of [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.freebusy'
    ]) {
      if (google.includes(breiter)) {
        failures.push('Neuer OAuth-Bereich ' + breiter + ': das zwingt jeden verbundenen Kunden zu einer erneuten Zustimmung');
      }
    }
  }

  // Microsoft deckt mit Calendars.ReadWrite beides ab. Ein zweiter Bereich
  // waere derselbe Zustimmungsbruch.
  const microsoft = providerModule.PROVIDERS?.microsoft?.scopes;
  if (!Array.isArray(microsoft) || !microsoft.includes('Calendars.ReadWrite')) {
    failures.push('Der Microsoft-Bereich Calendars.ReadWrite fehlt');
  }
}

// ── Die Fenstergrenze rechnet mit Puffern ───────────────────────────────────
//
// Der Fall aus dem Testanruf vom 12.08.: 09:00-17:00 Ortszeit sind genau acht
// Stunden und gingen durch -- abgefragt wurden mit buffer_after_minutes = 10
// aber acht Stunden zehn Minuten. Die Schranke sass auf der angefragten Spanne,
// nicht auf der abgefragten.
{
  const { windowSpanError, bufferedWindow, MAX_WINDOW_MS } =
    require('../customer-dashboard/netlify/functions/_lib/booking-window.js');
  const START = '2026-08-18T08:00:00Z';
  const nach = (stunden) => new Date(new Date(START).getTime() + stunden * 3600000).toISOString();

  const faelle = [
    ['genau 8 Stunden ohne Puffer bleiben erlaubt', nach(8), { buffer_after_minutes: 0 }, null],
    ['8 Stunden plus Puffer danach werden abgelehnt', nach(8), { buffer_after_minutes: 10 }, 'calendar_time_window_too_large'],
    ['auch ein Puffer davor zaehlt mit', nach(8), { buffer_before_minutes: 15 }, 'calendar_time_window_too_large'],
    ['ein Halbtag mit Puffern bleibt erlaubt', nach(4), { buffer_before_minutes: 15, buffer_after_minutes: 10 }, null],
    ['ein verdrehter Zeitraum wird abgewiesen', '2026-08-18T07:00:00Z', {}, 'calendar_time_window_invalid'],
    ['ein leerer Zeitraum wird abgewiesen', START, {}, 'calendar_time_window_invalid'],
    ['ein fehlendes Ende wird abgewiesen', null, {}, 'calendar_time_window_invalid'],
    ['eine unlesbare Zeitangabe wird abgewiesen', 'kein Datum', {}, 'calendar_time_window_invalid']
  ];
  for (const [name, ende, settings, erwartet] of faelle) {
    const ergebnis = windowSpanError(START, ende, settings);
    if (ergebnis !== erwartet) {
      failures.push(`Fenstergrenze, ${name}: erwartet ${erwartet}, bekommen ${ergebnis}`);
    }
  }

  // Die gepufferte Spanne ist genau das, was abgefragt wird -- sonst prueft die
  // Schranke wieder etwas anderes als den Aufruf.
  const w = bufferedWindow(START, nach(1), { buffer_before_minutes: 15, buffer_after_minutes: 10 });
  if (new Date(w.end).getTime() - new Date(w.start).getTime() !== 85 * 60000) {
    failures.push('bufferedWindow() rechnet die Puffer nicht in die Spanne');
  }
  if (MAX_WINDOW_MS !== 8 * 60 * 60 * 1000) {
    failures.push('Die Fenstergrenze im Code entspricht nicht den im Prompt genannten 8 Stunden');
  }

  // Das Werkzeug darf die Spanne nicht wieder selbst rechnen.
  const eigeneRechnung = source.tool
    .split('\n')
    .filter((zeile) => !zeile.trim().startsWith('//'))
    .filter((zeile) => /end - start > /.test(zeile));
  if (eigeneRechnung.length) {
    failures.push('calendar-tool.js prueft die Spanne wieder selbst: ' + eigeneRechnung[0].trim());
  }
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
