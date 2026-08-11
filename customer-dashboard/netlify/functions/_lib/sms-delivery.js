'use strict';

// sms-delivery.js
// Der einzige Versandweg fuer SMS aus dem Erstversand. Geschwister von
// _lib/mail-delivery.js und bewusst nach demselben Vertrag gebaut:
//
//   { attempted, accepted, status, outbox_id, error, skipped, reason }
//
// attempted = wurde ueberhaupt ein Request abgesetzt
// accepted  = Twilio hat ihn mit 2xx angenommen
// skipped   = bewusst nicht gesendet (kein Fehler)
// outbox_id = Zeile in outbox_events, ueber die outbox-retry-worker.js
//             nachliefert
//
// Der Unterschied zur Mail: die geht ueber Make-Szenario 09, die SMS geht
// direkt an Twilio (_lib/sms-transport.js). Ein Zwischen-Hop weniger, also
// eine Fehlerquelle weniger -- und Twilio antwortet mit maschinenlesbaren
// Fehlercodes, was die Unterscheidung "nochmal versuchen" gegen "nie wieder"
// ueberhaupt erst moeglich macht. Genau daran haengt der Festnetz-Fall.
//
//
// ACCEPTED IST NICHT ZUGESTELLT
//
// Ein 2xx von Twilio heisst: die Nachricht ist angenommen und eingereiht. Es
// heisst NICHT, dass sie auf einem Geraet angekommen ist. Der Beleg dafuer
// kaeme aus einem Status-Callback je Nachricht (das Muster existiert in
// twilio-status-callback.js fuer Sprache) und ist bewusst noch nicht gebaut.
//
// Ueberall, wo dieser Unterschied zaehlt, heisst das Feld deshalb `accepted`
// und nicht `delivered`. Wer daraus eine Zustellanzeige im Dashboard baut,
// muss vorher die Callbacks bauen -- sonst behauptet die Anzeige wieder etwas,
// das nicht belegt ist.

const { createOutboxEvent, markOutboxSent, markOutboxFailed } = require('./webhook-outbox');
const { normalizePhoneE164 } = require('./phone-normalize');
const {
  sendSmsViaTwilio,
  resolveSender,
  SMS_TEAM_EVENT,
  SMS_CALLER_EVENT,
  SMS_EVENT_TYPES,
  isSmsEventType
} = require('./sms-transport');

function toStr(v) { return v == null ? '' : String(v).trim(); }

function smsResult(extra = {}) {
  return {
    attempted: false,
    accepted: false,
    status: null,
    outbox_id: null,
    error: null,
    skipped: false,
    reason: null,
    permanent: false,
    provider_sid: null,
    ...extra
  };
}

function log(level, event, fields = {}) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/**
 * Versendet EINE SMS an EINEN Empfaenger und protokolliert sie in der Outbox.
 *
 * Wirft nie. Ein fehlgeschlagener Versand darf weder die Anrufaufnahme noch
 * den Versand an die uebrigen Empfaenger scheitern lassen -- das ist der Kern
 * der Mehrempfaenger-Anforderung: ein Abbruch bei der zweiten von fuenf
 * Nummern waere schlimmer als gar kein Versand, weil das Team sich dann
 * informiert glaubt.
 */
async function deliverSms(sbAdmin, {
  eventType,
  to,
  body,
  payloadSummary,
  dedupeKey,
  meta = {},
  env = process.env,
  fetchImpl = null
} = {}) {
  const typ = toStr(eventType);

  if (!isSmsEventType(typ)) {
    const error = `Unbekannter SMS-Ereignistyp "${typ || '(leer)'}" - kein Versand.`;
    log('error', 'sms_event_type_unknown', { event_type: typ || null });
    return smsResult({ error });
  }

  const text = toStr(body);
  if (!text) return smsResult({ skipped: true, reason: 'leerer_text' });

  // Empfaenger normalisieren. Eine unbrauchbare Nummer ist kein Fehlschlag,
  // sondern ein Grund zu ueberspringen -- und zwar ohne Outbox-Zeile, weil es
  // nichts nachzuliefern gibt. Hier landet die unterdrueckte Rufnummer:
  // Twilio liefert dann 'anonymous', die Normalisierung verwirft es.
  const ziel = normalizePhoneE164(to).normalized;
  if (!ziel) {
    log('info', 'sms_skipped', { event_type: typ, reason: 'keine_gueltige_nummer', ...meta });
    return smsResult({ skipped: true, reason: 'keine_gueltige_nummer' });
  }

  const { sender, error: senderError } = resolveSender(env);

  const payload = {
    ...meta,
    to: ziel,
    from: sender,
    body: text,
    sms_type: typ
  };

  // Auch die Fehlkonfiguration bekommt eine Outbox-Zeile: sonst ist der
  // Vorgang nach dem Deploy-Fix verloren, statt nachlieferbar zu sein.
  let outboxId = null;
  try {
    const outbox = await createOutboxEvent(sbAdmin, {
      eventType: typ,
      payload,
      payloadSummary: payloadSummary || `${typ} -> ${ziel}`,
      dedupeKey: dedupeKey || null
    });
    outboxId = outbox?.id || null;
  } catch (outboxError) {
    log('error', 'sms_outbox_insert_failed', { event_type: typ, error: outboxError?.message || 'outbox insert failed' });
    // Ohne Protokoll trotzdem senden -- eine zugestellte SMS ohne Zeile ist
    // besser als keine SMS.
  }

  if (senderError) {
    if (outboxId) await markOutboxFailed(sbAdmin, outboxId, senderError).catch(() => {});
    log('error', 'sms_misconfigured', { event_type: typ, outbox_id: outboxId, error: senderError });
    return smsResult({ outbox_id: outboxId, error: senderError });
  }

  const antwort = await sendSmsViaTwilio({ to: ziel, body: text, env, fetchImpl });

  if (antwort.ok) {
    if (outboxId) {
      await markOutboxSent(sbAdmin, outboxId).catch(stateError => {
        log('error', 'sms_outbox_state_write_failed', {
          event_type: typ, outbox_id: outboxId,
          error: stateError?.message || String(stateError)
        });
      });
    }
    log('info', 'sms_send_succeeded', { event_type: typ, outbox_id: outboxId, provider_sid: antwort.sid, ...meta });
    return smsResult({ attempted: true, accepted: true, status: antwort.status, outbox_id: outboxId, provider_sid: antwort.sid });
  }

  if (outboxId) {
    await markOutboxFailed(sbAdmin, outboxId, `${antwort.error} (code ${antwort.code ?? 'n/a'})`).catch(() => {});
  }

  // Ein permanenter Fehler ist keine Panne, sondern eine Eigenschaft des
  // Empfaengers -- die Festnetznummer des Anrufers ist der Regelfall, nicht
  // die Ausnahme. Er wird auf 'info' protokolliert, damit die Alarmierung
  // nicht bei jedem Festnetzanrufer anschlaegt, aber mit Code, damit er
  // zaehlbar bleibt.
  log(antwort.permanent ? 'info' : 'error',
    antwort.permanent ? 'sms_skipped_permanent' : 'sms_send_failed',
    { event_type: typ, outbox_id: outboxId, status: antwort.status, code: antwort.code, error: antwort.error, ...meta });

  return smsResult({
    attempted: true,
    status: antwort.status,
    outbox_id: outboxId,
    error: antwort.error,
    permanent: antwort.permanent,
    skipped: antwort.permanent,
    reason: antwort.permanent ? `twilio_${antwort.code ?? 'permanent'}` : null
  });
}

module.exports = {
  SMS_TEAM_EVENT,
  SMS_CALLER_EVENT,
  SMS_EVENT_TYPES,
  isSmsEventType,
  deliverSms
};
