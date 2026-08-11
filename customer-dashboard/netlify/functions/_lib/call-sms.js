'use strict';

// call-sms.js
// Die Anruf-SMS an Team und Anrufer. Geschwister von _lib/call-notification.js
// (E-Mail) und bewusst danebengestellt statt hineingebaut: die beiden Kanaele
// teilen den Ausloesepunkt, aber weder Empfaenger noch Gating noch Fehlerfall.
//
//
// DIE REIHENFOLGE IST KEINE STILFRAGE
//
// Team zuerst, Anrufer danach -- und der Anrufer nur, wenn beim Team etwas
// angekommen ist.
//
// Der Grund steht am Strassenrand: Geht die Bestaetigung an den Anrufer raus,
// waehrend das Team nichts erhalten hat, dann hat jemand mitten in der Nacht
// eine schriftliche Zusage in der Hand, hinter der niemand steht. Er hoert auf,
// andere Hilfe zu suchen. Eine Bestaetigung, die niemand eingeloest hat, ist
// schaedlicher als gar keine.
//
// Umgekehrt ist ein fehlgeschlagener Anrufer-Versand bei erfolgreichem
// Team-Versand harmlos: Das Team faehrt trotzdem los.
//
//
// JEDER EMPFAENGER FUER SICH
//
// Twilio kennt keine Mehrfachadressierung. Fuenf Empfaenger sind fuenf
// Aufrufe, und jeder kann eigenstaendig scheitern -- Funkloch, Festnetznummer
// in der Liste, abgemeldete Nummer. Deshalb laeuft die Schleife immer zu Ende
// und sammelt Ergebnisse, statt beim ersten Fehler abzubrechen.
//
//
// WAS HIER BEWUSST NICHT GATET
//
// `customers.notification_mode`. Die Spalte steuert den MAILVERSAND -- die
// Einstellungsseite fuehrt sie als "E-Mail-Benachrichtigungen", und
// decideMail() in call-notification.js liest sie als solche. Ein Kunde, der
// "Keine E-Mails" waehlt, aber die SMS-Erweiterung gebucht hat, will keine
// Mails und trotzdem SMS -- sonst haette er nicht dafuer bezahlt.
//
// SMS gatet deshalb ausschliesslich auf die eigenen Schalter
// (`sms_notify_enabled` / `sms_caller_enabled`), den eigenen Ausloeser und die
// gebuchte Erweiterung. Das ist eine Entscheidung, keine Selbstverstaendlichkeit
// -- sie gehoert in die Abnahme.

const { normalizePhoneE164 } = require('./phone-normalize');
const { deliverSms, SMS_TEAM_EVENT, SMS_CALLER_EVENT } = require('./sms-delivery');
const { buildTeamSms, buildCallerSms } = require('./sms-templates');

const ADDON_TEAM = 'sms_notify';
const ADDON_CALLER = 'sms_endkunde';

// Obergrenze je Anruf. Sie ist eine Kostenbremse, keine Produktgrenze: bei
// fuenf Empfaengern kostet jeder Anruf das Fuenffache, und eine versehentlich
// aufgeblaehte Empfaengerliste faellt sonst erst auf der Rechnung auf.
//
// Wird sie erreicht, wird das PROTOKOLLIERT und nicht still abgeschnitten --
// eine stille Kappung sieht im Nachhinein aus wie ein vollstaendiger Versand.
const MAX_TEAM_EMPFAENGER = Number.parseInt(process.env.SMS_MAX_TEAM_EMPFAENGER || '', 10) || 10;

const CUSTOMER_COLUMNS = [
  'id', 'customer_name', 'customer_display_name', 'tel_nr', 'voxera_number',
  'sms_notify_enabled', 'sms_notify_trigger',
  'sms_caller_enabled', 'sms_caller_trigger',
  'notfallnummer_lebensgefahr'
].join(', ');

function toStr(v) { return v == null ? '' : String(v).trim(); }

function log(level, event, fields = {}) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function ergebnis(extra = {}) {
  return {
    team: { versucht: 0, angenommen: 0, uebersprungen: 0, fehlgeschlagen: 0, details: [] },
    anrufer: { versucht: false, angenommen: false, uebersprungen: false, reason: null },
    skipped: false,
    reason: null,
    error: null,
    ...extra
  };
}

/**
 * Ausloeser pruefen.
 *
 * 'all'           -> jeder Anruf
 * 'callback_only' -> nur bei Rueckrufwunsch
 *
 * Unbekannte Werte gelten als 'callback_only', nicht als 'all': im Zweifel
 * lieber eine SMS zu wenig als fuenf zu viel. Der Fall wird protokolliert,
 * damit er nicht still zur Normalitaet wird.
 */
function ausloeserTrifftZu(trigger, callbackRequested, customerId, feld) {
  const t = toStr(trigger).toLowerCase();
  if (t === 'all') return true;
  if (t === 'callback_only') return callbackRequested === true;
  if (t === 'none') return false;
  log('warn', 'sms_trigger_unbekannt', { customer_id: customerId || null, feld, wert: t || null, angewendet: 'callback_only' });
  return callbackRequested === true;
}

/** Aktive Erweiterungen des Kunden als Menge von addon_code. */
async function ladeAktiveAddons(sbAdmin, customerId) {
  const { data, error } = await sbAdmin
    .from('customer_addons')
    .select('addon_code, status, active, valid_until')
    .eq('customer_id', customerId);

  if (error) throw new Error(`customer_addons lookup failed: ${error.message}`);

  const jetzt = Date.now();
  const aktiv = (data || []).filter(a => {
    if (toStr(a.status).toLowerCase() !== 'active') return false;
    if (a.active === false) return false;
    if (a.valid_until && new Date(a.valid_until).getTime() < jetzt) return false;
    return true;
  });

  return new Set(aktiv.map(a => toStr(a.addon_code)));
}

/** Team-Empfaenger, in Reihenfolge, aktiv, entdoppelt. */
async function ladeTeamEmpfaenger(sbAdmin, customerId) {
  const { data, error } = await sbAdmin
    .from('customer_notification_recipients')
    .select('id, phone_e164, name, sort_order')
    .eq('customer_id', customerId)
    .eq('channel', 'sms')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw new Error(`recipients lookup failed: ${error.message}`);

  // Zweite Entdopplung nach Normalisierung: die Unique-Bedingung greift auf
  // der gespeicherten Schreibweise, und zwei Schreibweisen derselben Nummer
  // kaemen sonst als zwei Empfaenger durch -- zwei SMS, zwei Kosten, ein Mensch.
  const gesehen = new Set();
  const empfaenger = [];
  for (const zeile of data || []) {
    const nummer = normalizePhoneE164(zeile.phone_e164).normalized;
    if (!nummer || gesehen.has(nummer)) continue;
    gesehen.add(nummer);
    empfaenger.push({ id: zeile.id, nummer, name: toStr(zeile.name) });
  }
  return empfaenger;
}

// Ziel des Links in der Team-SMS.
//
// Einen Tiefenlink auf einen einzelnen Anruf gibt es im Dashboard nicht; der
// Navigationsparameter (?tab=requests, index.html:26225-26236) fuehrt aber
// direkt in die Anfragenliste, und der neueste Anruf steht dort oben. Das ist
// nah genug und kostet keine Aenderung an der Oberflaeche.
//
// Bewusst OHNE Anruf-Kennung: eine ID im Link waere fuer Twilio zwar
// bedeutungslos, wuerde aber einen dauerhaften Verweis auf genau diesen
// Vorgang in einem fremden Bestand hinterlassen.
const DASHBOARD_BASIS = (process.env.DASHBOARD_URL || 'https://dashboard.voxera.ch').replace(/\/+$/, '');
const DASHBOARD_ANFRAGEN_URL = `${DASHBOARD_BASIS}/?tab=requests`;

/**
 * Dringlichkeit fuer die Team-SMS.
 *
 * Die einzige Einstufung, die mitgeht -- sie sagt, wie schnell zu reagieren
 * ist, ohne zu sagen, worum es geht. Kategorie, Anliegen und Zusammenfassung
 * bleiben bewusst draussen (siehe Kopf von sms-templates.js).
 *
 * `callback_requested` faellt ebenfalls weg. Es steuert weiterhin den
 * AUSLOESER (sms_notify_trigger = 'callback_only'), steht aber nicht mehr im
 * Text: ob jemand zurueckgerufen werden will, ist eine Aussage ueber sein
 * Anliegen.
 */
function dringlichkeitAusAnruf(call) {
  const roh = toStr(call.urgency).toLowerCase();
  const karte = { hoch: 'hoch', mittel: 'mittel', niedrig: 'niedrig' };
  return karte[roh] || '';
}

/**
 * Rueckrufnummer fuer die Team-SMS.
 *
 * `callback_number` existiert heute noch nicht auf `calls` (siehe
 * TICKET_ORT_UND_RUECKRUFNUMMER_2026-08-11.md) und wird hier bereits gelesen:
 * sobald das Feld landet, wirkt es ohne weitere Aenderung, und bis dahin
 * kostet die Zeile nichts. `caller_phone` -- Twilios Herkunftsnummer -- bleibt
 * der Rueckfallweg.
 */
function rueckrufnummerFuerTeam(call) {
  return normalizePhoneE164(toStr(call.callback_number) || toStr(call.caller_phone)).normalized || '';
}

/**
 * Rueckrufnummer FUER DEN ANRUFER, also die Nummer des Betriebs.
 *
 * Sie muss in der Nachricht stehen, weil der Absender einweg ist: Der Anrufer
 * kann auf die Bestaetigung nicht antworten. Ohne Nummer im Text hat er keinen
 * Weg zurueck.
 *
 * `tel_nr` ist die Betriebsnummer, `voxera_number` der Rueckfallweg. Ist beim
 * Kunden eine Weiterleitung aktiv, landet ein Rueckruf auf `tel_nr` wieder
 * beim Assistenten -- das ist kein Fehler, sondern die Einrichtung, die der
 * Betrieb selbst gewaehlt hat.
 */
function rueckrufnummerFuerAnrufer(customer) {
  return normalizePhoneE164(toStr(customer.tel_nr) || toStr(customer.voxera_number)).normalized || '';
}

/**
 * Versendet die Anruf-SMS. Wirft nie.
 *
 * @returns Ergebnisobjekt mit Zaehlern je Empfaengergruppe.
 */
async function sendCallSms(sbAdmin, { callRowId = null, customerId = null, call = {} } = {}) {
  try {
    const kundeId = toStr(customerId);
    if (!kundeId) return ergebnis({ skipped: true, reason: 'kein_kunde' });

    const { data: customer, error: customerError } = await sbAdmin
      .from('customers')
      .select(CUSTOMER_COLUMNS)
      .eq('id', kundeId)
      .maybeSingle();
    if (customerError) throw customerError;
    if (!customer) return ergebnis({ skipped: true, reason: 'kunde_nicht_gefunden' });

    const addons = await ladeAktiveAddons(sbAdmin, kundeId);
    const callbackRequested = call.callback_requested === true;

    const teamAn = customer.sms_notify_enabled === true
      && addons.has(ADDON_TEAM)
      && ausloeserTrifftZu(customer.sms_notify_trigger, callbackRequested, kundeId, 'sms_notify_trigger');

    const anruferAn = customer.sms_caller_enabled === true
      && addons.has(ADDON_CALLER)
      && ausloeserTrifftZu(customer.sms_caller_trigger, callbackRequested, kundeId, 'sms_caller_trigger');

    if (!teamAn && !anruferAn) {
      log('info', 'sms_skipped', {
        call_row_id: callRowId, customer_id: kundeId, reason: 'nicht_aktiviert',
        team_enabled: customer.sms_notify_enabled === true, team_addon: addons.has(ADDON_TEAM),
        caller_enabled: customer.sms_caller_enabled === true, caller_addon: addons.has(ADDON_CALLER)
      });
      return ergebnis({ skipped: true, reason: 'nicht_aktiviert' });
    }

    const zeitpunkt = call.zeitpunkt || new Date();
    const res = ergebnis();

    // ── Team ─────────────────────────────────────────────────────────────────
    let teamVersuchtUeberhaupt = false;

    if (teamAn) {
      let empfaenger = await ladeTeamEmpfaenger(sbAdmin, kundeId);

      if (empfaenger.length > MAX_TEAM_EMPFAENGER) {
        log('warn', 'sms_empfaenger_gekappt', {
          call_row_id: callRowId, customer_id: kundeId,
          vorhanden: empfaenger.length, gesendet: MAX_TEAM_EMPFAENGER, grenze: MAX_TEAM_EMPFAENGER
        });
        empfaenger = empfaenger.slice(0, MAX_TEAM_EMPFAENGER);
      }

      if (!empfaenger.length) {
        log('warn', 'sms_team_ohne_empfaenger', { call_row_id: callRowId, customer_id: kundeId });
      }

      // Zusammenfassung, Name, Kategorie und Ort werden hier NICHT uebergeben
      // und von buildTeamSms auch nicht mehr entgegengenommen. Der Grund ist
      // Datenresidenz, nicht Platz: Twilio bewahrt den Nachrichtentext 400
      // Tage in den USA auf, die eigene Frist betraegt 90 Tage. Was nicht
      // gesendet wird, liegt dort auch nicht.
      const nachricht = buildTeamSms({
        dringlichkeit: dringlichkeitAusAnruf(call),
        rueckrufnummer: rueckrufnummerFuerTeam(call),
        dashboardUrl: DASHBOARD_ANFRAGEN_URL,
        zeitpunkt
      });

      if (nachricht.ueberEinSegment) {
        log('warn', 'sms_mehrere_segmente', {
          call_row_id: callRowId, customer_id: kundeId, art: 'team',
          laenge: nachricht.laenge, segmente: nachricht.segmente, empfaenger: empfaenger.length
        });
      }

      for (const e of empfaenger) {
        teamVersuchtUeberhaupt = true;
        res.team.versucht += 1;

        const ergebnisEinzeln = await deliverSms(sbAdmin, {
          eventType: SMS_TEAM_EVENT,
          to: e.nummer,
          body: nachricht.text,
          payloadSummary: `${SMS_TEAM_EVENT} -> ${kundeId} / ${e.name || e.nummer}`,
          // Der Schluessel haengt an Anruf UND Empfaenger: derselbe Anruf darf
          // jeden Empfaenger genau einmal erreichen, und ein erneut zugestellter
          // Webhook darf nicht fuenf weitere SMS ausloesen.
          dedupeKey: `${SMS_TEAM_EVENT}:${callRowId || call.elevenlabs_conversation_id || 'unbekannt'}:${e.nummer}`,
          meta: {
            call_row_id: callRowId, customer_id: kundeId,
            empfaenger_id: e.id, empfaenger_name: e.name || null,
            segmente: nachricht.segmente
          }
        });

        if (ergebnisEinzeln.accepted) res.team.angenommen += 1;
        else if (ergebnisEinzeln.skipped) res.team.uebersprungen += 1;
        else res.team.fehlgeschlagen += 1;

        res.team.details.push({
          empfaenger_id: e.id,
          name: e.name || null,
          angenommen: ergebnisEinzeln.accepted,
          uebersprungen: ergebnisEinzeln.skipped,
          reason: ergebnisEinzeln.reason,
          error: ergebnisEinzeln.error
        });
      }
    }

    // ── Anrufer ──────────────────────────────────────────────────────────────
    if (anruferAn) {
      // Die Sperre aus dem Kopfkommentar: Wurde ein Team-Versand VERSUCHT und
      // ist vollstaendig gescheitert, geht keine Bestaetigung raus.
      //
      // Wurde gar kein Team-Versand versucht (der Kunde hat die Erweiterung
      // nicht gebucht), ist das kein Fehlschlag -- dann traegt die Nachricht
      // nur eine schwaechere Aussage, siehe teamInformiert.
      if (teamVersuchtUeberhaupt && res.team.angenommen === 0) {
        res.anrufer.uebersprungen = true;
        res.anrufer.reason = 'team_nicht_erreicht';
        log('error', 'sms_anrufer_unterdrueckt', {
          call_row_id: callRowId, customer_id: kundeId,
          reason: 'team_nicht_erreicht',
          team_versucht: res.team.versucht,
          team_fehlgeschlagen: res.team.fehlgeschlagen,
          team_uebersprungen: res.team.uebersprungen
        });
      } else {
        const anruferNummer = normalizePhoneE164(toStr(call.caller_phone)).normalized;

        if (!anruferNummer) {
          // Unterdrueckte Rufnummer. Kein Fehler -- Twilio liefert dann
          // 'anonymous', die Normalisierung verwirft es, und `caller_phone`
          // steht auf NULL. Gemessen: 1 von 31 Anrufen.
          res.anrufer.uebersprungen = true;
          res.anrufer.reason = 'keine_anrufernummer';
          log('info', 'sms_anrufer_uebersprungen', { call_row_id: callRowId, customer_id: kundeId, reason: 'keine_anrufernummer' });
        } else {
          const nachricht = buildCallerSms({
            firma: toStr(customer.customer_display_name) || toStr(customer.customer_name),
            rueckrufnummer: rueckrufnummerFuerAnrufer(customer),
            notfallnummer: toStr(customer.notfallnummer_lebensgefahr),
            teamInformiert: res.team.angenommen > 0,
            zeitpunkt
          });

          if (nachricht.ueberEinSegment) {
            log('warn', 'sms_mehrere_segmente', {
              call_row_id: callRowId, customer_id: kundeId, art: 'anrufer',
              laenge: nachricht.laenge, segmente: nachricht.segmente
            });
          }

          res.anrufer.versucht = true;
          const ergebnisAnrufer = await deliverSms(sbAdmin, {
            eventType: SMS_CALLER_EVENT,
            to: anruferNummer,
            body: nachricht.text,
            payloadSummary: `${SMS_CALLER_EVENT} -> ${kundeId}`,
            dedupeKey: `${SMS_CALLER_EVENT}:${callRowId || call.elevenlabs_conversation_id || 'unbekannt'}`,
            meta: { call_row_id: callRowId, customer_id: kundeId, segmente: nachricht.segmente }
          });

          res.anrufer.angenommen = ergebnisAnrufer.accepted === true;
          res.anrufer.uebersprungen = ergebnisAnrufer.skipped === true;
          // Der Festnetz-Fall landet hier: Twilio 21614, permanent,
          // uebersprungen statt fehlgeschlagen.
          res.anrufer.reason = ergebnisAnrufer.reason;
        }
      }
    }

    log('info', 'sms_call_notification_ergebnis', {
      call_row_id: callRowId, customer_id: kundeId,
      team_versucht: res.team.versucht, team_angenommen: res.team.angenommen,
      team_uebersprungen: res.team.uebersprungen, team_fehlgeschlagen: res.team.fehlgeschlagen,
      anrufer_versucht: res.anrufer.versucht, anrufer_angenommen: res.anrufer.angenommen,
      anrufer_reason: res.anrufer.reason
    });

    return res;
  } catch (error) {
    const message = error?.message || String(error);
    log('error', 'sms_call_notification_failed', { call_row_id: callRowId, error: message });
    return ergebnis({ error: message });
  }
}

module.exports = {
  ADDON_TEAM,
  ADDON_CALLER,
  MAX_TEAM_EMPFAENGER,
  DASHBOARD_ANFRAGEN_URL,
  ausloeserTrifftZu,
  dringlichkeitAusAnruf,
  rueckrufnummerFuerTeam,
  rueckrufnummerFuerAnrufer,
  sendCallSms
};
