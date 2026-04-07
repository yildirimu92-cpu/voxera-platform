'use strict';

async function createOutboxEvent(sbAdmin, { eventType, payload, payloadSummary }) {
  const now = new Date().toISOString();
  const row = {
    event_type: String(eventType || '').trim(),
    payload: payload || {},
    payload_summary: payloadSummary || null,
    status: 'pending',
    retry_count: 0,
    last_error: null,
    created_at: now,
    last_attempt_at: null
  };
  const { data, error } = await sbAdmin
    .from('outbox_events')
    .insert(row)
    .select('id, event_type, status, retry_count, created_at')
    .single();
  if (error) throw new Error(`outbox insert failed: ${error.message}`);
  return data;
}

async function markOutboxSent(sbAdmin, outboxId) {
  const now = new Date().toISOString();
  const { error } = await sbAdmin
    .from('outbox_events')
    .update({
      status: 'sent',
      retry_count: 1,
      last_error: null,
      last_attempt_at: now
    })
    .eq('id', outboxId);
  if (error) throw new Error(`outbox mark sent failed: ${error.message}`);
}

async function markOutboxFailed(sbAdmin, outboxId, errMsg) {
  const now = new Date().toISOString();
  const { data: row } = await sbAdmin
    .from('outbox_events')
    .select('retry_count')
    .eq('id', outboxId)
    .maybeSingle();
  const nextRetryCount = Number(row && row.retry_count || 0) + 1;
  const { error } = await sbAdmin
    .from('outbox_events')
    .update({
      status: 'failed',
      retry_count: nextRetryCount,
      last_error: String(errMsg || 'unknown error').slice(0, 3000),
      last_attempt_at: now
    })
    .eq('id', outboxId);
  if (error) throw new Error(`outbox mark failed failed: ${error.message}`);
}

module.exports = {
  createOutboxEvent,
  markOutboxSent,
  markOutboxFailed
};
