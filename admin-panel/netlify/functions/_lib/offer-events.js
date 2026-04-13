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

async function recordOfferEvent(sbAdmin, payload) {
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
