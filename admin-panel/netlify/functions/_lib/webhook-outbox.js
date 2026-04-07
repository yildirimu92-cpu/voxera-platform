'use strict';

function isMissingColumnError(error) {
  const code = String(error && error.code || '');
  const message = String(error && error.message || '').toLowerCase();
  return (
    code === '42703'
    || code === 'PGRST204'
    || (message.includes('column') && message.includes('does not exist'))
    || message.includes('schema cache')
  );
}

function formatSupabaseError(error) {
  if (!error) return 'unknown error';
  const payload = {
    code: error.code || null,
    message: error.message || 'unknown error',
    details: error.details || null,
    hint: error.hint || null
  };
  return JSON.stringify(payload);
}

async function insertOutboxModern(sbAdmin, row) {
  return sbAdmin
    .from('outbox_events')
    .insert(row)
    .select('id, event_type, status, retry_count, created_at')
    .single();
}

async function insertOutboxLegacy(sbAdmin, row) {
  const legacyRow = {
    event_type: row.event_type,
    payload: row.payload,
    status: row.status,
    attempts: 0,
    created_at: row.created_at,
    processed_at: null
  };
  return sbAdmin
    .from('outbox_events')
    .insert(legacyRow)
    .select('id, event_type, status, attempts, created_at')
    .single();
}

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

  const modernResult = await insertOutboxModern(sbAdmin, row);
  if (!modernResult.error) {
    return modernResult.data;
  }

  if (!isMissingColumnError(modernResult.error)) {
    throw new Error(`outbox insert failed: ${formatSupabaseError(modernResult.error)}`);
  }

  console.warn(JSON.stringify({
    level: 'warn',
    event: 'outbox_schema_fallback',
    operation: 'insert',
    reason: 'missing_modern_columns',
    error: modernResult.error.message
  }));

  const legacyResult = await insertOutboxLegacy(sbAdmin, row);
  if (legacyResult.error) {
    throw new Error(`outbox insert failed (legacy fallback): ${formatSupabaseError(legacyResult.error)}`);
  }

  return {
    id: legacyResult.data.id,
    event_type: legacyResult.data.event_type,
    status: legacyResult.data.status,
    retry_count: Number(legacyResult.data.attempts || 0),
    created_at: legacyResult.data.created_at
  };
}

async function markOutboxSent(sbAdmin, outboxId) {
  const now = new Date().toISOString();
  const modern = await sbAdmin
    .from('outbox_events')
    .update({
      status: 'sent',
      retry_count: 1,
      last_error: null,
      last_attempt_at: now
    })
    .eq('id', outboxId);

  if (!modern.error) return;
  if (!isMissingColumnError(modern.error)) {
    throw new Error(`outbox mark sent failed: ${formatSupabaseError(modern.error)}`);
  }

  const legacy = await sbAdmin
    .from('outbox_events')
    .update({
      status: 'sent',
      attempts: 1,
      processed_at: now
    })
    .eq('id', outboxId);

  if (legacy.error) {
    throw new Error(`outbox mark sent failed (legacy fallback): ${formatSupabaseError(legacy.error)}`);
  }
}

async function markOutboxFailed(sbAdmin, outboxId, errMsg) {
  const now = new Date().toISOString();
  const currentError = String(errMsg || 'unknown error').slice(0, 3000);

  const { data: modernRow, error: modernReadError } = await sbAdmin
    .from('outbox_events')
    .select('retry_count')
    .eq('id', outboxId)
    .maybeSingle();

  if (modernReadError && !isMissingColumnError(modernReadError)) {
    throw new Error(`outbox read retry_count failed: ${formatSupabaseError(modernReadError)}`);
  }

  if (!modernReadError) {
    const nextRetryCount = Number(modernRow && modernRow.retry_count || 0) + 1;
    const { error } = await sbAdmin
      .from('outbox_events')
      .update({
        status: 'failed',
        retry_count: nextRetryCount,
        last_error: currentError,
        last_attempt_at: now
      })
      .eq('id', outboxId);

    if (error) throw new Error(`outbox mark failed failed: ${formatSupabaseError(error)}`);
    return;
  }

  const { data: legacyRow, error: legacyReadError } = await sbAdmin
    .from('outbox_events')
    .select('attempts')
    .eq('id', outboxId)
    .maybeSingle();

  if (legacyReadError) {
    throw new Error(`outbox read attempts failed (legacy fallback): ${formatSupabaseError(legacyReadError)}`);
  }

  const nextAttempts = Number(legacyRow && legacyRow.attempts || 0) + 1;
  const { error: legacyUpdateError } = await sbAdmin
    .from('outbox_events')
    .update({
      status: 'failed',
      attempts: nextAttempts,
      processed_at: now
    })
    .eq('id', outboxId);

  if (legacyUpdateError) {
    throw new Error(`outbox mark failed failed (legacy fallback): ${formatSupabaseError(legacyUpdateError)}`);
  }
}

module.exports = {
  createOutboxEvent,
  markOutboxSent,
  markOutboxFailed
};
