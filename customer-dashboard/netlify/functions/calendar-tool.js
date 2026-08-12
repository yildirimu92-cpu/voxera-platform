'use strict';

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { safeEqual } = require('./_lib/calendar-crypto');
const { calendarEnabledForCustomer } = require('./_lib/calendar-rollout');
const { bookingWindowError } = require('./_lib/booking-window');
const { ensureAccessToken, checkAvailability, createEvent, updateEvent, deleteEvent } = require('./_lib/calendar-providers');
const { SLOT_LIMIT, blockingUpdateFor, bookableSlots, freeSlots } = require('./_lib/calendar-slots');

const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const reply = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

function header(event, name) {
  const headersIn = event.headers || {};
  const key = Object.keys(headersIn).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? String(headersIn[key] || '').trim() : '';
}

function verifyHmac(event, secret) {
  const timestamp = header(event, 'X-Voxera-Timestamp');
  const provided = header(event, 'X-Voxera-Signature').replace(/^sha256=/i, '');
  if (!timestamp || !provided) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(timestamp + '.' + String(event.body || ''), 'utf8').digest('hex');
  return safeEqual(provided, expected);
}

function verifyToolAuth(event) {
  const secret = String(process.env.CALENDAR_TOOL_WEBHOOK_SECRET || '').trim();
  if (!secret) return false;

  const authorization = header(event, 'Authorization');
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
  if (bearer && safeEqual(bearer[1].trim(), secret)) return true;

  // Optional compatibility path for trusted internal callers that can sign the raw body.
  return verifyHmac(event, secret);
}

function iso(value, field) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new Error(field + '_invalid');
  return date.toISOString();
}

function validateWindow(startIso, endIso, settings) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (end <= start) throw new Error('calendar_time_window_invalid');
  if (end - start > 8 * 60 * 60 * 1000) throw new Error('calendar_time_window_too_large');
  const notice = Number(settings.minimum_notice_minutes || 0) * 60000;
  if (start < Date.now() + notice) throw new Error('calendar_minimum_notice_not_met');
  const horizon = Number(settings.booking_horizon_days || 60) * 86400000;
  if (start > Date.now() + horizon) throw new Error('calendar_booking_horizon_exceeded');
}

function bufferedWindow(startIso, endIso, settings) {
  return {
    start: new Date(new Date(startIso).getTime() - Number(settings.buffer_before_minutes || 0) * 60000).toISOString(),
    end: new Date(new Date(endIso).getTime() + Number(settings.buffer_after_minutes || 0) * 60000).toISOString()
  };
}

// Die konfigurierte Termindauer war bis zum 2026-08-10 eine reine Mitteilung an
// das Modell: der Kalenderblock nannte sie, durchgesetzt hat sie niemand.
// `start` und `end` kamen beide vom Modell, die einzige Schranke war das
// 8-Stunden-Fenster. Ein Anrufer, der "zwei Stunden" sagte, bekam zwei Stunden.
// Fuer "verbindlich buchen" ist das zu weit -- ein Modus, der technisch greift
// und fachlich unsinnige Termine erzeugt, ist schlechter als gar keiner.
//
// Geprueft wird nur bei book und reschedule. Bei availability darf das Fenster
// weiterhin groesser sein: "haben Sie am Dienstagnachmittag etwas frei" ist
// eine legitime Frage nach einem Zeitraum, keine Buchung.
function assertDuration(startIso, endIso, settings) {
  const expected = Number(settings?.appointment_duration_minutes || 0);
  if (!expected) return;
  const actual = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  if (actual !== expected) {
    const error = new Error('calendar_duration_mismatch');
    error.details = { expected_minutes: expected, requested_minutes: actual };
    throw error;
  }
}

// Beim Buchen und Verschieben ist "ausserhalb der Zeiten" kein Verhandlungs-
// ergebnis, sondern eine Ablehnung. Anders als bei availability, wo dieselbe
// Lage als "nicht verfuegbar" beantwortet wird.
function assertBookable(startIso, endIso, settings, openingHours, blockingUpdates) {
  const blocked = blockingUpdateFor(blockingUpdates, startIso, endIso);
  if (blocked) {
    const error = new Error('calendar_operational_block');
    error.status = 409;
    error.details = { block_type: blocked.type, block_title: blocked.title, block_until: blocked.ends_at };
    throw error;
  }
  const windowError = bookingWindowError(startIso, endIso, settings, openingHours);
  if (windowError) {
    const error = new Error(windowError);
    error.status = 409;
    throw error;
  }
}

function eventInput(body, settings) {
  const start = iso(body.start, 'start');
  const end = iso(body.end, 'end');
  validateWindow(start, end, settings);
  assertDuration(start, end, settings);
  return {
    title: String(body.title || settings.appointment_title_template || 'Termin via Voxera').slice(0, 160),
    description: String(body.description || '').slice(0, 4000),
    start,
    end,
    timezone: String(settings.timezone || 'Europe/Zurich'),
    attendees: Array.isArray(body.attendees) ? body.attendees.map((value) => String(value || '').trim()).filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)).slice(0, 10) : []
  };
}

// Betriebsinformationen erreichten bis zum 2026-08-10 nur den Prompt, nie
// dieses Werkzeug. Ein Kunde, der "Terminannahme pausieren" einschaltet, bekam
// von der Oberflaeche eine Zusage -- und der Agent buchte weiter. Der
// Google-Freebusy faengt das nicht ab: eine in Voxera gepflegte Schliessung
// steht nicht im verbundenen Kalender.
//
// Nur `closure` und `appointment_pause` sperren. `absence` betrifft eine Person
// und nicht den Betrieb, `special_hours` aendert Zeiten statt sie zu streichen
// -- beide brauchen eine eigene Entscheidung und sperren hier bewusst nicht.
const BLOCKING_UPDATE_TYPES = Object.freeze(['closure', 'appointment_pause']);

// Gefiltert wird nach dem ANGEFRAGTEN Zeitraum, nicht nach "laeuft noch".
//
// Vorher stand hier ein unsortiertes limit(50) auf alle noch nicht abgelaufenen
// Eintraege. Bei mehr als 50 haette die Abfrage genau den ueberlappenden
// auslassen koennen -- und ein uebersehener Block ist eine Buchung waehrend
// einer veroeffentlichten Schliessung, also der Fall, den diese Pruefung
// verhindern soll. Die Ueberlappungsbedingung gehoert deshalb in die Abfrage
// und nicht hinter das Limit.
async function loadBlockingUpdates(sb, customerId, startIso, endIso) {
  if (!startIso || !endIso) return [];
  const { data, error } = await sb.from('customer_operational_updates')
    .select('type,title,starts_at,ends_at')
    .eq('customer_id', customerId)
    .eq('status', 'published')
    .in('type', BLOCKING_UPDATE_TYPES)
    .lt('starts_at', endIso)
    .gt('ends_at', startIso);
  if (error) throw error;
  return data || [];
}

async function audit(sb, input) {
  const { error } = await sb.from('calendar_booking_audit').insert(input);
  if (error) console.warn('[calendar-tool] audit failed', { error: error.message, action: input.action });
}

async function resolveCustomer(sb, body) {
  const agentId = String(body.agent_id || '').trim();
  if (agentId) {
    const { data, error } = await sb.from('customers').select('id,elevenlabs_agent_id').eq('elevenlabs_agent_id', agentId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('calendar_agent_not_mapped');
    return String(data.id);
  }
  if (process.env.CALENDAR_TOOL_ALLOW_CUSTOMER_ID === 'true') {
    const customerId = String(body.customer_id || '').trim();
    if (customerId) return customerId;
  }
  throw new Error('calendar_agent_id_required');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' });
  if (process.env.CALENDAR_INTEGRATION_ENABLED !== 'true') return reply(503, { ok: false, error: 'calendar_integration_disabled' });
  if (!verifyToolAuth(event)) return reply(403, { ok: false, error: 'calendar_tool_auth_invalid' });

  const sbUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !serviceKey) return reply(500, { ok: false, error: 'supabase_configuration_missing' });
  const sb = createClient(sbUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_error) { return reply(400, { ok: false, error: 'invalid_json' }); }

  const action = String(body.action || '').trim().toLowerCase();
  const allowedActions = ['availability', 'book', 'reschedule', 'cancel'];
  if (!allowedActions.includes(action)) return reply(400, { ok: false, error: 'calendar_action_unsupported' });
  const requestId = String(body.request_id || '').trim().slice(0, 200) || null;
  if (['book', 'reschedule', 'cancel'].includes(action) && !requestId) {
    return reply(400, { ok: false, error: 'calendar_request_id_required' });
  }
  let claimedAuditId = null;
  // Ausserhalb des try deklariert, damit der catch-Block sie sehen kann. Der
  // Fehlerpfad schreibt seit #930 Schritt C selbst eine Audit-Zeile -- mit
  // `const` innerhalb des try haette er dabei einen ReferenceError erzeugt und
  // damit die echte Fehlerursache ueberschrieben. Ein Fehlerpfad, der beim
  // Scheitern selbst scheitert, ist schlimmer als gar keiner.
  let customerId = null;
  let settings = null;
  let connection = null;
  // Eigener Marker fuer "diese Aktion hat ihre Audit-Zeile bereits selbst
  // geschrieben". Siehe die Begruendung am availability-Zweig.
  let auditGeschrieben = false;

  try {
    customerId = await resolveCustomer(sb, body);
    if (!calendarEnabledForCustomer(customerId)) {
      return reply(403, { ok: false, error: 'calendar_customer_not_enabled' });
    }
    if (requestId) {
      const { data: previous } = await sb.from('calendar_booking_audit')
        .select('status,details')
        .eq('customer_id', customerId)
        .eq('request_id', requestId)
        .maybeSingle();
      if (previous?.status === 'success' && previous.details?.response) return reply(200, previous.details.response);
      if (previous?.status === 'processing') return reply(409, { ok: false, error: 'calendar_request_in_progress' });
      if (previous?.status === 'failed') return reply(409, { ok: false, error: 'calendar_request_id_already_failed' });
    }
    const { data: settingsRow, error: settingsError } = await sb.from('calendar_settings').select('*').eq('customer_id', customerId).maybeSingle();
    if (settingsError) throw settingsError;
    settings = settingsRow;
    if (!settings?.feature_enabled || !settings.active_provider) return reply(409, { ok: false, error: 'calendar_not_enabled_for_customer' });

    const { data: connectionRow, error: connectionError } = await sb.from('calendar_connections').select('*').eq('customer_id', customerId).eq('provider', settings.active_provider).eq('status', 'connected').maybeSingle();
    if (connectionError) throw connectionError;
    connection = connectionRow;
    if (!connection?.selected_calendar_id) return reply(409, { ok: false, error: 'calendar_connection_not_ready' });

    // Buchungszeiten sind eine Teilmenge der Oeffnungszeiten -- siehe
    // _lib/booking-window.js. Dafuer braucht dieses Werkzeug das
    // Wochenraster aus dem Geschaeftsprofil, das bisher nur der Prompt kannte.
    const { data: customerRow, error: customerError } = await sb.from('customers')
      .select('ai_opening_hours')
      .eq('id', customerId)
      .maybeSingle();
    if (customerError) throw customerError;
    const openingHours = customerRow?.ai_opening_hours || null;

    let externalEventId = String(body.external_event_id || '').trim() || null;
    if (['reschedule', 'cancel'].includes(action)) {
      if (!externalEventId) throw new Error('external_event_id_required');
      const { data: managedEvents, error: managedError } = await sb.from('calendar_booking_audit')
        .select('id')
        .eq('customer_id', customerId)
        .eq('provider', connection.provider)
        .eq('external_event_id', externalEventId)
        .in('action', ['book', 'reschedule'])
        .eq('status', 'success')
        .limit(1);
      if (managedError) throw managedError;
      if (!managedEvents?.length) return reply(403, { ok: false, error: 'calendar_event_not_managed_by_voxera' });
    }

    if (requestId) {
      const { data: claim, error: claimError } = await sb.from('calendar_booking_audit').insert({
        request_id: requestId,
        customer_id: customerId,
        connection_id: connection.id,
        provider: connection.provider,
        action,
        actor_type: 'assistant',
        external_event_id: externalEventId,
        status: 'processing',
        details: { claimed_at: new Date().toISOString() }
      }).select('id').maybeSingle();
      if (claimError?.code === '23505') {
        const { data: existing } = await sb.from('calendar_booking_audit')
          .select('status,details')
          .eq('customer_id', customerId)
          .eq('request_id', requestId)
          .maybeSingle();
        if (existing?.status === 'success' && existing.details?.response) return reply(200, existing.details.response);
        return reply(409, { ok: false, error: existing?.status === 'processing' ? 'calendar_request_in_progress' : 'calendar_request_id_already_used' });
      }
      if (claimError) throw claimError;
      claimedAuditId = claim?.id || null;
    }

    const token = await ensureAccessToken(sb, connection);
    const startIso = body.start ? iso(body.start, 'start') : null;
    const endIso = body.end ? iso(body.end, 'end') : null;
    let responsePayload;

    const blockingUpdates = await loadBlockingUpdates(sb, customerId, startIso, endIso);

    if (action === 'availability') {
      validateWindow(startIso, endIso, settings);
      // Ausserhalb der Buchungszeiten oder waehrend einer Schliessung ist der
      // Zeitraum nicht verfuegbar -- das ist eine Antwort, kein Fehler. Ein
      // Werkzeugfehler zwingt den Agenten in den Fehlerpfad; "nicht verfuegbar,
      // frag nach einer Alternative" steht als Schritt 5 im Kalenderblock und
      // ist genau das gewuenschte Gespraech.
      //
      // Seit dem 2026-08-12 wird der Zeitraum dafuer in einzelne Termine
      // zerlegt (siehe _lib/calendar-slots.js). Vorher war die Antwort binaer
      // fuer den ganzen Block: ein einziger Termin um 09:00 machte den
      // kompletten Vormittag "unverfuegbar" -- und Schritt 4 lenkt vage
      // Terminwuensche systematisch in genau diese Halbtage.
      const plan = bookableSlots(startIso, endIso, settings, openingHours, blockingUpdates);
      let slots = [];
      let busy = [];
      let kalenderGefragt = false;
      if (plan.slots.length) {
        kalenderGefragt = true;
        // Der Kalender wird nur befragt, wenn ueberhaupt ein Termin in Frage
        // kommt. Ist der ganze Zeitraum geschlossen oder gesperrt, steht die
        // Antwort schon fest -- das spart denselben API-Aufruf, den vorher die
        // Kurzschluss-Abfrage auf das ganze Fenster gespart hat.
        const window = bufferedWindow(startIso, endIso, settings);
        const result = await checkAvailability(connection.provider, token.accessToken, connection.selected_calendar_id, window.start, window.end);
        busy = result.busy;
        slots = freeSlots(plan.slots, busy, settings);
      }
      // Warum nichts frei ist, sind drei verschiedene Auskuenfte: der Zeitraum
      // ist kuerzer als ein Termin, er liegt ganz ausserhalb, oder er ist
      // belegt. Ein einzelnes "nicht verfuegbar" wuerde alle drei gleich
      // klingen lassen.
      const reason = slots.length
        ? null
        : (plan.candidates.length ? (plan.slots.length ? 'calendar_no_free_slot' : plan.windowReason) : 'calendar_time_window_shorter_than_appointment');
      // Die alte Bedeutung von `available`, wortgleich zur frueheren Rechnung:
      // die Fensterpruefung auf das GANZE Fenster, keine Betriebssperre, und
      // kein einziger Eintrag im Kalender.
      //
      // Nicht aus der Kandidatenzahl abgeleitet -- das war der zweite
      // Codex-Befund vom 12.08. Die Kandidaten decken das Fenster nur bis zum
      // letzten vollen Termin ab; ein Eintrag im angebrochenen Rest (Anfrage
      // 08:00--12:29, Termin um 12:20) laesst alle Kandidaten frei und haette
      // "ganzer Zeitraum frei" behauptet, wo die alte Antwort "belegt" hiess.
      //
      // `kalenderGefragt` ist Bedingung: ohne Abfrage ist das busy-Array leer,
      // weil nichts geholt wurde, und nicht, weil nichts da ist.
      const wholeWindowFree = kalenderGefragt
        && busy.length === 0
        && !bookingWindowError(startIso, endIso, settings, openingHours)
        && !blockingUpdateFor(blockingUpdates, startIso, endIso);
      responsePayload = {
        ok: true,
        action,
        available: slots.length > 0,
        requested_start: startIso,
        requested_end: endIso,
        // Die alte Bedeutung von `available` -- ist der GANZE angefragte
        // Zeitraum frei -- bleibt als eigenes Feld erhalten. Bei einer Anfrage
        // in Termindauer sind beide Felder gleich; bei einem Halbtag ist genau
        // diese Unterscheidung der Punkt.
        whole_window_free: wholeWindowFree,
        appointment_duration_minutes: plan.duration,
        free_slots: slots.slice(0, SLOT_LIMIT).map((slot) => ({ start: slot.start, end: slot.end })),
        free_slots_total: slots.length,
        busy,
        ...(reason ? { reason } : {})
      };
      // #930 Schritt C: availability hinterlaesst jetzt eine Spur.
      //
      // Vorher schrieb diese Aktion weder bei Erfolg noch bei Fehlschlag eine
      // Zeile: der claim-Pfad greift nur bei book, reschedule und cancel, weil
      // nur die eine request_id fuehren. Als der Agent am 10.08. im Gespraech
      // scheiterte, war der einzige Beleg eine Zeile im Netlify-Funktionslog --
      // in der Datenbank stand nichts, und die Diagnose musste ohne die Antwort
      // auskommen, die das Werkzeug tatsaechlich gegeben hat.
      //
      // Bewusst schlank: kein busy-Array, keine Rohantwort. Die Zeile soll die
      // Frage "wurde geprueft, mit welchem Fenster, mit welchem Ergebnis"
      // beantworten und nicht den Kalender des Kunden spiegeln.
      //
      // `auditGeschrieben` statt `claimedAuditId`: der generische Nachlauf
      // weiter unten benutzte `claimedAuditId` als Signal "es gibt schon eine
      // Zeile". Fuer availability trifft das nie zu -- die Aktion fuehrt keine
      // request_id und erzeugt deshalb keinen Claim. Der Nachlauf schrieb also
      // eine zweite, anders geformte Erfolgszeile zu jedem Aufruf. Ein fremdes
      // Signal fuer die eigene Frage zu benutzen ist der Fehler; hier steht
      // jetzt ein eigener Marker.
      auditGeschrieben = true;
      await audit(sb, {
        customer_id: customerId,
        connection_id: connection.id,
        provider: connection.provider,
        action,
        actor_type: 'assistant',
        status: 'success',
        details: {
          available: responsePayload.available,
          requested_start: startIso,
          requested_end: endIso,
          reason: responsePayload.reason || null,
          busy_count: Array.isArray(responsePayload.busy) ? responsePayload.busy.length : 0,
          // Zahlen, keine Zeitstempel: die Zeile soll belegen, wie die Antwort
          // zustande kam, und nicht den Kalender des Kunden in unsere
          // Audit-Tabelle spiegeln.
          free_slot_count: responsePayload.free_slots_total,
          bookable_slot_count: plan.slots.length,
          candidate_slot_count: plan.candidates.length
        }
      });
    } else if (action === 'book') {
      const input = eventInput(body, settings);
      assertBookable(input.start, input.end, settings, openingHours, blockingUpdates);
      const window = bufferedWindow(input.start, input.end, settings);
      const availability = await checkAvailability(connection.provider, token.accessToken, connection.selected_calendar_id, window.start, window.end);
      if (!availability.available) {
        const conflict = new Error('calendar_slot_unavailable');
        conflict.status = 409;
        conflict.details = { busy: availability.busy };
        throw conflict;
      }
      const eventRecord = await createEvent(connection.provider, token.accessToken, connection.selected_calendar_id, input);
      externalEventId = String(eventRecord.id || '').trim();
      responsePayload = {
        ok: true, action, external_event_id: externalEventId,
        event_url: eventRecord.htmlLink || eventRecord.webLink || null,
        start: input.start, end: input.end, timezone: input.timezone
      };
    } else if (action === 'reschedule') {
      const input = eventInput(body, settings);
      assertBookable(input.start, input.end, settings, openingHours, blockingUpdates);
      const window = bufferedWindow(input.start, input.end, settings);
      const availability = await checkAvailability(connection.provider, token.accessToken, connection.selected_calendar_id, window.start, window.end, externalEventId);
      if (!availability.available) {
        const conflict = new Error('calendar_slot_unavailable');
        conflict.status = 409;
        conflict.details = { busy: availability.busy };
        throw conflict;
      }
      const eventRecord = await updateEvent(connection.provider, token.accessToken, connection.selected_calendar_id, externalEventId, input);
      responsePayload = {
        ok: true, action, external_event_id: externalEventId,
        event_url: eventRecord.htmlLink || eventRecord.webLink || null,
        start: input.start, end: input.end, timezone: input.timezone
      };
    } else {
      await deleteEvent(connection.provider, token.accessToken, connection.selected_calendar_id, externalEventId);
      responsePayload = { ok: true, action, external_event_id: externalEventId, cancelled: true };
    }

    if (claimedAuditId) {
      const { error } = await sb.from('calendar_booking_audit').update({
        external_event_id: externalEventId,
        status: 'success',
        details: { response: responsePayload, completed_at: new Date().toISOString() }
      }).eq('id', claimedAuditId);
      if (error) throw error;
    } else if (!auditGeschrieben) {
      await audit(sb, {
        request_id: null,
        customer_id: customerId,
        connection_id: connection.id,
        provider: connection.provider,
        action,
        actor_type: 'assistant',
        external_event_id: externalEventId,
        status: 'success',
        details: { response: responsePayload }
      });
    }
    return reply(200, responsePayload);
  } catch (error) {
    if (claimedAuditId) {
      await sb.from('calendar_booking_audit').update({
        status: 'failed',
        details: {
          error: error?.message || 'calendar_tool_failed',
          ...(error?.details || {}),
          failed_at: new Date().toISOString()
        }
      }).eq('id', claimedAuditId);
    }
    // Ohne request_id gibt es keinen claim -- und damit bis #930 Schritt C auch
    // keine Zeile im Fehlerfall. Genau die fehlte bei der Diagnose am 10.08.
    // `audit()` schluckt eigene Fehler bewusst (console.warn), der Aufrufer
    // bekommt also weiterhin seine urspruengliche Fehlerantwort.
    //
    // Kein geratener Anbieter. `provider` fiel hier auf den Vorgabewert google
    // zurueck, was bei einem Microsoft-Kunden einen falschen Diagnosesatz
    // erzeugt haette -- in genau dem Pfad, der Beweise sichern soll.
    //
    // 'unknown' zu schreiben oder das Feld wegzulassen geht nicht: die Spalte
    // ist NOT NULL und traegt CHECK (provider IN ('google','microsoft')). Beides
    // liesse den INSERT scheitern, und `audit()` schluckt eigene Fehler -- die
    // Zeile fiele still ganz weg. Statt einer erfundenen oder einer
    // verschwundenen Zeile: kein Audit, aber eine laute Logzeile, die den
    // Grund benennt. Damit die Zeile hier stehen KANN, braucht es eine
    // Migration (CHECK um 'unknown' erweitern oder Spalte nullable) -- siehe
    // Meldung an Umut vom 12.08.
    const providerBekannt = connection?.provider || settings?.active_provider || null;
    if (!claimedAuditId && customerId && !providerBekannt) {
      console.error('[calendar-tool] audit_uebersprungen_anbieter_unbekannt', {
        customer_id: customerId,
        action,
        error: error?.message || String(error)
      });
    }
    if (!claimedAuditId && customerId && providerBekannt) {
      await audit(sb, {
        customer_id: customerId,
        connection_id: connection?.id || null,
        provider: providerBekannt,
        action,
        actor_type: 'assistant',
        status: 'failed',
        details: {
          error: error?.message || 'calendar_tool_failed',
          requested_start: body?.start || null,
          requested_end: body?.end || null,
          failed_at: new Date().toISOString()
        }
      });
    }
    console.error('[calendar-tool] failed', { action, request_id: requestId, error: error?.message || String(error) });
    return reply(error.status >= 400 && error.status < 600 ? error.status : 400, {
      ok: false,
      error: error?.message || 'calendar_tool_failed',
      ...(error?.details || {})
    });
  }
};

exports._test = { verifyToolAuth, verifyHmac, validateWindow, bufferedWindow };
