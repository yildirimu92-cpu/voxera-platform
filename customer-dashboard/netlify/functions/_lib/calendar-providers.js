'use strict';

const { encryptSecret, decryptSecret } = require('./calendar-crypto');

const PROVIDERS = Object.freeze({
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.events'
    ]
  },
  microsoft: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Calendars.ReadWrite']
  }
});

function providerConfig(provider) {
  const definition = PROVIDERS[provider];
  if (!definition) throw new Error('calendar_provider_unsupported');
  const prefix = provider === 'google' ? 'GOOGLE_CALENDAR' : 'MICROSOFT_CALENDAR';
  const clientId = String(process.env[prefix + '_CLIENT_ID'] || '').trim();
  const clientSecret = String(process.env[prefix + '_CLIENT_SECRET'] || '').trim();
  const redirectUri = String(process.env.CALENDAR_OAUTH_REDIRECT_URI || '').trim();
  if (!clientId || !clientSecret || !redirectUri) throw new Error(provider + '_calendar_oauth_configuration_missing');
  try {
    if (new URL(redirectUri).protocol !== 'https:') throw new Error('invalid');
  } catch (_error) {
    throw new Error('calendar_oauth_redirect_uri_invalid');
  }
  return { ...definition, clientId, clientSecret, redirectUri };
}

function authorizationUrl(provider, state) {
  const config = providerConfig(provider);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state
  });
  if (provider === 'google') {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
    params.set('include_granted_scopes', 'true');
  } else {
    params.set('response_mode', 'query');
    params.set('prompt', 'select_account');
  }
  return config.authorizeUrl + '?' + params.toString();
}

async function tokenRequest(provider, fields) {
  const config = providerConfig(provider);
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error(payload.error_description || payload.error || 'calendar_token_exchange_failed');
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function exchangeAuthorizationCode(provider, code) {
  const config = providerConfig(provider);
  return tokenRequest(provider, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri
  });
}

async function refreshAccessToken(provider, refreshToken) {
  const config = providerConfig(provider);
  return tokenRequest(provider, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    ...(provider === 'microsoft' ? { scope: config.scopes.join(' ') } : {})
  });
}

function tokenExpiry(payload) {
  const seconds = Math.max(60, Number(payload.expires_in || 3600));
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function ensureAccessToken(sb, connection) {
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  const accessToken = decryptSecret(connection.access_token_encrypted);
  if (accessToken && (!expiresAt || expiresAt - Date.now() > 120000)) return { accessToken, connection };

  const refreshToken = decryptSecret(connection.refresh_token_encrypted);
  if (!refreshToken) {
    await sb.from('calendar_connections').update({
      status: 'reauthorization_required',
      last_error: 'refresh_token_missing',
      updated_at: new Date().toISOString()
    }).eq('id', connection.id);
    throw new Error('calendar_reauthorization_required');
  }

  try {
    const payload = await refreshAccessToken(connection.provider, refreshToken);
    const patch = {
      access_token_encrypted: encryptSecret(payload.access_token),
      refresh_token_encrypted: payload.refresh_token ? encryptSecret(payload.refresh_token) : connection.refresh_token_encrypted,
      token_expires_at: tokenExpiry(payload),
      status: 'connected',
      last_error: null,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await sb.from('calendar_connections').update(patch).eq('id', connection.id).select('*').maybeSingle();
    if (error) throw error;
    return { accessToken: payload.access_token, connection: data || { ...connection, ...patch } };
  } catch (error) {
    await sb.from('calendar_connections').update({
      status: 'reauthorization_required',
      last_error: String(error.message || error).slice(0, 500),
      updated_at: new Date().toISOString()
    }).eq('id', connection.id);
    throw error;
  }
}

async function apiFetch(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + accessToken,
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch (_error) { payload = { raw: text.slice(0, 500) }; }
  if (!response.ok) {
    const error = new Error(payload.error?.message || payload.error_description || payload.error || 'calendar_provider_api_failed');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function accountSnapshot(provider, accessToken) {
  if (provider === 'google') {
    const [profile, calendarData] = await Promise.all([
      apiFetch('https://openidconnect.googleapis.com/v1/userinfo', accessToken),
      apiFetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250&showHidden=false', accessToken)
    ]);
    const calendars = (calendarData.items || []).filter((item) => item.id).map((item) => ({
      id: item.id,
      name: item.summary || item.id,
      primary: item.primary === true,
      writable: ['owner', 'writer'].includes(item.accessRole),
      timezone: item.timeZone || null
    }));
    return {
      accountId: profile.sub || profile.email,
      email: profile.email || '',
      label: profile.name || profile.email || 'Google Calendar',
      calendars
    };
  }

  const [profile, calendarData] = await Promise.all([
    apiFetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', accessToken),
    apiFetch('https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,canEdit,isDefaultCalendar&$top=250', accessToken)
  ]);
  const calendars = (calendarData.value || []).filter((item) => item.id).map((item) => ({
    id: item.id,
    name: item.name || item.id,
    primary: item.isDefaultCalendar === true,
    writable: item.canEdit !== false,
    timezone: null
  }));
  return {
    accountId: profile.id,
    email: profile.mail || profile.userPrincipalName || '',
    label: profile.displayName || profile.mail || 'Microsoft 365',
    calendars
  };
}

// ── Belegte Zeiten aus einer Google-Terminliste ─────────────────────────────
//
// Eigene Funktion, damit sie ohne Netzzugriff pruefbar ist. Die Filterregeln
// sind der fachliche Kern, nicht der HTTP-Aufruf.
//
//   status 'cancelled'        -- abgesagt, belegt nichts
//   transparency 'transparent' -- "frei" in der Kalenderansicht, belegt nichts
//   excludeEventId            -- der Termin, den wir gerade selbst verschieben
//
// Ganztaegige Termine liefern `start.date` (ein reines Datum) statt
// `start.dateTime`. Der Rueckfall darauf ist Absicht: ein ganztaegiger Termin
// belegt den Tag, und ohne den Rueckfall wuerde er als `undefined` durchfallen
// und der Tag faelschlich als frei gelten.
function busyFromGoogleEvents(payload, excludeEventId = '') {
  return (payload?.items || [])
    .filter((item) => item.id !== excludeEventId && item.status !== 'cancelled' && item.transparency !== 'transparent')
    .map((item) => ({
      id: item.id,
      start: item.start?.dateTime || item.start?.date,
      end: item.end?.dateTime || item.end?.date
    }))
    .filter((item) => item.start && item.end);
}

function busyFromGraphEvents(payload, excludeEventId = '') {
  return (payload?.value || [])
    .filter((item) => item.id !== excludeEventId && !item.isCancelled && !['free', 'workingElsewhere'].includes(item.showAs))
    .map((item) => ({ id: item.id, start: item.start?.dateTime, end: item.end?.dateTime }))
    .filter((item) => item.start && item.end);
}

// KEIN freeBusy MEHR.
//
// Bis zum 2026-08-12 nahm diese Funktion fuer Google ohne `excludeEventId` den
// Endpunkt `calendar/v3/freeBusy`. Der verlangt einen der Bereiche `calendar`,
// `calendar.readonly` oder `calendar.freebusy`. Erteilt bekommen wir beim
// Verbinden aber `calendar.calendarlist.readonly` und `calendar.events` --
// freeBusy war damit nie erlaubt und antwortete mit 403.
//
// Wirkung: JEDE Verfuegbarkeitspruefung und damit auch jede Buchung schlug
// fehl, seit es die Funktion gibt. Nur `reschedule` kam durch, weil es mit
// `excludeEventId` schon immer in den Terminlisten-Zweig lief -- und der ist
// von `calendar.events` gedeckt. Belegt an drei Testanrufen am 12.08., alle
// drei mit gueltigem Zeitraum bis zum Google-Aufruf gekommen und dort gescheitert.
//
// Warum nicht den Bereich nachfordern: das schickt jeden bestehenden Kunden
// durch eine neue OAuth-Zustimmung. Die Bewilligung haengt am Refresh-Token,
// eine Codeaenderung allein erweitert sie nicht.
//
// Der Terminlisten-Zweig kann alles, was wir brauchen, und mehr: er liefert
// Termin-IDs und echte Intervalle statt nur "belegt ja/nein". Genau das
// braucht die Berechnung freier Zeitfenster (#951 P1) ohnehin.
async function checkAvailability(provider, accessToken, calendarId, startIso, endIso, excludeEventId = '') {
  if (provider === 'google') {
    const params = new URLSearchParams({
      timeMin: startIso,
      timeMax: endIso,
      singleEvents: 'true',
      showDeleted: 'false',
      maxResults: '250'
    });
    const payload = await apiFetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events?' + params.toString(), accessToken);
    // Eine abgeschnittene Liste darf nicht als "frei" durchgehen.
    //
    // freeBusy lieferte immer den ganzen Zeitraum. Die Terminliste ist
    // seitenweise: bei mehr Treffern als `maxResults` kommt ein
    // `nextPageToken`, und die fehlenden Termine saehen aus wie freie Zeit.
    // Lieber ein Fehler, der den Anrufer in den Rueckrufweg schickt, als eine
    // Zusage auf unvollstaendiger Grundlage.
    if (payload?.nextPageToken) {
      const error = new Error('calendar_busy_list_truncated');
      error.status = 502;
      throw error;
    }
    const busy = busyFromGoogleEvents(payload, excludeEventId);
    return { available: busy.length === 0, busy };
  }

  const params = new URLSearchParams({ startDateTime: startIso, endDateTime: endIso, '$select': 'id,start,end,showAs,isCancelled' });
  const payload = await apiFetch('https://graph.microsoft.com/v1.0/me/calendars/' + encodeURIComponent(calendarId) + '/calendarView?' + params.toString(), accessToken, {
    headers: { Prefer: 'outlook.timezone="UTC"' }
  });
  const busy = busyFromGraphEvents(payload, excludeEventId);
  return { available: busy.length === 0, busy };
}

function googleEvent(input) {
  return {
    summary: input.title,
    description: input.description || '',
    start: { dateTime: input.start, timeZone: 'UTC' },
    end: { dateTime: input.end, timeZone: 'UTC' },
    attendees: (input.attendees || []).filter(Boolean).map((email) => ({ email }))
  };
}

function microsoftEvent(input) {
  return {
    subject: input.title,
    body: { contentType: 'text', content: input.description || '' },
    start: { dateTime: input.start, timeZone: 'UTC' },
    end: { dateTime: input.end, timeZone: 'UTC' },
    attendees: (input.attendees || []).filter(Boolean).map((address) => ({
      emailAddress: { address }, type: 'required'
    }))
  };
}

async function createEvent(provider, accessToken, calendarId, input) {
  if (provider === 'google') {
    return apiFetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events?sendUpdates=all', accessToken, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(googleEvent(input))
    });
  }
  return apiFetch('https://graph.microsoft.com/v1.0/me/calendars/' + encodeURIComponent(calendarId) + '/events', accessToken, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(microsoftEvent(input))
  });
}

async function updateEvent(provider, accessToken, calendarId, eventId, input) {
  if (provider === 'google') {
    return apiFetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId) + '?sendUpdates=all', accessToken, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(googleEvent(input))
    });
  }
  return apiFetch('https://graph.microsoft.com/v1.0/me/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId), accessToken, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(microsoftEvent(input))
  });
}

async function deleteEvent(provider, accessToken, calendarId, eventId) {
  const base = provider === 'google'
    ? 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId) + '?sendUpdates=all'
    : 'https://graph.microsoft.com/v1.0/me/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId);
  const response = await fetch(base, { method: 'DELETE', headers: { Authorization: 'Bearer ' + accessToken } });
  if (!response.ok && response.status !== 404) throw new Error('calendar_event_delete_failed');
  return { deleted: true, already_missing: response.status === 404 };
}

module.exports = {
  PROVIDERS,
  providerConfig,
  authorizationUrl,
  exchangeAuthorizationCode,
  tokenExpiry,
  ensureAccessToken,
  accountSnapshot,
  checkAvailability,
  createEvent,
  updateEvent,
  deleteEvent,
  // Ohne Netzzugriff pruefbar -- die Filterregeln sind der fachliche Kern.
  _test: { busyFromGoogleEvents, busyFromGraphEvents }
};
