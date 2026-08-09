'use strict';

// call-notification.js
// Die Anruf-Benachrichtigung an den Kunden - der Pfad, der bis zum 09.08.2026
// als einziger Mailversand an der Haertung aus PR #857 vorbeilief.
//
// Vorgeschichte: elevenlabs-post-call.js schob die Gespraechsdaten an
// MAKE_CALL_INTAKE_WEBHOOK (Make-Szenario 01). Dieses Szenario loeste den
// Kunden ueber einen HTTP-Aufruf zurueck auf call-intake-resolve-customer auf
// und versendete dann ueber ein eigenes SMTP-Modul. Drei Folgen:
//
//   1. Kein Versandprotokoll. Weder outbox_events noch ein Ergebnis, das der
//      Aufrufer haette pruefen koennen - der Anruf-Intake meldete Erfolg,
//      egal ob eine Mail rausging.
//   2. Kein Retry. Ein Fehlschlag war endgueltig.
//   3. Ein zusaetzlicher Netzwerk-Hop, der genau die Ausfaelle produzierte,
//      die den Pfad tagelang lahmlegten: der Resolver beantwortet einen
//      leeren called_number mit HTTP 400, und called_number stammte aus
//      metadata.phone_call des ElevenLabs-Payloads - einem Feld, das dort
//      fehlen kann und im Tool-Call-Pfad praktisch immer fehlt.
//
// Punkt 3 ist hier strukturell erledigt, nicht nur repariert: die Kundendaten
// kommen aus der bereits gematchten calls-Zeile (customer_id) statt aus der
// Telefonnummer im Webhook-Payload. Die Nummer bleibt nur noch Rueckfallweg
// fuer den Fall, dass die Zeile keinen Kunden traegt.

const { normalizePhoneE164 } = require('./phone-normalize');
const { deliverMail } = require('./mail-delivery');

const CALLBACK_MAIL_TYPE = 'callback_request_email';
const CALL_MAIL_TYPE = 'call_notification_email';

// Die Spalten, die ueber Empfaenger und Gating entscheiden. Identisch zu dem,
// was call-intake-resolve-customer.js an Make lieferte, damit die Migration
// das Verhalten nicht nebenbei mitaendert.
//
// notification_mode wird bewusst schon mitgeladen, obwohl decideMail() es
// heute nicht auswertet - der Auftrag "Benachrichtigungseinstellungen" stellt
// das Gating als naechsten Schritt darauf um.
const CUSTOMER_COLUMNS = 'id, customer_name, contact_name, email, voxera_number, '
  + 'notification_active, notification_mode, new_log_email_active, missed_call_email_active';

const DASHBOARD_URL = 'https://dashboard.voxera.ch';

function toStr(value) {
  return value == null ? '' : String(value).trim();
}

function notificationResult(extra = {}) {
  return {
    attempted: false,
    accepted: false,
    status: null,
    outbox_id: null,
    error: null,
    skipped: false,
    reason: null,
    mail_type: null,
    ...extra
  };
}

function logEvent(level, event, fields = {}) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

// Kunde ueber die Voxera-Nummer - nur noch Rueckfallweg. Gleiche zweistufige
// Logik wie im Resolver: erst exakt, dann normalisierter Scan, damit
// Formatabweichungen (0044..., Leerzeichen) nicht zum Fehlschlag werden.
async function resolveCustomerByNumber(sbAdmin, rawNumber) {
  const normalized = normalizePhoneE164(rawNumber).normalized;
  if (!normalized) return { customer: null, strategy: null };

  const exact = await sbAdmin
    .from('customers')
    .select(CUSTOMER_COLUMNS)
    .eq('voxera_number', normalized)
    .maybeSingle();
  if (exact.error) throw exact.error;
  if (exact.data) return { customer: exact.data, strategy: 'voxera_number_exact' };

  const candidates = await sbAdmin
    .from('customers')
    .select(CUSTOMER_COLUMNS)
    .not('voxera_number', 'is', null)
    .limit(5000);
  if (candidates.error) throw candidates.error;

  const matches = (candidates.data || [])
    .filter(row => normalizePhoneE164(row.voxera_number).normalized === normalized);

  // Mehrdeutigkeit ist hier kein Fehler, sondern ein Grund, nichts zu
  // verschicken: bei zwei Kunden auf derselben Nummer waere jede Wahl ein
  // Datenleck an den falschen Empfaenger.
  if (matches.length > 1) return { customer: null, strategy: 'ambiguous_number' };
  return { customer: matches[0] || null, strategy: matches[0] ? 'voxera_number_normalized' : null };
}

// Aufloesungsreihenfolge, absteigend nach Verlaesslichkeit:
//   1. die mitgegebene customer_id (kommt aus der gematchten calls-Zeile),
//   2. die calls-Zeile selbst, falls der Aufrufer die id nicht ermitteln konnte,
//   3. die Voxera-Nummer aus dem Webhook-Payload.
//
// Schritt 3 stand in Szenario 01 an erster Stelle und war der einzige Weg -
// deshalb genuegte dort ein leeres Feld im Payload, um die Benachrichtigung
// ausfallen zu lassen. Jetzt ist er der letzte Rueckfall.
async function loadCustomer(sbAdmin, { customerId, callRowId, calledNumber }) {
  let id = toStr(customerId);
  let strategy = 'call_row_customer_id';

  if (!id && toStr(callRowId)) {
    const { data, error } = await sbAdmin
      .from('calls')
      .select('customer_id')
      .eq('id', toStr(callRowId))
      .maybeSingle();
    if (error) throw error;
    id = toStr(data?.customer_id);
    strategy = 'call_row_lookup';
  }

  if (id) {
    const { data, error } = await sbAdmin
      .from('customers')
      .select(CUSTOMER_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (data) return { customer: data, strategy };
  }

  return resolveCustomerByNumber(sbAdmin, calledNumber);
}

// Welche Mail, und darf sie ueberhaupt raus.
//
// ── ZWISCHENSTAND, NICHT DER ZIELZUSTAND ───────────────────────────────────
// Die Bedingungen unten bilden die beiden Router-Filter aus Szenario 01 exakt
// nach:
//   Route "Callback TRUE":  callback_requested = true  + notification_active
//   Route "Normal Call":    callback_requested = false + new_log_email_active
// Beide zusaetzlich: customer_email vorhanden, customer_id vorhanden.
//
// Das ist hier Absicht, aber nur, weil eine Migration das Verhalten nicht
// nebenbei mitaendern soll: wer nach dem Umzug keine Mail mehr bekommt, soll
// sie auch vorher nicht bekommen haben. Es ist ausdruecklich KEINE Aussage
// darueber, dass diese Legacy-Booleans das richtige Gating waeren.
//
// Der Auftrag "Benachrichtigungseinstellungen" stellt diese Funktion als
// naechsten, eigens benannten Verhaltenswechsel auf notification_mode um
// (bereits in CUSTOMER_COLUMNS geladen). Die Reihenfolge ist abgestimmt:
// erst diese Migration, dann der Wechsel. Wer hier etwas anpasst, sollte sich
// vorher mit jenem Auftrag abgleichen - sonst wird derselbe Schalter zweimal
// verschieden umgebaut.
function decideMail(customer, callbackRequested) {
  if (!customer || !toStr(customer.id)) {
    return { mailType: null, reason: 'customer_not_resolved' };
  }
  if (!toStr(customer.email)) {
    return { mailType: null, reason: 'customer_without_email' };
  }
  if (callbackRequested) {
    if (customer.notification_active !== true) {
      return { mailType: null, reason: 'notification_active_off' };
    }
    return { mailType: CALLBACK_MAIL_TYPE, reason: null };
  }
  if (customer.new_log_email_active !== true) {
    return { mailType: null, reason: 'new_log_email_active_off' };
  }
  return { mailType: CALL_MAIL_TYPE, reason: null };
}

// Doppelversand-Schutz.
//
// Dieser Pfad wird oefter ausgeloest als jeder andere Mailtyp: der Tool-Call
// von Lara und der Post-Call-Webhook feuern beide fuer dasselbe Gespraech, und
// ElevenLabs stellt denselben Webhook bei Bedarf erneut zu. Ohne Sperre
// bekommt der Kunde dieselbe Anrufmail mehrfach.
//
// Der dedupe_key allein genuegt dafuer nicht: idx_outbox_events_dedupe_key ist
// kein Unique-Index, die Unique-Violation-Behandlung in webhook-outbox.js
// greift also nie. Deshalb hier eine explizite Vorabpruefung. Sie ist ein
// Rennen mit sich selbst nicht immun - zwei exakt gleichzeitige Laeufe koennen
// beide durchkommen -, schliesst aber den realen Fall (Zustellung Minuten
// spaeter erneut) zuverlaessig.
async function alreadyQueued(sbAdmin, mailType, dedupeKey) {
  if (!dedupeKey) return false;
  const { data, error } = await sbAdmin
    .from('outbox_events')
    .select('id, status')
    .eq('event_type', mailType)
    .eq('dedupe_key', dedupeKey)
    .limit(1);
  // Eine fehlgeschlagene Pruefung darf die Mail nicht verhindern - eine
  // moeglicherweise doppelte Benachrichtigung ist besser als keine.
  if (error) {
    logEvent('warn', 'call_notification_dedupe_check_failed', {
      mail_type: mailType, dedupe_key: dedupeKey, error: error.message || String(error)
    });
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

// Der Payload ist bewusst ein Zwitter, und beide Haelften haben einen Grund.
//
// Flach bleiben die Gespraechsfelder ({{1.caller_name}}, {{1.call_summary}}
// ...): genau so hiessen sie im Webhook-Bundle von Szenario 01, und nur
// deshalb liessen sich dessen HTML-Vorlagen unveraendert nach Szenario 09
// uebernehmen.
//
// Der Empfaenger dagegen folgt der Hausregel der Mail-Engine und ist
// verschachtelt: recipient: { email, name }, wie in jedem anderen Mailtyp
// (contract-countersign-service.js, lifecycle-runner.js, und so auch in
// required_payloads des Manifests). Die Route in Szenario 09 liest
// {{1.recipient.email}} - ein flaches recipient_email liefe dort ins Leere und
// die Mail ginge mit leerem Empfaenger raus.
function buildPayload({ customer, call, calledNumber, callbackRequested }) {
  const durationRaw = Number(call.duration_seconds);
  return {
    recipient: {
      email: toStr(customer.email),
      name: toStr(customer.contact_name) || toStr(customer.customer_name) || 'Kunde'
    },
    customer_id: toStr(customer.id),
    customer_name: toStr(customer.customer_name),
    contact_name: toStr(customer.contact_name),
    caller_name: toStr(call.caller_name),
    caller_phone: toStr(call.caller_phone),
    called_number: toStr(calledNumber) || toStr(customer.voxera_number),
    call_summary: toStr(call.call_summary),
    call_summary_short: toStr(call.call_summary_short),
    callback_requested: callbackRequested,
    category: toStr(call.category),
    lead_quality: toStr(call.lead_quality),
    next_action: toStr(call.next_action),
    priority: toStr(call.priority),
    duration_seconds: Number.isFinite(durationRaw) ? durationRaw : null,
    elevenlabs_conversation_id: toStr(call.elevenlabs_conversation_id),
    call_id: toStr(call.call_row_id),
    dashboard_url: DASHBOARD_URL
  };
}

/**
 * Versendet die Anruf-Benachrichtigung ueber die zentrale Mail-Engine.
 *
 * Wirft nie: ein fehlgeschlagener Versand darf die Anrufaufnahme nicht
 * scheitern lassen. Der Fehlschlag steht im Ergebnisobjekt und - sofern die
 * Outbox-Zeile geschrieben werden konnte - als Retry-Kandidat in
 * outbox_events.
 */
async function sendCallNotification(sbAdmin, {
  callRowId = null,
  customerId = null,
  calledNumber = '',
  call = {}
} = {}) {
  try {
    const callbackRequested = call.callback_requested === true;
    const { customer, strategy } = await loadCustomer(sbAdmin, { customerId, callRowId, calledNumber });
    const { mailType, reason } = decideMail(customer, callbackRequested);

    if (!mailType) {
      logEvent('info', 'call_notification_skipped', {
        reason,
        resolve_strategy: strategy,
        call_row_id: callRowId,
        callback_requested: callbackRequested
      });
      return notificationResult({ skipped: true, reason });
    }

    // Der Schluessel haengt am Datensatz, nicht am Webhook-Lauf: Tool-Call-Pfad
    // und Post-Call-Pfad treffen fuer dasselbe Gespraech dieselbe Zeile und
    // erzeugen damit denselben Schluessel.
    const dedupeScope = toStr(callRowId) || toStr(call.elevenlabs_conversation_id);
    const dedupeKey = dedupeScope ? `${mailType}:${dedupeScope}` : null;

    if (await alreadyQueued(sbAdmin, mailType, dedupeKey)) {
      logEvent('info', 'call_notification_skipped', {
        reason: 'already_queued', mail_type: mailType, dedupe_key: dedupeKey, call_row_id: callRowId
      });
      return notificationResult({ skipped: true, reason: 'already_queued', mail_type: mailType });
    }

    const payload = buildPayload({
      customer,
      call: { ...call, call_row_id: callRowId },
      calledNumber,
      callbackRequested
    });

    const delivery = await deliverMail(sbAdmin, {
      mailType,
      payload,
      payloadSummary: `${mailType} -> ${customer.id}`,
      dedupeKey
    });

    logEvent(delivery.accepted ? 'info' : 'error', 'call_notification_delivery', {
      mail_type: mailType,
      call_row_id: callRowId,
      customer_id: customer.id,
      resolve_strategy: strategy,
      outbox_id: delivery.outbox_id,
      accepted: delivery.accepted,
      error: delivery.error
    });

    return notificationResult({ ...delivery, mail_type: mailType });
  } catch (error) {
    const message = error?.message || String(error);
    logEvent('error', 'call_notification_failed', { call_row_id: callRowId, error: message });
    return notificationResult({ error: message });
  }
}

module.exports = {
  CALL_MAIL_TYPE,
  CALLBACK_MAIL_TYPE,
  decideMail,
  buildPayload,
  sendCallNotification
};
