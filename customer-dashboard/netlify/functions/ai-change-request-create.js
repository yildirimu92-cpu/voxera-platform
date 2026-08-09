'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');
const { insertOperationalCase } = require('./_lib/create-operational-case');
const { deliverMail } = require('./_lib/mail-delivery');
const { resolveAdminRecipients } = require('./_lib/admin-notification-events');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) return response(500, { error: 'Supabase-Konfiguration fehlt.' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin, requireActiveContract: true });
  if (!caller?.ok) return response(caller?.statusCode || 403, caller?.body || { error: 'Zugriff verweigert.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return response(400, { error: 'Ungültiger Request Body.' }); }
  const message = String(body.message || '').trim().slice(0, 6000);
  if (!message) return response(400, { error: 'Bitte beschreiben Sie die gewünschte Änderung.' });

  const now = new Date().toISOString();
  const { data: request, error: requestError } = await sbAdmin
    .from('ai_change_requests')
    .insert({ customer_id: caller.customerId, message, status: 'open', created_at: now, updated_at: now })
    .select('*')
    .single();
  if (requestError) return response(500, { error: 'Änderungsanfrage konnte nicht gespeichert werden.', details: requestError.message });

  try {
    const createdCase = await insertOperationalCase(sbAdmin, {
      customerId: caller.customerId,
      title: 'Assistenten-Anpassung',
      note: message,
      caseType: 'assistant_change',
      source: 'ai_change_request',
      sourceRefId: request.id,
      originChannel: 'customer_portal',
      requesterUserId: caller.userId || null,
      requesterEmail: caller.email || null,
      priority: 'medium'
    });

    // Der Case allein informiert niemanden - ohne diese Mail bemerkt das Team
    // eine Aenderungsanfrage erst, wenn zufaellig jemand die Fallliste oeffnet.
    // Der Versand darf die Anfrage aber nicht scheitern lassen: die Anfrage ist
    // gespeichert, der Case existiert, und ein fehlgeschlagener Versand liegt
    // als Outbox-Zeile fuer den Retry-Worker bereit. Das Ergebnis geht
    // trotzdem mit raus, damit das UI nicht blind Erfolg meldet.
    // Die Mail-Engine setzt customer_name in den Betreff. Der Guard liefert nur
    // die ID, also hier nachschlagen - ein fehlender Name darf den Versand
    // nicht verhindern, deshalb ohne Fehlerpfad.
    const { data: customerRow } = await sbAdmin
      .from('customers')
      .select('customer_display_name, customer_name, email')
      .eq('id', caller.customerId)
      .maybeSingle();
    const customerName = customerRow?.customer_display_name
      || customerRow?.customer_name
      || customerRow?.email
      || caller.customerId;

    // Empfaenger aus admin_notification_settings statt aus dem Sammelpostfach
    // der Mail-Engine. Bis 2026-08-09 trug dieser Payload keinen Empfaenger:
    // wer benachrichtigt wurde, stand in Make, und einstellen konnte es
    // niemand.
    //
    // Drei Ausgaenge, bewusst unterschieden - "niemand will das" und "die
    // Abfrage ist gescheitert" duerfen nicht dasselbe Ergebnis liefern:
    const { recipients, reason: recipientReason, error: recipientError } =
      await resolveAdminRecipients(sbAdmin, 'ai_change_request');

    let mailDelivery;
    if (!recipients.length) {
      // Kein Versand, aber auch keine erfundene Erfolgsmeldung. Der Grund geht
      // mit ins Ergebnis, damit das UI "bewusst abgeschaltet" von "kaputt"
      // unterscheiden kann.
      mailDelivery = {
        attempted: false,
        accepted: false,
        status: null,
        outbox_id: null,
        error: recipientError,
        skipped: true,
        reason: recipientReason
      };
      console.log(JSON.stringify({
        level: recipientReason === 'lookup_failed' ? 'error' : 'info',
        event: 'ai_change_request_no_admin_recipients',
        reason: recipientReason,
        request_id: request.id
      }));
    } else {
      mailDelivery = await deliverMail(sbAdmin, {
        mailType: 'ai_change_request',
        payload: {
          customer_id: caller.customerId,
          customer_name: customerName,
          message,
          case_id: createdCase?.id || null,
          request_id: request.id,
          admin_url: 'https://admin.voxera.ch/#ai-setup',
          timestamp: now,
          // Die Mail-Engine nimmt recipient.email als Ziel. Mehrere Admins
          // stehen zusaetzlich in recipients, damit Szenario 09 sie spaeter
          // ohne Payload-Aenderung auffaechern kann.
          recipient: { email: recipients[0].email, name: recipients[0].name },
          recipients: recipients.map(entry => ({ email: entry.email, name: entry.name }))
        },
        payloadSummary: `ai_change_request -> ${recipients.map(entry => entry.email).join(', ')}`,
        dedupeKey: `ai_change_request:${request.id}`
      });
    }

    return response(200, { success: true, request, case: createdCase, mail_delivery: mailDelivery });
  } catch (error) {
    await sbAdmin.from('ai_change_requests').delete().eq('id', request.id);
    console.error('[ai-change-request-create]', error);
    return response(500, { error: 'Interner Case konnte nicht erstellt werden.', details: error.message });
  }
};
