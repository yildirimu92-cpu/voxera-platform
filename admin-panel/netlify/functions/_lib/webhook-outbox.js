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

function isUniqueViolation(error) {
  return String(error && error.code || '') === '23505';
}

async function findExistingOutboxEvent(sbAdmin, eventType, dedupeKey) {
  if (!dedupeKey) return null;
  const { data, error } = await sbAdmin
    .from('outbox_events')
    .select('id, event_type, status, retry_count, created_at, dedupe_key, last_error, last_attempt_at')
    .eq('event_type', eventType)
    .eq('dedupe_key', dedupeKey)
    .maybeSingle();
  if (error) throw new Error(`outbox duplicate lookup failed: ${formatSupabaseError(error)}`);
  return data ? { ...data, duplicate: true } : null;
}

async function insertOutboxModern(sbAdmin, row) {
  return sbAdmin
    .from('outbox_events')
    .insert(row)
    .select('id, event_type, status, retry_count, created_at, dedupe_key')
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

async function createOutboxEvent(sbAdmin, { eventType, payload, payloadSummary, dedupeKey }) {
  const now = new Date().toISOString();
  const row = {
    event_type: String(eventType || '').trim(),
    payload: payload || {},
    payload_summary: payloadSummary || null,
    dedupe_key: dedupeKey || null,
    status: 'pending',
    retry_count: 0,
    last_error: null,
    created_at: now,
    last_attempt_at: null
  };

  const modernResult = await insertOutboxModern(sbAdmin, row);
  if (!modernResult.error) return modernResult.data;

  if (isUniqueViolation(modernResult.error)) {
    const existing = await findExistingOutboxEvent(sbAdmin, row.event_type, row.dedupe_key);
    if (existing) return existing;
  }

  if (!isMissingColumnError(modernResult.error)) {
    throw new Error(`outbox insert failed: ${formatSupabaseError(modernResult.error)}`);
  }

  console.warn(JSON.stringify({ level: 'warn', event: 'outbox_schema_fallback', operation: 'insert', reason: 'missing_modern_columns', error: modernResult.error.message }));

  const legacyResult = await insertOutboxLegacy(sbAdmin, row);
  if (legacyResult.error) throw new Error(`outbox insert failed (legacy fallback): ${formatSupabaseError(legacyResult.error)}`);

  return {
    id: legacyResult.data.id,
    event_type: legacyResult.data.event_type,
    status: legacyResult.data.status,
    retry_count: Number(legacyResult.data.attempts || 0),
    created_at: legacyResult.data.created_at
  };
}

async function markAcceptedInvoiceOpen(sbAdmin, outboxRow) {
  const eventType = String(outboxRow && outboxRow.event_type || '').trim();
  if (!['invoice_email', 'setup_fee_email'].includes(eventType)) return;
  const payload = outboxRow && outboxRow.payload || {};
  const invoiceId = String(payload.invoice && payload.invoice.id || payload.setup_fee && payload.setup_fee.invoice_id || '').trim();
  if (!invoiceId) return;
  try {
    const { data: invoice, error: readError } = await sbAdmin
      .from('invoices')
      .select('id,status')
      .eq('id', invoiceId)
      .maybeSingle();
    if (readError) throw readError;
    if (!invoice || String(invoice.status || '').toLowerCase() !== 'draft') return;
    const { error: updateError } = await sbAdmin
      .from('invoices')
      .update({ status: 'open', updated_at: new Date().toISOString() })
      .eq('id', invoiceId);
    if (updateError) throw updateError;
  } catch (error) {
    console.warn(JSON.stringify({ level: 'warn', event: 'invoice_status_after_dispatch_failed', invoice_id: invoiceId, outbox_id: outboxRow && outboxRow.id || null, error: formatSupabaseError(error) }));
  }
}

async function markOutboxSent(sbAdmin, outboxId) {
  const now = new Date().toISOString();
  const { data: modernRow, error: modernReadError } = await sbAdmin
    .from('outbox_events')
    .select('id,retry_count,event_type,payload')
    .eq('id', outboxId)
    .maybeSingle();

  if (modernReadError && !isMissingColumnError(modernReadError)) {
    throw new Error(`outbox read retry_count failed: ${formatSupabaseError(modernReadError)}`);
  }

  if (!modernReadError) {
    const nextRetryCount = Number(modernRow && modernRow.retry_count || 0) + 1;
    const { error } = await sbAdmin
      .from('outbox_events')
      .update({ status: 'sent', retry_count: nextRetryCount, last_error: null, last_attempt_at: now })
      .eq('id', outboxId);

    if (error) throw new Error(`outbox mark sent failed: ${formatSupabaseError(error)}`);
    await markAcceptedInvoiceOpen(sbAdmin, modernRow);
    return;
  }

  const { data: legacyRow, error: legacyReadError } = await sbAdmin
    .from('outbox_events')
    .select('id,attempts,event_type,payload')
    .eq('id', outboxId)
    .maybeSingle();

  if (legacyReadError) throw new Error(`outbox read attempts failed (legacy fallback): ${formatSupabaseError(legacyReadError)}`);

  const nextAttempts = Number(legacyRow && legacyRow.attempts || 0) + 1;
  const modern = await sbAdmin
    .from('outbox_events')
    .update({ status: 'sent', attempts: nextAttempts, processed_at: now })
    .eq('id', outboxId);

  if (modern.error) throw new Error(`outbox mark sent failed (legacy fallback): ${formatSupabaseError(modern.error)}`);
  await markAcceptedInvoiceOpen(sbAdmin, legacyRow);
}

async function markOutboxFailed(sbAdmin, outboxId, errMsg) {
  const now = new Date().toISOString();
  const currentError = String(errMsg || 'unknown error').slice(0, 3000);

  const { data: modernRow, error: modernReadError } = await sbAdmin
    .from('outbox_events')
    .select('retry_count')
    .eq('id', outboxId)
    .maybeSingle();

  if (modernReadError && !isMissingColumnError(modernReadError)) throw new Error(`outbox read retry_count failed: ${formatSupabaseError(modernReadError)}`);

  if (!modernReadError) {
    const nextRetryCount = Number(modernRow && modernRow.retry_count || 0) + 1;
    const { error } = await sbAdmin
      .from('outbox_events')
      .update({ status: 'failed', retry_count: nextRetryCount, last_error: currentError, last_attempt_at: now })
      .eq('id', outboxId);
    if (error) throw new Error(`outbox mark failed failed: ${formatSupabaseError(error)}`);
    return;
  }

  const { data: legacyRow, error: legacyReadError } = await sbAdmin.from('outbox_events').select('attempts').eq('id', outboxId).maybeSingle();
  if (legacyReadError) throw new Error(`outbox read attempts failed (legacy fallback): ${formatSupabaseError(legacyReadError)}`);
  const nextAttempts = Number(legacyRow && legacyRow.attempts || 0) + 1;
  const { error: legacyUpdateError } = await sbAdmin.from('outbox_events').update({ status: 'failed', attempts: nextAttempts, processed_at: now }).eq('id', outboxId);
  if (legacyUpdateError) throw new Error(`outbox mark failed failed (legacy fallback): ${formatSupabaseError(legacyUpdateError)}`);
}

async function markOutboxTerminal(sbAdmin, outboxId, errMsg) {
  const now = new Date().toISOString();
  const currentError = String(errMsg || 'retry limit reached').slice(0, 3000);
  let { error: modernError } = await sbAdmin.from('outbox_events').update({ status: 'dead', dead_lettered_at: now, last_error: currentError, last_attempt_at: now }).eq('id', outboxId);
  if (modernError && isMissingColumnError(modernError)) {
    const retryWithoutDeadLetterColumn = await sbAdmin.from('outbox_events').update({ status: 'dead', last_error: currentError, last_attempt_at: now }).eq('id', outboxId);
    modernError = retryWithoutDeadLetterColumn.error || null;
  }
  if (!modernError) return;
  if (!isMissingColumnError(modernError)) throw new Error(`outbox mark terminal failed: ${formatSupabaseError(modernError)}`);
  const { error: legacyError } = await sbAdmin.from('outbox_events').update({ status: 'failed', processed_at: now }).eq('id', outboxId);
  if (legacyError) throw new Error(`outbox mark terminal failed (legacy fallback): ${formatSupabaseError(legacyError)}`);
}

module.exports = { createOutboxEvent, markOutboxSent, markOutboxFailed, markOutboxTerminal };
