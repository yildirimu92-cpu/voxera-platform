'use strict';

// mail-delivery.js
// Der einzige Versandweg zur Voxera Central Mail Engine (Make-Szenario 09).
//
// Vorgeschichte: der Versand war fuenfmal unabhaengig implementiert - teils mit
// Outbox und Retry, teils als nackter fetch ohne jede Rueckmeldung - und jede
// Stelle gab ihr Ergebnis anders benannt zurueck ({accepted}, {sent},
// result.mail). Kein Aufrufer konnte das generisch pruefen, also prueften die
// meisten gar nicht: der Erfolgs-Toast im Admin-Portal erschien auch dann,
// wenn die Mail nachweislich nicht rausging.
//
// Nach aussen gibt es deshalb genau einen Vertrag, fuer jeden Sender gleich:
//   { attempted, accepted, status, outbox_id, error }
// attempted = wurde ueberhaupt ein Request abgesetzt
// accepted  = die Mail-Engine hat ihn mit 2xx quittiert
// outbox_id = Zeile in outbox_events, ueber die der Retry-Worker nachliefert

const { createOutboxEvent, markOutboxSent, markOutboxFailed } = require('./webhook-outbox');

// Die Typen, die Make-Szenario 09 kennt. Ein mail_type, der hier fehlt, faellt
// dort in die "Fallback - unbekannter mail_type"-Route und erzeugt eine
// Alarm-Mail an info@voxera.ch statt der erwarteten Nachricht - deshalb hier
// hart abweisen, statt es der Engine zu ueberlassen.
//
// Die Liste spiegelt config/mail-engine-contracts.json (canonical + aliases +
// legacy). Sie steht hier als Literal, weil Netlify die Funktionen einzeln
// bundelt und die Manifest-Datei ausserhalb des Funktionsverzeichnisses liegt;
// verify-mail-engine-contracts.mjs erzwingt die Gleichheit beider Listen.
// Der zurueckgezogene Alias countersign_email fehlt bewusst.
const MAIL_ENGINE_TYPES = Object.freeze([
  'ai_change_request',
  'assistant_updated_email',
  'contract_expired_email',
  'contract_signed_email',
  'invoice_email',
  'offer_email',
  'overage_email',
  'password_changed_email',
  'password_reset',
  'reminder_email',
  'reminder_final_email',
  'setup_fee_email',
  'subscription_payment_email',
  'welcome'
]);

function isMailEngineType(value) {
  return MAIL_ENGINE_TYPES.includes(String(value || '').trim());
}

function mailDeliveryResult({ attempted = false, accepted = false, status = null, outboxId = null, error = null } = {}) {
  return { attempted, accepted, status, outbox_id: outboxId, error };
}

// Aufloesung der Ziel-URL inklusive der Fehlkonfiguration, die uns das
// Admin-Benachrichtigungssystem gekostet hat: auf der Dashboard-Site zeigte
// MAKE_MAIL_WEBHOOK auf den Call-Intake-Hook eines abgeschalteten Szenarios.
// Make quittiert solche Requests mit HTTP 200 und legt sie in eine Queue, die
// niemand leert - der Versand sieht also von aussen erfolgreich aus. Der
// einzige Weg, das im Code zu bemerken, ist die Gleichheitspruefung: die
// beiden Hooks duerfen niemals dieselbe URL tragen.
function resolveMailWebhook(env = process.env) {
  const url = String(env.MAKE_MAIL_WEBHOOK || '').trim();
  const intakeUrl = String(env.MAKE_CALL_INTAKE_WEBHOOK || '').trim();

  if (!url) {
    return { url: null, error: 'MAKE_MAIL_WEBHOOK ist nicht konfiguriert.' };
  }
  if (intakeUrl && url === intakeUrl) {
    return {
      url: null,
      error: 'MAKE_MAIL_WEBHOOK und MAKE_CALL_INTAKE_WEBHOOK zeigen auf denselben Hook. '
        + 'Die Mail-Engine erreicht so keinen Versand. Bitte getrennte Make-Hooks eintragen.'
    };
  }
  return { url, error: null };
}

// Versendet ueber die Mail-Engine und protokolliert den Versuch in der Outbox,
// damit outbox-retry-worker.js nachliefern kann. Wirft nicht: ein
// fehlgeschlagener Mailversand darf den ausloesenden Geschaeftsvorgang
// (Vertrag gegengezeichnet, Case erstellt) nicht zurueckrollen. Stattdessen
// traegt das Ergebnisobjekt den Fehlschlag bis ins UI.
async function deliverMail(sbAdmin, { mailType, payload, payloadSummary, dedupeKey, env = process.env } = {}) {
  const type = String(mailType || '').trim();

  if (!isMailEngineType(type)) {
    const error = `Unbekannter mail_type "${type || '(leer)'}" - kein Versand.`;
    console.error(JSON.stringify({ level: 'error', event: 'mail_type_unknown', mail_type: type || null }));
    return mailDeliveryResult({ error });
  }

  const body = { ...(payload || {}), mail_type: type };
  const { url, error: configError } = resolveMailWebhook(env);

  // Auch die Fehlkonfiguration bekommt eine Outbox-Zeile: sonst ist der
  // Vorgang nach dem Deploy-Fix verloren, statt nachlieferbar zu sein.
  let outboxId = null;
  try {
    const outbox = await createOutboxEvent(sbAdmin, {
      eventType: type,
      payload: body,
      payloadSummary: payloadSummary || `${type} -> mail engine`,
      dedupeKey: dedupeKey || null
    });
    outboxId = outbox?.id || null;
  } catch (outboxError) {
    const message = outboxError?.message || 'outbox insert failed';
    console.error(JSON.stringify({ level: 'error', event: 'outbox_insert_failed', event_type: type, error: message }));
    // Ohne Outbox-Zeile trotzdem senden - eine zugestellte Mail ohne
    // Protokoll ist besser als gar keine Mail.
  }

  if (configError) {
    if (outboxId) await markOutboxFailed(sbAdmin, outboxId, configError).catch(() => {});
    console.error(JSON.stringify({ level: 'error', event: 'mail_webhook_misconfigured', event_type: type, error: configError }));
    return mailDeliveryResult({ outboxId, error: configError });
  }

  try {
    const webhookResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!webhookResponse.ok) {
      const responseText = await webhookResponse.text().catch(() => '');
      const error = `Mail-Engine antwortete mit HTTP ${webhookResponse.status}`;
      if (outboxId) await markOutboxFailed(sbAdmin, outboxId, error).catch(() => {});
      console.error(JSON.stringify({
        level: 'error',
        event: 'mail_send_failed',
        event_type: type,
        outbox_id: outboxId,
        status: webhookResponse.status,
        response_excerpt: responseText.slice(0, 300) || null
      }));
      return mailDeliveryResult({ attempted: true, status: webhookResponse.status, outboxId, error });
    }

    if (outboxId) await markOutboxSent(sbAdmin, outboxId).catch(() => {});
    console.log(JSON.stringify({ level: 'info', event: 'mail_send_succeeded', event_type: type, outbox_id: outboxId }));
    return mailDeliveryResult({ attempted: true, accepted: true, status: webhookResponse.status, outboxId });
  } catch (fetchError) {
    const error = fetchError?.message || 'Mail-Engine nicht erreichbar.';
    if (outboxId) await markOutboxFailed(sbAdmin, outboxId, error).catch(() => {});
    console.error(JSON.stringify({ level: 'error', event: 'mail_send_failed', event_type: type, outbox_id: outboxId, error }));
    return mailDeliveryResult({ attempted: true, outboxId, error });
  }
}

module.exports = {
  MAIL_ENGINE_TYPES,
  isMailEngineType,
  resolveMailWebhook,
  mailDeliveryResult,
  deliverMail
};
