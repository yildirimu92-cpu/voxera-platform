'use strict';

const OFFER_EVENT_TYPES = new Set([
  'created',
  'saved',
  'sent',
  'resend',
  'send_failed',
  'opened',
  'accepted',
  'declined',
  'expired'
]);
let offerEventsTableAvailable = true;

function isMissingOfferEventsTable(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return (
    (message.includes('offer_events') || details.includes('offer_events')) &&
    (
      message.includes('schema cache') ||
      message.includes('does not exist') ||
      message.includes('could not find') ||
      details.includes('schema cache')
    )
  );
}

async function recordOfferEvent(sbAdmin, payload) {
  if (!offerEventsTableAvailable) return;
  const eventType = String(payload?.event_type || '').trim().toLowerCase();
  const offerId = String(payload?.offer_id || '').trim();
  if (!offerId || !OFFER_EVENT_TYPES.has(eventType)) return;

  const row = {
    offer_id: offerId,
    event_type: eventType,
    event_at: payload?.event_at || new Date().toISOString(),
    actor_type: payload?.actor_type || null,
    actor_id: payload?.actor_id || null,
    recipient_email: payload?.recipient_email || null,
    subject: payload?.subject || null,
    meta: payload?.meta || null
  };

  const { error } = await sbAdmin.from('offer_events').insert(row);
  if (error) {
    if (isMissingOfferEventsTable(error)) {
      offerEventsTableAvailable = false;
      console.warn('[offer_events] disabled because table is missing in current schema');
      return;
    }
    console.warn('[offer_events] insert failed', {
      offer_id: offerId,
      event_type: eventType,
      message: error.message
    });
  }
}

module.exports = {
  OFFER_EVENT_TYPES,
  recordOfferEvent
};
