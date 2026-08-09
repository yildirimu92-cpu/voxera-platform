'use strict';

// admin-notification-events.js
// Die fuenf Admin-Benachrichtigungs-Events an genau einer Stelle, plus die
// Empfaengerermittlung dazu.
//
// Vorgeschichte (Diagnose vom 2026-08-09, Befunde B8/B9): von den fuenf am
// 09.08. beschlossenen Events existierte genau eines als echter Versand, und
// dieses eine trug keinen Empfaenger im Payload -- ai-change-request-create.js
// schickte nur customer_id und message, die Mail-Engine routete auf ein festes
// Sammelpostfach. Wer benachrichtigt wird, stand damit in Make und nicht im
// Code, und einstellen konnte es niemand.
//
// Diese Datei loest beides: sie kennt die Events, und sie beantwortet die
// einzige Frage, die jeder Versandpfad stellt -- "an wen geht das, wenn
// ueberhaupt".

const ADMIN_NOTIFICATION_EVENTS = Object.freeze([
  Object.freeze({
    key: 'ai_change_request',
    title: 'KI-Änderungsanfrage',
    description: 'Ein Kunde wünscht eine Änderung an seinem Assistenten.',
    defaultEmail: true,
    // Der einzige Event mit fertigem Versandweg. Die uebrigen vier haben eine
    // Ausloesestelle im Code, aber weder mail_type noch Route in
    // Make-Szenario 09 -- solange das so ist, meldet die Oberflaeche sie als
    // "noch nicht aktiv", statt einen Schalter anzubieten, der nichts tut.
    mailType: 'ai_change_request'
  }),
  Object.freeze({
    key: 'countersign_pending',
    title: 'Gegenzeichnung ausstehend',
    description: 'Ein Kunde hat unterschrieben — der Vertrag wartet auf Ihre Gegenzeichnung.',
    defaultEmail: true,
    mailType: null,
    plannedTrigger: 'admin-panel/netlify/functions/offer-public-accept.js'
  }),
  Object.freeze({
    key: 'contract_start_confirmed',
    title: 'Vertragsstart bestätigt',
    description: 'Ein Vertrag ist aktiv geworden.',
    defaultEmail: false,
    mailType: null,
    plannedTrigger: 'admin-panel/netlify/functions/_lib/contract-start-confirm.js'
  }),
  Object.freeze({
    key: 'billing_delivery_failure',
    title: 'Billing- oder Zustellfehler',
    description: 'Eine Rechnung oder E-Mail konnte nicht zugestellt werden.',
    defaultEmail: true,
    mailType: null,
    plannedTrigger: 'admin-panel/netlify/functions/outbox-retry-worker.js'
  }),
  Object.freeze({
    key: 'cancellation_submitted',
    title: 'Kündigung eingereicht',
    description: 'Ein Kunde hat gekündigt.',
    defaultEmail: true,
    mailType: null,
    plannedTrigger: 'customer-dashboard/netlify/functions/customer-cancel-contract.js'
  })
]);

const EVENT_KEYS = Object.freeze(ADMIN_NOTIFICATION_EVENTS.map(event => event.key));

function isAdminNotificationEvent(value) {
  return EVENT_KEYS.includes(String(value || '').trim());
}

function findAdminNotificationEvent(key) {
  return ADMIN_NOTIFICATION_EVENTS.find(event => event.key === String(key || '').trim()) || null;
}

// Empfaenger fuer ein Event: alle aktiven Admins, die es eingeschaltet haben.
//
// Wirft nicht. Ein Fehler bei der Empfaengerermittlung darf den ausloesenden
// Geschaeftsvorgang nicht scheitern lassen -- dieselbe Regel wie in
// deliverMail(). Er darf aber auch nicht still zu "keine Empfaenger" werden,
// sonst ist der Ausfall von einem bewusst abgeschalteten Event nicht mehr zu
// unterscheiden. Deshalb tragen beide Faelle unterschiedliche reason-Werte.
async function resolveAdminRecipients(sbAdmin, eventKey) {
  const key = String(eventKey || '').trim();
  if (!isAdminNotificationEvent(key)) {
    return { recipients: [], reason: 'unknown_event', error: `Unbekanntes Admin-Event "${key || '(leer)'}"` };
  }

  try {
    const { data, error } = await sbAdmin
      .from('admin_notification_settings')
      .select('email_enabled, admins!inner(id, email, name, status)')
      .eq('event_key', key)
      .eq('email_enabled', true)
      .eq('admins.status', 'active');
    if (error) throw error;

    const recipients = (data || [])
      .map(row => ({
        id: row?.admins?.id || null,
        email: String(row?.admins?.email || '').trim(),
        name: String(row?.admins?.name || '').trim() || null
      }))
      .filter(recipient => recipient.email);

    if (!recipients.length) {
      return { recipients: [], reason: 'no_recipients_enabled', error: null };
    }
    return { recipients, reason: null, error: null };
  } catch (error) {
    const message = error?.message || String(error);
    console.error(JSON.stringify({
      level: 'error',
      event: 'admin_recipients_lookup_failed',
      event_key: key,
      error: message
    }));
    return { recipients: [], reason: 'lookup_failed', error: message };
  }
}

// Fehlende Zeilen mit dem Werksstandard nachziehen. Wird beim Laden der
// Einstellungsseite aufgerufen, damit ein neu angelegter Admin dort nicht auf
// leere Schalter blickt und der Versand ihn trotzdem schon kennt.
async function ensureAdminNotificationDefaults(sbAdmin, adminId) {
  const id = String(adminId || '').trim();
  if (!id) return { ok: false, error: 'admin_id fehlt' };
  const rows = ADMIN_NOTIFICATION_EVENTS.map(event => ({
    admin_id: id,
    event_key: event.key,
    email_enabled: event.defaultEmail
  }));
  const { error } = await sbAdmin
    .from('admin_notification_settings')
    .upsert(rows, { onConflict: 'admin_id,event_key', ignoreDuplicates: true });
  if (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'admin_notification_defaults_failed',
      admin_id: id,
      error: error.message || String(error)
    }));
    return { ok: false, error: error.message || String(error) };
  }
  return { ok: true, error: null };
}

module.exports = {
  ADMIN_NOTIFICATION_EVENTS,
  EVENT_KEYS,
  isAdminNotificationEvent,
  findAdminNotificationEvent,
  resolveAdminRecipients,
  ensureAdminNotificationDefaults
};
