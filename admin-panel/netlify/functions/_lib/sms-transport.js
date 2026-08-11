'use strict';

// sms-transport.js
// Der nackte Twilio-Aufruf und die Einordnung seiner Fehler. Kein Wissen ueber
// Outbox, Kunden oder Vorlagen.
//
// Diese Datei liegt BYTE-IDENTISCH in beiden Funktionsverzeichnissen:
//
//   customer-dashboard/netlify/functions/_lib/sms-transport.js
//   admin-panel/netlify/functions/_lib/sms-transport.js
//
// Grund ist derselbe wie bei webhook-outbox.js und mail-delivery.js: Netlify
// bundelt die Funktionen je Site einzeln, ein Verzeichnis oberhalb ist nicht
// erreichbar. Der Erstversand laeuft auf der Dashboard-Site, der Retry-Worker
// auf der Admin-Site -- beide brauchen denselben Aufruf und dieselbe
// Fehlereinordnung.
//
// Wer hier etwas aendert, aendert es in BEIDEN Kopien. tests/sms-transport-
// kopien-identisch.test.cjs prueft das und schlaegt sonst fehl.
//
//
// WARUM DIE FEHLEREINORDNUNG HIER STEHT UND NICHT BEIM AUFRUFER
//
// Twilio antwortet auf einen untauglichen Empfaenger mit HTTP 400 -- genau wie
// auf eine kaputte Konfiguration oder ein leeres Guthaben. Ohne Auswertung des
// Fehlercodes sehen alle drei gleich aus, und der Retry-Worker wuerde eine
// Festnetznummer fuenfmal anschreiben, waehrend er ein Guthabenproblem nach
// fuenf Versuchen endgueltig aufgibt. Genau verkehrt herum.

// Die beiden SMS-Ereignistypen. Sie stehen hier und nicht in sms-delivery.js,
// weil beide Seiten sie brauchen: der Erstversand zum Schreiben, der
// Retry-Worker zum Wiedererkennen. Ein Typ, den der Worker nicht kennt, faellt
// dort in "unsupported event_type" und die Outbox-Zeile bleibt liegen, ohne
// dass es jemand merkt -- derselbe Fehler, den die Mail-Engine schon einmal
// hatte (siehe Kommentar in outbox-retry-worker.js).
const SMS_TEAM_EVENT = 'sms_team_notification';
const SMS_CALLER_EVENT = 'sms_caller_confirmation';
const SMS_EVENT_TYPES = Object.freeze([SMS_TEAM_EVENT, SMS_CALLER_EVENT]);

function isSmsEventType(value) {
  return SMS_EVENT_TYPES.includes(String(value || '').trim());
}

// Twilio-Fehlercodes, bei denen ein zweiter Versuch dasselbe Ergebnis braechte.
//
// 21614 ist der wichtige: "'To' number is not a valid mobile number" -- der
// Empfaenger haengt an einem Festnetzanschluss.
//
// Beim Team ist das ein Pflegefehler in der Empfaengerliste. Beim ANRUFER ist
// es ein voellig normaler Fall: Wer von zu Hause, aus dem Buero oder aus einer
// Werkstatt anruft, ruft vom Festnetz an. Der Versand darf daran nicht
// scheitern, sondern muss ihn ueberspringen -- ein Notfall-Ablauf, der an
// einem Festnetzanrufer haengenbleibt, waere schlimmer als keiner.
const PERMANENTE_FEHLERCODES = Object.freeze(new Set([
  21211, // Invalid 'To' phone number
  21214, // 'To' phone number cannot be reached
  21408, // Permission to send to this region not enabled
  21610, // Empfaenger hat abgemeldet (STOP). Bei alphanumerischem Absender
         // kaum erreichbar, aber wenn es passiert, ist es endgueltig.
  21612, // Auf dieser Route nicht zustellbar
  21614, // Keine Mobilnummer -- Festnetz
  21617  // Nachricht zu lang
]));

// Codes, bei denen ein spaeterer Versuch sinnvoll ist, obwohl Twilio 4xx
// antwortet. Guthaben ist der praktisch relevante: aufladen, und der Vorgang
// laeuft durch. Er gehoert deshalb ausdruecklich NICHT zu den permanenten
// Fehlern -- sonst waere eine Notfallbenachrichtigung endgueltig verloren,
// weil jemand vergessen hat, Geld nachzulegen.
//
// Das ist kein hypothetischer Fall: das Konto stand bei der Freigabe auf
// 3.67 USD.
const GUTHABEN_FEHLERCODES = Object.freeze(new Set([
  21606, // Nummer fuer dieses Konto nicht (mehr) nutzbar
  20005  // Konto nicht aktiv / gesperrt
]));

// Elf Zeichen sind die Obergrenze fuer alphanumerische Absenderkennungen.
// "Voxera" liegt mit sechs deutlich darunter.
const ALPHA_SENDER_MAX = 11;
const DEFAULT_SENDER = 'Voxera';

function toStr(v) { return v == null ? '' : String(v).trim(); }

/**
 * Absenderkennung aufloesen und pruefen.
 *
 * Versendet wird unter einer alphanumerischen Kennung ("Voxera"): im
 * Twilio-Konto freigeschaltet, ohne Registrierung, sofort verfuegbar. Der
 * Preis dafuer ist Einwegbetrieb -- niemand kann antworten, und das
 * STOP-Schluesselwort wirkt nicht. Beide Vorlagen tragen dem Rechnung.
 *
 * Eine rein numerische Konfiguration wird als Telefonnummer durchgelassen:
 * falls doch eine SMS-faehige Nummer beschafft wird, soll nur die
 * Umgebungsvariable wechseln muessen.
 */
function resolveSender(env = process.env) {
  const raw = toStr(env.TWILIO_SMS_FROM) || DEFAULT_SENDER;

  if (/^\+?[0-9]{8,15}$/.test(raw)) {
    const ziffern = raw.replace(/\D/g, '');
    if (ziffern.length < 8 || ziffern.length > 15) {
      return { sender: null, alphanumerisch: false, error: `TWILIO_SMS_FROM ist keine gueltige Nummer: ${raw}` };
    }
    return { sender: `+${ziffern}`, alphanumerisch: false, error: null };
  }

  if (raw.length > ALPHA_SENDER_MAX) {
    return {
      sender: null, alphanumerisch: true,
      error: `TWILIO_SMS_FROM "${raw}" ist ${raw.length} Zeichen lang, erlaubt sind hoechstens ${ALPHA_SENDER_MAX}.`
    };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 ]*$/.test(raw)) {
    return {
      sender: null, alphanumerisch: true,
      error: `TWILIO_SMS_FROM "${raw}" enthaelt unzulaessige Zeichen. Erlaubt sind Buchstaben, Ziffern und Leerzeichen.`
    };
  }

  return { sender: raw, alphanumerisch: true, error: null };
}

function resolveTwilioCredentials(env = process.env) {
  const accountSid = toStr(env.TWILIO_ACCOUNT_SID);
  const authToken = toStr(env.TWILIO_AUTH_TOKEN);
  if (!accountSid || !authToken) {
    return { accountSid: null, authToken: null, error: 'TWILIO_ACCOUNT_SID und TWILIO_AUTH_TOKEN muessen gesetzt sein.' };
  }
  return { accountSid, authToken, error: null };
}

/**
 * Ein einzelner Twilio-Aufruf. Wirft nie.
 *
 * @returns {{ok, status, code, permanent, error, sid}}
 *   permanent = ein erneuter Versuch braechte dasselbe Ergebnis
 */
async function sendSmsViaTwilio({ to, body, env = process.env, fetchImpl = null } = {}) {
  const ziel = toStr(to);
  const text = toStr(body);
  if (!ziel) return { ok: false, status: null, code: null, permanent: true, error: 'Kein Empfaenger.', sid: null };
  if (!text) return { ok: false, status: null, code: null, permanent: true, error: 'Leerer Text.', sid: null };

  const { sender, error: senderError } = resolveSender(env);
  if (senderError) return { ok: false, status: null, code: null, permanent: true, error: senderError, sid: null };

  const { accountSid, authToken, error: credError } = resolveTwilioCredentials(env);
  if (credError) return { ok: false, status: null, code: null, permanent: false, error: credError, sid: null };

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const form = new URLSearchParams({ To: ziel, From: sender, Body: text });
  const doFetch = fetchImpl || fetch;

  let res;
  try {
    res = await doFetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form
    });
  } catch (netzFehler) {
    // Netzwerkfehler ist immer transient -- nachliefern lassen.
    return { ok: false, status: null, code: null, permanent: false, error: netzFehler?.message || 'Twilio nicht erreichbar.', sid: null };
  }

  const rohtext = await res.text().catch(() => '');
  let json = null;
  try { json = rohtext ? JSON.parse(rohtext) : null; } catch { /* Twilio antwortet nicht immer JSON */ }

  if (res.ok) {
    // Angenommen, nicht zugestellt. Der Unterschied steht im Kopf von
    // sms-delivery.js und ist beabsichtigt sichtbar im Feldnamen.
    return { ok: true, status: res.status, code: null, permanent: false, error: null, sid: json?.sid || null };
  }

  const code = Number(json?.code) || null;
  const meldung = toStr(json?.message) || `Twilio antwortete mit HTTP ${res.status}`;

  // Reihenfolge zaehlt: Guthaben zuerst, damit ein Kontoproblem nicht
  // faelschlich als endgueltig gilt und die Nachricht verloren geht.
  if (code && GUTHABEN_FEHLERCODES.has(code)) {
    return { ok: false, status: res.status, code, permanent: false, error: `${meldung} (Konto/Guthaben pruefen)`, sid: null };
  }
  if (code && PERMANENTE_FEHLERCODES.has(code)) {
    return { ok: false, status: res.status, code, permanent: true, error: meldung, sid: null };
  }

  // 429 und 5xx sind transient, alles ohne bekannten Code ebenfalls: im
  // Zweifel nochmal versuchen, statt eine Notfallnachricht wegzuwerfen.
  return { ok: false, status: res.status, code, permanent: false, error: meldung, sid: null };
}

module.exports = {
  SMS_TEAM_EVENT,
  SMS_CALLER_EVENT,
  SMS_EVENT_TYPES,
  isSmsEventType,
  PERMANENTE_FEHLERCODES,
  GUTHABEN_FEHLERCODES,
  ALPHA_SENDER_MAX,
  DEFAULT_SENDER,
  resolveSender,
  resolveTwilioCredentials,
  sendSmsViaTwilio
};
