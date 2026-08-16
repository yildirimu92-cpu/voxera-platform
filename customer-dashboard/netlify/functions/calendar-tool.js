'use strict';

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { safeEqual } = require('./_lib/calendar-crypto');
const { calendarEnabledForCustomer } = require('./_lib/calendar-rollout');
const { bookingWindowError, bookingTimingError, bufferedWindow, windowSpanError } = require('./_lib/booking-window');
const { ensureAccessToken, checkAvailability, createEvent, updateEvent, deleteEvent } = require('./_lib/calendar-providers');
const { SLOT_LIMIT, blockingUpdateFor, bookableSlots, freeSlots } = require('./_lib/calendar-slots');
const { bookingReference, identityFromBody, matchAppointments, ownershipConflict } = require('./_lib/caller-identity');

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

// Nur noch Reihenfolge und Groesse -- also das, was fuer einen ZEITRAUM als
// Ganzes gilt und was bei availability wie bei book dieselbe Antwort verlangt.
//
// Vorlauf und Buchungshorizont sind seit dem 2026-08-12 in
// bookingTimingError() und werden bei availability pro Termin gefragt. Sie
// hier zu lassen hiesse, einen Halbtag am Vorlauf scheitern zu lassen, dessen
// spaetere Termine buchbar sind -- dieselbe Unteilbarkeit, die dieser PR beim
// Kalender behebt.
//
// Die Spanne selbst rechnet booking-window.js -- dort ist sie ohne
// Abhaengigkeiten pruefbar. Gemessen wird der ANGEFRAGTE Zeitraum: die Schranke
// bewacht die Zusage an das Modell ("hoechstens 8 Stunden"), nicht die Abfrage
// beim Anbieter. Begruendung steht an windowSpanError().
function validateWindow(startIso, endIso) {
  const spanError = windowSpanError(startIso, endIso);
  if (spanError) throw new Error(spanError);
}

// Fuer book und reschedule bleibt es eine Ablehnung: dort IST das Fenster der
// Termin, und "zu kurzfristig" ist keine Auskunft, sondern ein Nein.
function assertTiming(startIso, settings) {
  const error = bookingTimingError(startIso, settings);
  if (error) throw new Error(error);
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
  assertTiming(start, settings);
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

// Anstehende Voxera-Termine eines Kunden -- aus unserer eigenen Audit-Tabelle,
// nicht aus dem Kalender.
//
// Anlass: Testanruf vom 13.08. Ein Kunde, der absagen will, kennt die Uhrzeit
// seines Termins selten. "Ich weiss es wirklich nicht mehr" fuehrte in eine
// Sackgasse: der Agent hat keine Moeglichkeit, die `external_event_id` eines
// Termins aus einem FRUEHEREN Gespraech zu finden -- die ID existiert nur im
// Kontext des Buchungsgespraechs. Absagen in einem neuen Anruf war damit
// prinzipiell unmoeglich, nicht bloss fehlerhaft.
//
// Die Quelle ist bewusst calendar_booking_audit und nicht der Kalender: dort
// steht bereits, welche Termine Voxera fuer diesen Kunden gebucht hat, und
// genau darauf beruht schon die Pruefung calendar_event_not_managed_by_voxera.
// Kein zusaetzlicher Kalender-Scope, keine Zeitfenster-Raterei, keine
// 8-Stunden-Grenze.
//
// Gelesen wird chronologisch, damit die Historie sich selbst aufloest: ein
// reschedule ueberschreibt die Zeiten seiner Buchung, ein cancel nimmt den
// Termin wieder heraus.
// Die Antwort war bis zum 14.08. auf fuenf Termine beschnitten, mit der
// Gesamtzahl daneben. Codex-Befund (P2): damit war ein sechster Termin
// PRINZIPIELL unerreichbar -- das Werkzeug kennt weder Blaettern noch Filter
// noch eine Folgeaktion, seine `external_event_id` kam also nie heraus, und er
// liess sich weder verschieben noch absagen. Dieselbe Bauform wie der
// urspruengliche Befund dieses PR: eine Grenze, die eine Aktion nicht bremst,
// sondern unmoeglich macht.
//
// Die Liste ist ausserdem seit der Anrufer-Bindung auf die anrufende Person
// gefiltert -- es sind ihre eigenen Termine, nicht die des Betriebs. Es gibt
// also keinen Grund, ihr davon etwas vorzuenthalten.
//
// Zweiter Codex-Befund (P2) zur angehobenen Grenze: 50 statt 5 macht den Fall
// seltener, nicht erreichbar. Richtig -- und trotzdem wird hier NICHT
// geblaettert. Ein Sprachagent, der eine Seite zwei anfordert, liest im besten
// Fall fuenfzig Termine vor; das ist kein Gespraech mehr. Was stattdessen
// bleibt, ist die Regel, die dieser PR ueberall sonst anwendet: KEINE STILLE
// KUERZUNG. Wird die Grenze erreicht, sagt die Antwort es (`truncated`,
// `calendar_too_many_appointments`), und der Agent nimmt eine Rueckrufanfrage
// auf, statt aus einem Ausschnitt zu waehlen. Ein Mensch loest den Fall besser
// als ein Blaetterprotokoll.
const LOOKUP_LIMIT = 50;

// Geblaettert, und bei Erreichen der Grenze ABGEBROCHEN statt gekuerzt.
//
// Codex-Befund vom 14.08. (P1): die Abfrage stand ohne Bereichsangabe da.
// PostgREST liefert hoechstens `db-max-rows` Zeilen (bei Supabase ueblicherweise
// 1000) und sagt es nicht dazu. Sortiert wird aeltestzuerst -- weggefallen waere
// also ausgerechnet das NEUESTE Stueck Historie. Die Folgen sind genau die, die
// dieser PR sonst verhindert: eine Absage, die nicht mitgelesen wird, laesst den
// Termin wieder auferstehen; eine Verschiebung, die fehlt, meldet die alte Zeit;
// und die Nummernvergabe wie die Mehrdeutigkeitspruefung rechnen mit einem
// Ausschnitt.
//
// Derselbe Befund und dieselbe Antwort wie bei der Belegungsliste der Anbieter
// (MAX_BUSY_PAGES in _lib/calendar-providers.js): eine unvollstaendige Historie
// ist nicht die halbe Wahrheit, sondern eine falsche. Wird die Grenze erreicht,
// wirft die Funktion -- der Agent geht in die Rueckrufaufnahme, statt auf
// lueckenhaften Daten zu arbeiten.
const HISTORY_PAGE_SIZE = 500;
const MAX_HISTORY_PAGES = 40;

// Geblaettert wird ueber den Schluessel, nicht ueber einen Versatz.
//
// Zwei Codex-Befunde haben dieselbe Stelle nacheinander getroffen. Der erste:
// ohne eindeutigen Sortierschluessel ist die Reihenfolge bei gleichem
// `created_at` undefiniert, und an einer Seitengrenze erscheint eine Zeile
// zweimal und eine andere nie. Der zweite: auch mit eindeutigem Schluessel
// teilen sich die Seitenabfragen KEINE Momentaufnahme -- wechselt zwischen
// zwei Seiten ein nebenlaeufiger Anspruch von `processing` auf `success`,
// schiebt sich seine aeltere Zeile in den bereits gelesenen Bereich, und der
// naechste Versatz ueberspringt eine Zeile. Verschwinden koennte dabei wieder
// ausgerechnet eine Absage.
//
// Beides faellt weg, wenn nicht nach Versatz, sondern nach dem zuletzt
// gesehenen Schluessel geblaettert wird: `id` ist ein UUID-Primaerschluessel,
// also eindeutig und vollstaendig sortierbar. Eine BESTEHENDE Zeile kann damit
// weder uebersprungen noch doppelt gelesen werden, egal was nebenher passiert.
// Eine waehrend des Lesens fertig werdende Zeile kann fehlen -- das ist
// dasselbe wie eine Momentaufnahme kurz davor und die einzige Lesart, die
// ueberhaupt konsistent ist.
//
// Die Lesereihenfolge muss dafuer nicht chronologisch sein: aufgeloest wird seit
// dem 14.08. je Termin ueber mutationTime(), nicht ueber die Abfragefolge.
async function loadAppointmentHistory(sb, customerId) {
  const alle = [];
  let cursor = null;
  for (let seite = 0; seite < MAX_HISTORY_PAGES; seite += 1) {
    let abfrage = sb.from('calendar_booking_audit')
      // `request_id` steht seit dem 14.08. mit dabei -- siehe die
      // Absagesperre im Handler.
      .select('id,request_id,external_event_id,action,details,connection_id,created_at')
      .eq('customer_id', customerId)
      .eq('status', 'success')
      .in('action', ['book', 'reschedule', 'cancel'])
      .order('id', { ascending: true })
      .limit(HISTORY_PAGE_SIZE);
    if (cursor) abfrage = abfrage.gt('id', cursor);
    const { data, error } = await abfrage;
    if (error) throw error;
    const zeilen = data || [];
    alle.push(...zeilen);
    if (zeilen.length < HISTORY_PAGE_SIZE) return alle;
    cursor = zeilen[zeilen.length - 1].id;
  }

  // Genau volle letzte Seite heisst nicht "es kommt noch was".
  //
  // Codex-Befund vom 14.08. (P2): bei exakt 20 000 Zeilen ist die vierzigste
  // Seite legitim voll, die Schleife laeuft aus -- und der Abbruch traf eine
  // VOLLSTAENDIG gelesene Historie. Weil loadAppointmentHistory() unter allen
  // vier Aktionen liegt, haette dieser eine Randwert Nachschlagen, Buchen,
  // Absagen und Verschieben zugleich lahmgelegt. Ein Fehler in der Sicherung,
  // die zehn Minuten vorher gegen einen anderen Fehler gebaut wurde.
  //
  // Eine einzelne Zeile hinter der Grenze entscheidet es.
  const { data: rest, error } = await sb.from('calendar_booking_audit')
    .select('id')
    .eq('customer_id', customerId)
    .eq('status', 'success')
    .in('action', ['book', 'reschedule', 'cancel'])
    .gt('id', cursor)
    .order('id', { ascending: true })
    .limit(1);
  if (error) throw error;
  if (!(rest || []).length) return alle;

  const truncated = new Error('calendar_history_truncated');
  truncated.status = 503;
  throw truncated;
}

// Loest die Historie zum aktuellen Stand auf: ein reschedule ueberschreibt die
// Zeiten seiner Buchung, ein cancel nimmt den Termin wieder heraus.
//
// `connection` filtert auf die heute aktive Verbindung und den heute gewaehlten
// Kalender. `null` schaltet den Filter ab -- gebraucht fuer die
// Eigentuemer-Pruefung, die auch dann greifen soll, wenn ein Termin ueber diesen
// Filter herausfaellt.
// Nach ABSCHLUSS geordnet, nicht nach Anlage.
//
// Codex-Befund vom 14.08. (P2): `created_at` ist der Zeitpunkt des
// processing-Claims, nicht der der erfolgreichen Aenderung am Kalender.
// Ueberlappen sich zwei Verschiebungen desselben Termins, kann die zuerst
// beanspruchte zuletzt fertig werden -- dann ist SIE der Kalenderstand, waehrend
// diese Wiedergabe die andere zuletzt anwendet und eine veraltete Zeit meldet.
// `details.completed_at` steht in jeder Erfolgszeile aus dem Claim-Pfad; nur
// Altzeilen ohne ihn fallen auf `created_at` zurueck.
// Wann diese Aenderung beim ANBIETER wirksam wurde.
//
// `completed_at` ist der Zeitpunkt, zu dem unsere Antwort zurueckkam -- nicht
// der, zu dem der Anbieter geaendert hat. Codex-Befund vom 14.08. (P2): bei
// zwei ueberlappenden Verschiebungen kann der Anbieter A vor B anwenden,
// waehrend die Antwort auf B zuerst eintrifft. Dann waere B der Kalenderstand,
// die Wiedergabe nach Antwortankunft meldete aber A.
//
// Google liefert `updated`, Microsoft `lastModifiedDateTime` -- beides die
// Aenderungszeit des Anbieters selbst. Sie wird seit dem 14.08. mitgeschrieben
// und ist der erste Schluessel.
//
// Restrisiko, offen benannt: Altzeilen und Absagen haben sie nicht und fallen
// auf unsere Zeiten zurueck. Deshalb wird nur noch INNERHALB eines Termins
// sortiert (die Reihenfolge zwischen verschiedenen Terminen ist fuer das
// Ergebnis ohne Bedeutung) und eine Absage gilt als endgueltig -- damit kann
// keine Uhrenabweichung einen abgesagten Termin wieder auferstehen lassen.
// Eine echte Serialisierung je Termin waere die strengere Loesung; sie braucht
// eine Sperre und ist eine eigene Aenderung.
function mutationTime(zeile) {
  const wert = zeile?.details?.provider_updated_at
    || zeile?.details?.completed_at
    || zeile?.created_at;
  return new Date(wert || 0).getTime() || 0;
}

function cancelledEventIds(rows) {
  return new Set(
    (rows || [])
      .filter((zeile) => zeile?.action === 'cancel')
      .map((zeile) => String(zeile.external_event_id || '').trim())
      .filter(Boolean)
  );
}

function resolveAppointments(rows, connection) {
  const alle = rows || [];

  // Absagen sind endgueltig, und zwar unabhaengig von jeder Sortierung. Das
  // nimmt der Reihenfolge die einzige Richtung, in der ein Fehler wirklich
  // gefaehrlich waere: einen abgesagten Termin wieder anzubieten.
  //
  // Gilt unabhaengig davon, ueber welche Verbindung die Absage lief.
  //
  // Die Annahme dahinter -- "nach einer Absage taucht dieselbe Termin-ID nicht
  // wieder auf" -- war bis zum 14.08. eine ANNAHME. Codex-Befund (P2): stellt
  // jemand einen geloeschten Kalendereintrag wieder her und laesst ihn dann
  // ueber Voxera verschieben, kommt die Pruefung auf "von Voxera verwaltet"
  // durch, eine neue Erfolgszeile entsteht -- und diese Menge hier blendet den
  // Termin trotzdem fuer immer aus. Ein Termin, den es gibt und den niemand
  // findet.
  //
  // Durchgesetzt wird sie jetzt am Eingang: cancelledEventIds() sperrt
  // Verschieben und Absagen auf einer bereits abgesagten ID. Damit entsteht die
  // unerreichbare Zeile gar nicht erst, statt hier nachtraeglich verdeckt zu
  // werden.
  const abgesagt = cancelledEventIds(alle);

  const proTermin = new Map();
  for (const zeile of alle) {
    if (zeile.action === 'cancel') continue;
    const id = String(zeile.external_event_id || '').trim();
    if (!id || abgesagt.has(id)) continue;

    // Angeboten wird nur, was ueber die HEUTE aktive Verbindung und den heute
    // gewaehlten Kalender auch absagbar ist.
    //
    // Codex-Befund vom 13.08. (P1): die Historie ist kundenweit. Wechselt ein
    // Kunde den Anbieter oder den Kalender, stehen alte Buchungen weiter drin.
    // Beim Absagen laufen sie dann in zwei verschiedene Fallen -- beim
    // Anbieterwechsel in calendar_event_not_managed_by_voxera, beim
    // Kalenderwechsel in ein DELETE auf den falschen Kalender.
    if (connection) {
      if (zeile.connection_id && connection.id && zeile.connection_id !== connection.id) continue;
      // `calendar_id` MUSS dastehen und passen.
      //
      // Vorher war die Bedingung `kalender && kalender !== ...` -- eine Zeile
      // ohne Kalender-ID kam also durch, mit dem Argument, die
      // Verbindungspruefung fange sie ab. Codex-Befund vom 14.08. (P2): sie tut
      // es nicht. `select_calendar` in calendar-connections.js setzt
      // `selected_calendar_id` auf der BESTEHENDEN Verbindungszeile um -- die
      // `connection_id` bleibt dieselbe. Nach einem Kalenderwechsel an Ort und
      // Stelle stehen Altbuchungen des alten Kalenders also weiter in der Liste,
      // und ihre Absage kann nur im 409-Rueckfall enden.
      //
      // Wo nichts steht, wissen wir es nicht -- und "wir wissen es nicht" darf
      // nicht als "gehoert zum aktuellen Kalender" durchgehen.
      const kalender = zeile.details?.calendar_id;
      if (!kalender || (connection.selected_calendar_id && kalender !== connection.selected_calendar_id)) continue;
    }

    if (!proTermin.has(id)) proTermin.set(id, []);
    proTermin.get(id).push(zeile);
  }

  const offen = new Map();
  for (const [id, zeilen] of proTermin) {
    // Die juengste Zeile, die ueberhaupt Zeiten traegt. Eine spaetere ohne
    // Zeiten darf die frueheren nicht entwerten -- das tat die Vorgaengerfassung
    // mit ihrem `continue` beilaeufig richtig, und das soll so bleiben.
    const massgeblich = [...zeilen]
      .sort((a, b) => mutationTime(a) - mutationTime(b))
      .reverse()
      .find((zeile) => zeile.details?.response?.start && zeile.details?.response?.end);
    if (!massgeblich) continue;

    const antwort = massgeblich.details.response;
    offen.set(id, {
      external_event_id: id,
      start: antwort.start,
      end: antwort.end,
      // Seit dem 14.08.: an WEN der Termin gebunden ist. Aeltere Zeilen tragen
      // beides nicht -- siehe die Erlaeuterung in _lib/caller-identity.js, wo
      // sich Nachschlagen (streng) und Absagen (nachsichtig) unterscheiden.
      caller_reference: String(massgeblich.details?.caller_reference || '') || null,
      booking_reference: String(massgeblich.details?.booking_reference || '') || null
    });
  }
  return offen;
}

// Nur anstehende. Ein Bestandskunde haette sonst eine Liste, die mit jedem
// vergangenen Termin unbrauchbarer wird.
function upcomingAppointments(offen, now = Date.now()) {
  return [...offen.values()]
    .filter((termin) => {
      const beginn = new Date(termin.start).getTime();
      return Number.isFinite(beginn) && beginn > now;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

// Jede Terminnummer, die dieser Betrieb JE ausgegeben hat.
//
// Zuerst waren es nur die anstehenden Termine, mit dem Argument, nur die koenne
// das Nachschlagen zurueckgeben. Codex-Befund vom 14.08. (P2): das uebersieht,
// dass die anrufende Person ihre Nummer behaelt. Faellt ein Termin in die
// Vergangenheit und wird dieselbe Nummer spaeter neu vergeben, oeffnet der alte
// Zettel den Termin einer fremden Person -- `matchesCaller()` nimmt die Nummer
// unabhaengig von der Anrufernummer an.
//
// Gelesen wird deshalb aus den ROHZEILEN, nicht aus dem aufgeloesten Bestand:
// abgesagte und vergangene Termine sind aus dem Bestand verschwunden, ihre
// Nummern sind aber weiterhin im Umlauf.
//
// Der Vorrat sind 10^6 Nummern. Bei tausend je ausgegebenen liegt die
// Kollisionswahrscheinlichkeit der naechsten Ziehung bei einem Promille, und die
// Ziehung wiederholt sich; erst im hohen fuenfstelligen Bereich wuerde die
// Stellenzahl knapp.
function issuedReferences(rows) {
  const belege = new Set();
  for (const zeile of rows || []) {
    const beleg = String(zeile?.details?.booking_reference || '');
    if (beleg) belege.add(beleg);
  }
  return belege;
}

// Terminnummern, die JE an mehr als einen Termin gegangen sind.
//
// Codex-Befund vom 14.08. (P2): die Mehrdeutigkeit wurde nur im Bestand der
// anstehenden Termine gesucht. Faellt einer der beiden kollidierenden Termine
// weg -- abgesagt oder vergangen --, sieht der andere wieder eindeutig aus, und
// der Zettel der ersten Person oeffnet ihn erneut. Eine Doppelvergabe
// verjaehrt aber nicht: beide Zettel bleiben im Umlauf, also bleibt die Nummer
// dauerhaft unbrauchbar.
function ambiguousReferences(rows) {
  const proBeleg = new Map();
  for (const zeile of rows || []) {
    const beleg = String(zeile?.details?.booking_reference || '');
    const id = String(zeile?.external_event_id || '').trim();
    if (!beleg || !id) continue;
    if (!proBeleg.has(beleg)) proBeleg.set(beleg, new Set());
    proBeleg.get(beleg).add(id);
  }
  const mehrdeutig = new Set();
  for (const [beleg, ids] of proBeleg) if (ids.size > 1) mehrdeutig.add(beleg);
  return mehrdeutig;
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
  const allowedActions = ['availability', 'book', 'reschedule', 'cancel', 'lookup'];
  if (!allowedActions.includes(action)) return reply(400, { ok: false, error: 'calendar_action_unsupported' });
  const requestId = String(body.request_id || '').trim().slice(0, 200) || null;
  // `lookup` steht hier bewusst nicht: es ist ein Lesezugriff ohne
  // Seiteneffekt, eine Wiederholung schadet nicht.
  if (['book', 'reschedule', 'cancel'].includes(action) && !requestId) {
    return reply(400, { ok: false, error: 'calendar_request_id_required' });
  }
  // Wer ruft an? Siehe _lib/caller-identity.js -- ausdruecklich eine Zuordnung
  // und KEINE Authentifizierung. Beide Felder sind optional: `caller_id` liefert
  // ElevenLabs nur bei Telefongespraechen, die Terminnummer nennt nur, wer eine
  // hat. Faellt beides weg, findet das Nachschlagen nichts, und der Agent geht
  // in die Rueckrufaufnahme.
  const identitaet = identityFromBody(body);
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
    // Geworfen statt `return reply(...)`, damit auch dieser Ausgang eine Spur
    // hinterlaesst -- derselbe Codex-Befund wie bei den Einrichtungsfehlern,
    // nur eine Stufe frueher.
    //
    // Eine Audit-ZEILE entsteht hier nicht: der Anbieter ist noch unbekannt,
    // und die Spalte laesst keinen Ersatzwert zu (siehe N4). Der catch schreibt
    // stattdessen die laute Logzeile mit Kunde, Aktion und Grund. Das ist der
    // Fall "Werkzeug haengt am Agenten, Kunde aber nicht freigeschaltet" -- er
    // faellt sonst voellig lautlos aus.
    if (!calendarEnabledForCustomer(customerId)) {
      const error = new Error('calendar_customer_not_enabled');
      error.status = 403;
      throw error;
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
    // Die Oeffnungszeiten haengen von nichts ab und werden deshalb SOFORT
    // mitgestartet, statt hinter den beiden Kalenderabfragen zu warten.
    //
    // Aus dem Testanruf vom 14.08.: die sechs Supabase-Abfragen dieses
    // Handlers laufen je ~105 ms und strikt nacheinander -- zusammen 912 ms
    // fuer ein Nachschlagen. Gemessen an den 15 Sekunden, die der Anruf
    // gebraucht hat, ist das nicht die Ursache; es ist aber die einzige
    // Stelle, an der wir ueberhaupt etwas kuerzen koennen.
    //
    // Nur diese eine laesst sich vorziehen: `calendar_connections` braucht
    // `settings.active_provider` und kann nicht frueher laufen. Der Gewinn ist
    // also eine Abfrage, rund 105 ms -- nicht drei.
    //
    // Der Fehlerwandler ist kein Schmuck: wird weiter unten geworfen, bevor
    // dieses Versprechen gelesen wird, gaebe eine Ablehnung eine unbehandelte
    // Zurueckweisung. So wird daraus ein Wert, den erst der Lesepunkt
    // auswertet -- die Reihenfolge der Fehlermeldungen bleibt damit exakt die
    // alte.
    const oeffnungszeitenVersprechen = sb.from('customers')
      .select('ai_opening_hours')
      .eq('id', customerId)
      .maybeSingle()
      .then((ergebnis) => ergebnis, (error) => ({ data: null, error }));

    const { data: settingsRow, error: settingsError } = await sb.from('calendar_settings').select('*').eq('customer_id', customerId).maybeSingle();
    if (settingsError) throw settingsError;
    settings = settingsRow;
    // Geworfen statt `return reply(...)`, seit dem 2026-08-12.
    //
    // Codex-Befund: diese beiden Ausgaenge verliessen den Handler, ohne den
    // catch zu beruehren -- und schrieben deshalb keine Audit-Zeile. Es sind
    // aber gerade die Einrichtungsfehler, bei denen die Spur gebraucht wird:
    // "der Agent hat es versucht, die Verbindung war nicht bereit" ist die
    // Auskunft, die bei der Diagnose am 10.08. gefehlt hat.
    //
    // Antwortform und Statuscode bleiben gleich: der catch antwortet mit
    // `error.status` und `{ ok: false, error: <message> }`.
    if (!settings?.feature_enabled || !settings.active_provider) {
      const error = new Error('calendar_not_enabled_for_customer');
      error.status = 409;
      throw error;
    }

    const { data: connectionRow, error: connectionError } = await sb.from('calendar_connections').select('*').eq('customer_id', customerId).eq('provider', settings.active_provider).eq('status', 'connected').maybeSingle();
    if (connectionError) throw connectionError;
    connection = connectionRow;
    // Siehe oben: geworfen, damit der Fehlerpfad eine Zeile schreibt. Hier ist
    // der Anbieter aus `settings.active_provider` immer bekannt, die Zeile
    // entsteht also verlaesslich.
    if (!connection?.selected_calendar_id) {
      const error = new Error('calendar_connection_not_ready');
      error.status = 409;
      throw error;
    }

    // Buchungszeiten sind eine Teilmenge der Oeffnungszeiten -- siehe
    // _lib/booking-window.js. Dafuer braucht dieses Werkzeug das
    // Wochenraster aus dem Geschaeftsprofil, das bisher nur der Prompt kannte.
    const { data: customerRow, error: customerError } = await oeffnungszeitenVersprechen;
    if (customerError) throw customerError;
    const openingHours = customerRow?.ai_opening_hours || null;

    let externalEventId = String(body.external_event_id || '').trim() || null;
    let bestehenderTermin = null;
    // Schon vergebene Terminnummern -- gebraucht ueberall dort, wo eine neue
    // gezogen wird. Bei reschedule und cancel faellt der Bestand als Nebenprodukt
    // der Eigentuemer-Pruefung an; book holt ihn eigens.
    let vergebeneBelege = new Set();
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

      // Gehoert der Termin zu diesem Anruf?
      //
      // Ohne Verbindungsfilter aufgeloest: die Frage ist "wer hat gebucht" und
      // nicht "ist es heute noch absagbar" -- letzteres beantwortet bereits die
      // Pruefung oben. Ein Termin, den der Verbindungsfilter herauswirft,
      // verloere sonst still seinen Eigentuemer.
      const verlauf = await loadAppointmentHistory(sb, customerId);
      // Eine abgesagte Termin-ID nimmt keine weitere Aenderung mehr an.
      //
      // Codex-Befund vom 14.08. (P2): ohne diese Schranke konnte eine Buchung,
      // deren Kalendereintrag jemand von Hand wiederhergestellt hat, ueber
      // Voxera verschoben werden -- die Erfolgszeile entstand, und die
      // Aufloesung blendete den Termin danach fuer immer aus. Ein Termin, den es
      // gibt und den niemand findet, ist schlimmer als eine Ablehnung: die
      // Ablehnung fuehrt in Schritt 19 und damit zu einem Menschen.
      // Die EIGENE Absage sperrt nicht.
      //
      // Codex-Befund vom 14.08. (P1): eine Wiederholung derselben Anfrage --
      // Absage beim Anbieter erfolgt, Antwort unterwegs verloren -- duerfe hier
      // nicht in die Sperre laufen, sondern muesse die gespeicherte
      // Erfolgsantwort bekommen.
      //
      // Nachgemessen: die Wiederholungspruefung weiter oben faengt das bereits
      // ab, und ein eigener Fall belegt es seit `ed1dc97`. Der Befund liess sich
      // an dieser Fassung nicht nachstellen.
      //
      // Trotzdem geaendert, denn "faengt eine andere Stelle ab" ist eine
      // schwaechere Zusage als "kann hier gar nicht passieren": die obere
      // Pruefung liest die Zeile ueber die request_id, und ein Lesevorgang kann
      // veraltet sein. Die Sperre gilt deshalb nur noch fuer Absagen aus einer
      // ANDEREN Anfrage. Fuer die eigene faellt sie durch und landet unten im
      // Anspruchskonflikt, der wiederum die Erfolgsantwort ausliefert.
      const fremdeAbsage = verlauf.some((zeile) => zeile.action === 'cancel'
        && String(zeile.external_event_id || '').trim() === externalEventId
        && String(zeile.request_id || '') !== String(requestId || ''));
      if (fremdeAbsage) {
        const error = new Error('calendar_event_already_cancelled');
        error.status = 409;
        throw error;
      }
      const offeneTermine = resolveAppointments(verlauf, null);
      bestehenderTermin = offeneTermine.get(externalEventId) || null;
      vergebeneBelege = issuedReferences(verlauf);
      // Eine mehrdeutige Terminnummer darf auch hier nichts erlauben -- sonst
      // waere die Entschaerfung beim Nachschlagen an der Absage vorbei
      // umgangen. Siehe matchAppointments() in _lib/caller-identity.js.
      const { belegMehrdeutig } = matchAppointments(
        upcomingAppointments(offeneTermine), identitaet,
        { mehrdeutigeBelege: ambiguousReferences(verlauf) }
      );
      const konflikt = ownershipConflict(
        bestehenderTermin,
        belegMehrdeutig ? { ...identitaet, bookingReference: '' } : identitaet
      );
      if (konflikt) {
        const error = new Error(konflikt);
        error.status = 403;
        throw error;
      }
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

    // Der Zugriffsschluessel wird erst geholt, wenn der Anbieter wirklich
    // gefragt wird.
    //
    // Codex-Befund vom 14.08. (P2): er wurde vor der Verzweigung geholt -- also
    // auch fuer `lookup`, das ausschliesslich unsere eigene Audit-Tabelle liest.
    // Ist der Aktualisierungsschluessel abgelaufen oder zurueckgezogen, wirft
    // ensureAccessToken() und markiert die Verbindung unter Umstaenden als
    // reauthorization_required -- und das Nachschlagen scheitert, obwohl seine
    // Quelle vollstaendig gesund ist. Genau dann ist es aber am wichtigsten:
    // "ich finde Ihren Termin nicht" waehrend eines Anbieterausfalls.
    //
    // Nebenwirkung mit demselben Vorzeichen: ein geschlossener Tag beantwortet
    // availability jetzt ohne jeden Anbieterkontakt.
    let tokenZwischenspeicher = null;
    const holeToken = async () => {
      if (!tokenZwischenspeicher) tokenZwischenspeicher = await ensureAccessToken(sb, connection);
      return tokenZwischenspeicher;
    };
    const startIso = body.start ? iso(body.start, 'start') : null;
    const endIso = body.end ? iso(body.end, 'end') : null;
    let responsePayload;
    // Was ausser der Antwort in die Audit-Zeile gehoert. Fuer book und
    // reschedule ist das die Bindung des Termins an die anrufende Person --
    // ohne sie in der Zeile findet das Nachschlagen ihn spaeter nicht wieder.
    let auditZusatz = {};

    const blockingUpdates = await loadBlockingUpdates(sb, customerId, startIso, endIso);

    if (action === 'lookup') {
      // Kein Kalenderaufruf: die Antwort kommt aus unserer eigenen Tabelle.
      const verlaufNachschlagen = await loadAppointmentHistory(sb, customerId);
      const anstehende = upcomingAppointments(resolveAppointments(verlaufNachschlagen, connection));
      // Gefiltert auf die anrufende Person.
      //
      // Bis zum 14.08. stand hier `anstehende` ungefiltert -- und das hiess: wer
      // bei einem Betrieb anruft, bekommt die anstehenden Termine ALLER Kunden
      // dieses Betriebs vorgelesen, mit ihren Termin-IDs, und kann sie damit
      // absagen. Das war kein Randfall, sondern der Normalfall jedes zweiten
      // Anrufs.
      //
      // Die Bindung ist die Anrufernummer, ersatzweise die Terminnummer. Sie ist
      // eine Zuordnung und kein Nachweis -- die Begruendung und ihre Grenzen
      // stehen in _lib/caller-identity.js.
      const { treffer: termine, belegMehrdeutig } = matchAppointments(
        anstehende, identitaet,
        { mehrdeutigeBelege: ambiguousReferences(verlaufNachschlagen) }
      );
      const modus = identitaet.callerReference
        ? 'caller_id'
        : (identitaet.bookingReference ? 'booking_reference' : 'none');
      // Drei verschiedene Auskuenfte, nicht eine -- und jede fuehrt im Prompt in
      // einen anderen Satz. Ein gemeinsames "nichts gefunden" schickte den
      // Agenten in den falschen.
      //
      // Codex-Befund vom 14.08. (P1): die erste Fassung machte den Rueckfall auf
      // die Terminnummer UNERREICHBAR. Sie fragte nach `modus` -- und wer von
      // einem anderen Anschluss anruft, hat eine gueltige Anrufernummer, also
      // modus='caller_id'. Der Fall lief damit in "du hast keinen Termin" und
      // der Agent nahm eine Rueckrufanfrage auf, statt nach der Nummer zu
      // fragen. Das ist genau der Anwendungsfall, fuer den Rueckfall B gebaut
      // wurde; er waere in der Abnahme (Punkt 13) durchgefallen.
      //
      // Massgeblich ist deshalb nicht, WOMIT gesucht wurde, sondern was fuer
      // DIESEN Anruf noch offen ist.
      //
      // Die zweite Fassung fragte zusaetzlich `anstehende.length === 0` ab, um
      // "der Betrieb hat gar keinen Termin" eigens zu melden. Codex-Befund vom
      // 14.08. (P2): das ist betriebsweiter Zustand, und ein beliebiger Anrufer
      // haette daran ablesen koennen, ob dieser Betrieb ueberhaupt Voxera-
      // Termine anstehen hat. Schlimmer noch, die Auskunft war nicht einmal
      // gedeckt: `anstehende` laesst Altbestand und fremde Kalender weg, "es
      // steht nichts an" waere also auch sachlich falsch gewesen.
      //
      // Und wir KOENNEN es gar nicht wissen: wer hier nichts trifft, hat
      // entweder keinen Termin oder einen unter einer anderen Nummer. Beides
      // sieht von hier aus gleich aus. Also wird auch beides gleich beantwortet
      // -- mit der Frage nach der Terminnummer. Der Preis ist eine zusaetzliche
      // Frage bei jemandem, der wirklich keinen Termin hat; der Gegenwert ist,
      // dass die Antwort nichts behauptet, was wir nicht belegen koennen.
      // Keine stille Kuerzung: mehr Termine als die Antwort fasst ist ein
      // eigener Ausgang, kein stillschweigend abgeschnittener Erfolg.
      const gekuerzt = termine.length > LOOKUP_LIMIT;
      const grund = gekuerzt
        ? 'calendar_too_many_appointments'
        : (termine.length
          ? null
          // Eine Terminnummer wurde genannt und hat nicht zugewiesen -- entweder
          // passte sie zu nichts, oder sie war mehrdeutig und traegt deshalb
          // nichts. Der Agent liest sie einmal zur Kontrolle zurueck.
          : ((identitaet.bookingReference || belegMehrdeutig)
            ? 'calendar_booking_reference_unknown'
            // Noch keine Terminnummer im Spiel: danach fragen.
            : 'calendar_appointment_unmatched'));
      responsePayload = {
        ok: true,
        action,
        // Bei Ueberschreitung wird GAR NICHTS herausgegeben.
        //
        // Codex-Befund vom 14.08. (P2): die erste Fassung meldete `truncated`
        // und lieferte trotzdem fuenfzig verwertbare Termin-IDs. Der Prompt bat
        // das Modell, keine davon zu waehlen -- und genau das ist der Fehler,
        // den dieser PR an anderer Stelle selbst benennt: Prosa ist keine
        // Vorgabe. Wer den Rueckrufpfad erzwingen will, darf nichts
        // Verwertbares mitgeben.
        appointments: gekuerzt ? [] : termine.map((termin) => ({
          external_event_id: termin.external_event_id,
          start: termin.start,
          end: termin.end
        })),
        appointment_count: termine.length,
        identified_by: modus,
        ...(gekuerzt ? { truncated: true } : {}),
        timezone: String(settings.timezone || 'Europe/Zurich'),
        ...(grund ? { reason: grund } : {})
      };
      auditGeschrieben = true;
      await audit(sb, {
        customer_id: customerId,
        connection_id: connection.id,
        provider: connection.provider,
        action,
        actor_type: 'assistant',
        status: 'success',
        // Nur die Anzahl: die Termine selbst stehen bereits als eigene Zeilen
        // in dieser Tabelle, eine zweite Kopie waere Ballast.
        //
        // `caller_reference` und die beiden Zahlen daneben sind kein Ballast,
        // sondern die einzige Moeglichkeit, "warum fand er meinen Termin nicht"
        // spaeter zu beantworten: ohne sie liesse sich nicht unterscheiden, ob
        // gar kein Termin anstand oder ob die Zuordnung danebenlag.
        details: {
          appointment_count: termine.length,
          // Betriebsweite Zahl -- sie steht hier und NICHT in der Antwort an den
          // Agenten. Fuer die Diagnose ist sie unentbehrlich, dem Anrufenden
          // gegenueber waere sie eine Auskunft ueber fremde Termine.
          upcoming_total: anstehende.length,
          identified_by: modus,
          booking_reference_ambiguous: belegMehrdeutig,
          caller_reference: identitaet.callerReference || null,
          reason: grund
        }
      });
    } else if (action === 'availability') {
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
        const result = await checkAvailability(connection.provider, (await holeToken()).accessToken, connection.selected_calendar_id, window.start, window.end);
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
      //
      // Der Vorlauf gehoert seit dem Verschieben aus validateWindow() hier
      // ausdruecklich dazu. Sonst faellt das Feld genau dort um, wo die
      // Verschiebung wirkt: ein Fenster, das im Vorlauf beginnt und darueber
      // hinausreicht, behaelt seine spaeteren Termine -- und haette "ganzer
      // Zeitraum frei" gemeldet, obwohl der Anfang nicht buchbar ist und die
      // alte Fassung die Anfrage ganz abgelehnt haette.
      const wholeWindowFree = kalenderGefragt
        && busy.length === 0
        && !bookingWindowError(startIso, endIso, settings, openingHours)
        && !bookingTimingError(startIso, settings)
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
          // Grenzen der Belegung, ohne Titel und ohne Teilnehmer.
          //
          // Die Zeile trug zuerst nur Zahlen -- bewusst, um den Kalender des
          // Kunden nicht zu spiegeln. Am 13.08. liess sich damit die Frage
          // "welcher Termin fiel weg" nicht beantworten, und genau die wird im
          // Zweifelsfall zuerst gestellt: die Slot-Zahl allein unterscheidet
          // nicht zwischen einem Termin um 09:00 und einem um 09:30, beide
          // ergeben dieselbe Anzahl. Anfang und Ende sind der Pruefnachweis
          // fuer unsere eigene Rechnung, kein Abbild des Kundenkalenders.
          busy_windows: Array.isArray(responsePayload.busy)
            ? responsePayload.busy.slice(0, 20).map((eintrag) => ({ start: eintrag.start, end: eintrag.end }))
            : [],
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
      const availability = await checkAvailability(connection.provider, (await holeToken()).accessToken, connection.selected_calendar_id, window.start, window.end);
      if (!availability.available) {
        const conflict = new Error('calendar_slot_unavailable');
        conflict.status = 409;
        conflict.details = { busy: availability.busy };
        throw conflict;
      }
      // Die Terminnummer entsteht bei JEDER Buchung, nicht nur wenn die
      // Anrufernummer fehlt. Sie ist der Rueckfall fuer den naechsten Anruf --
      // von einem anderen Anschluss, mit unterdrueckter Nummer, oder wenn
      // jemand fuer eine andere Person gebucht hat. Zu diesem Zeitpunkt weiss
      // niemand, ob er gebraucht wird; ihn erst dann zu erzeugen, wenn er
      // fehlt, geht nicht.
      //
      // VOR createEvent gezogen: die Ziehung kann bei erschoepftem Nummernraum
      // abbrechen, und ein Abbruch nach dem Anlegen hinterliesse einen Termin im
      // Kalender, den unsere Historie nie gesehen hat.
      vergebeneBelege = issuedReferences(await loadAppointmentHistory(sb, customerId));
      const beleg = bookingReference(vergebeneBelege);
      const eventRecord = await createEvent(connection.provider, (await holeToken()).accessToken, connection.selected_calendar_id, input);
      externalEventId = String(eventRecord.id || '').trim();
      auditZusatz = {
        caller_reference: identitaet.callerReference || null,
        booking_reference: beleg,
        // Die Aenderungszeit des ANBIETERS, nicht unsere. Siehe mutationTime().
        provider_updated_at: eventRecord.updated || eventRecord.lastModifiedDateTime || null
      };
      responsePayload = {
        ok: true, action, external_event_id: externalEventId,
        event_url: eventRecord.htmlLink || eventRecord.webLink || null,
        start: input.start, end: input.end, timezone: input.timezone,
        booking_reference: beleg
      };
    } else if (action === 'reschedule') {
      const input = eventInput(body, settings);
      assertBookable(input.start, input.end, settings, openingHours, blockingUpdates);
      const window = bufferedWindow(input.start, input.end, settings);
      const availability = await checkAvailability(connection.provider, (await holeToken()).accessToken, connection.selected_calendar_id, window.start, window.end, externalEventId);
      if (!availability.available) {
        const conflict = new Error('calendar_slot_unavailable');
        conflict.status = 409;
        conflict.details = { busy: availability.busy };
        throw conflict;
      }
      // VOR updateEvent gezogen -- aus demselben Grund wie bei book.
      //
      // Codex-Befund vom 14.08. (P2): die Ziehung stand hinter updateEvent. Bei
      // einem Altbestandstermin ohne Nummer haette ein Abbruch der Ziehung
      // bedeutet, dass der Kalender schon die neue Zeit traegt, die Antwort aber
      // 503 lautet und keine Erfolgszeile entsteht -- ein Termin, der verschoben
      // ist, ohne dass unsere Historie davon weiss.
      const beleg = bestehenderTermin?.booking_reference || bookingReference(vergebeneBelege);
      const eventRecord = await updateEvent(connection.provider, (await holeToken()).accessToken, connection.selected_calendar_id, externalEventId, input);
      // Die Bindung wird FORTGESCHRIEBEN, nicht neu gesetzt: verschoben wird ein
      // bestehender Termin, und wer ihn verschiebt, uebernimmt ihn nicht. Sonst
      // koennte ein Verschieben still den Eigentuemer wechseln -- und das waere
      // genau der Weg, den die Pruefung oben verhindern soll.
      //
      // Nur wo nichts hinterlegt ist (Altbestand), traegt das Verschieben die
      // Kennung des aktuellen Anrufs nach. Eine Terminnummer bekommt ein solcher
      // Termin bei dieser Gelegenheit ebenfalls, damit er kuenftig auffindbar
      // ist.
      auditZusatz = {
        caller_reference: bestehenderTermin?.caller_reference || identitaet.callerReference || null,
        booking_reference: beleg,
        provider_updated_at: eventRecord.updated || eventRecord.lastModifiedDateTime || null
      };
      responsePayload = {
        ok: true, action, external_event_id: externalEventId,
        event_url: eventRecord.htmlLink || eventRecord.webLink || null,
        start: input.start, end: input.end, timezone: input.timezone,
        booking_reference: beleg
      };
    } else {
      const geloescht = await deleteEvent(connection.provider, (await holeToken()).accessToken, connection.selected_calendar_id, externalEventId);
      // Ein 404 ist keine Absage.
      //
      // `deleteEvent()` behandelt 404 als Erfolg und meldet `already_missing`;
      // der Rueckgabewert wurde bis zum 13.08. verworfen und `cancelled: true`
      // fest verdrahtet. Damit bestaetigte ein DELETE auf den FALSCHEN Kalender
      // eine Absage, die nicht stattgefunden hat -- der Termin blieb stehen,
      // der Anrufende hoerte "ist storniert".
      //
      // Wir koennen die beiden Ursachen nicht unterscheiden: schon geloescht,
      // oder am falschen Ort gesucht. Also bestaetigen wir nicht. Der
      // Fehlerpfad fuehrt in Schritt 15 des Kalenderblocks -- der Agent sagt,
      // dass er die Absage nicht selbst bestaetigen kann, und nimmt eine
      // Rueckrufanfrage auf.
      if (geloescht?.already_missing) {
        const error = new Error('calendar_event_already_missing');
        error.status = 409;
        throw error;
      }
      auditZusatz = { caller_reference: identitaet.callerReference || null };
      responsePayload = { ok: true, action, external_event_id: externalEventId, cancelled: true };
    }

    if (claimedAuditId) {
      const { error } = await sb.from('calendar_booking_audit').update({
        external_event_id: externalEventId,
        status: 'success',
        details: {
          response: responsePayload,
          // Auf WELCHEM Kalender der Termin liegt. Ohne diese Angabe kann das
          // Nachschlagen nach einem Kalenderwechsel nicht mehr unterscheiden,
          // welche Buchung noch absagbar ist.
          calendar_id: connection.selected_calendar_id,
          // Eigene Felder statt Ableitung aus `response`: die Antwortform gehoert
          // dem Agenten und darf sich aendern, die Bindung ist unser Schluessel.
          ...auditZusatz,
          completed_at: new Date().toISOString()
        }
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
        details: { response: responsePayload, ...auditZusatz }
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
          // Bei calendar_appointment_not_yours ist genau das die Frage, die
          // hinterher gestellt wird: wer hat es versucht.
          caller_reference: identitaet.callerReference || null,
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

exports._test = {
  verifyToolAuth, verifyHmac, validateWindow, assertTiming, bufferedWindow,
  // Zwei reine Funktionen, die sich am laufenden Handler nur unscharf pruefen
  // lassen: die Nummernvergabe zieht zufaellig, und ein Zufallstreffer auf eine
  // BESTIMMTE Nummer bleibt aus, ob die Sperre nun greift oder nicht. Direkt
  // geprueft ist die Zusicherung dagegen eindeutig.
  issuedReferences, resolveAppointments, upcomingAppointments, loadAppointmentHistory
};
