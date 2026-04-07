'use strict';

const { createClient } = require('@supabase/supabase-js');
const { markOutboxSent, markOutboxFailed, markOutboxTerminal } = require('./_lib/webhook-outbox');

function log(level, event, payload = {}) {
  console.log(JSON.stringify({ level, event, ...payload }));
}

function intEnv(name, fallback) {
  const raw = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function response(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function computeBackoffSeconds(retryCount, baseDelaySeconds, maxDelaySeconds) {
  const exponential = baseDelaySeconds * (2 ** Math.max(0, Number(retryCount || 0)));
  return Math.min(maxDelaySeconds, exponential);
}

function isRetryDue(row, { baseDelaySeconds, maxDelaySeconds, nowMs }) {
  if (!row || row.status === 'pending') return true;
  const lastAttemptAt = row.last_attempt_at || row.created_at;
  if (!lastAttemptAt) return true;

  const lastAttemptMs = new Date(lastAttemptAt).getTime();
  if (!Number.isFinite(lastAttemptMs)) return true;

  const delaySeconds = computeBackoffSeconds(row.retry_count, baseDelaySeconds, maxDelaySeconds);
  return (lastAttemptMs + (delaySeconds * 1000)) <= nowMs;
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });

  if (!res.ok) {
    return { ok: false, error: `Webhook failed with HTTP ${res.status}` };
  }

  return { ok: true };
}

async function generateRecoveryLink(sbAdmin, email, redirectTo) {
  const { data, error } = await sbAdmin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo }
  });

  const activationLink = data && data.properties ? data.properties.action_link : null;
  if (error || !activationLink) {
    return { ok: false, error: error && error.message ? error.message : 'activation link generation failed' };
  }

  return { ok: true, activationLink };
}

async function markCustomerInviteSent(sbAdmin, customerId) {
  if (!customerId) return;

  const now = new Date().toISOString();
  const { error } = await sbAdmin
    .from('customers')
    .update({
      invite_status: 'sent',
      welcome_sent: true,
      welcome_sent_at: now,
      status: 'invited',
      updated_at: now
    })
    .eq('id', customerId)
    .neq('invite_status', 'activated');

  if (error) {
    log('warn', 'retry_customer_finalize_failed', {
      customer_id: customerId,
      error: error.message || 'unknown error'
    });
  }
}

async function dispatchOutboxEvent(sbAdmin, outboxRow) {
  const payload = outboxRow && outboxRow.payload ? outboxRow.payload : {};

  if (outboxRow.event_type === 'contract_signed_notification') {
    const webhookUrl = process.env.MAKE_CONTRACT_WEBHOOK;
    if (!webhookUrl) return { ok: false, error: 'MAKE_CONTRACT_WEBHOOK not configured' };
    return postJson(webhookUrl, payload);
  }

  if (outboxRow.event_type === 'case_mail_notification') {
    const webhookUrl = process.env.MAKE_CASE_WEBHOOK;
    if (!webhookUrl) return { ok: false, error: 'MAKE_CASE_WEBHOOK not configured' };
    return postJson(webhookUrl, payload);
  }

  if (outboxRow.event_type === 'customer_welcome_access_email' || outboxRow.event_type === 'customer_password_reset_email') {
    const webhookUrl = process.env.MAKE_WELCOME_WEBHOOK;
    if (!webhookUrl) return { ok: false, error: 'MAKE_WELCOME_WEBHOOK not configured' };

    const customerEmail = String(payload.customer_email || '').trim();
    if (!customerEmail) return { ok: false, error: 'customer_email missing in outbox payload' };

    const redirectTo = process.env.ACTIVATE_URL || process.env.DASHBOARD_URL || 'https://dashboard.voxera.ch';
    const link = await generateRecoveryLink(sbAdmin, customerEmail, redirectTo);
    if (!link.ok) return link;

    const webhookPayload = {
      customer_name: payload.customer_name || '',
      email: customerEmail,
      activation_link: link.activationLink,
      plan: payload.plan || null,
      voxera_number: payload.voxera_number || null,
      customer_id: payload.customer_id || null,
      dashboard_url: process.env.DASHBOARD_URL || 'https://dashboard.voxera.ch',
      mail_type: payload.mail_type || (outboxRow.event_type === 'customer_password_reset_email' ? 'password_reset' : 'welcome')
    };

    const sendResult = await postJson(webhookUrl, webhookPayload);
    if (!sendResult.ok) return sendResult;

    if (outboxRow.event_type === 'customer_welcome_access_email') {
      await markCustomerInviteSent(sbAdmin, payload.customer_id);
    }

    return { ok: true };
  }

  return { ok: false, error: `unsupported event_type: ${outboxRow.event_type}` };
}

async function recoverStaleInviteClaims(sbAdmin, timeoutMinutes) {
  const cutoff = new Date(Date.now() - (timeoutMinutes * 60 * 1000)).toISOString();
  const { data, error } = await sbAdmin
    .from('customers')
    .update({ invite_status: 'not_sent', updated_at: new Date().toISOString() })
    .eq('invite_status', 'sending')
    .eq('welcome_sent', false)
    .lt('updated_at', cutoff)
    .select('id');

  if (error) {
    log('warn', 'invite_sending_recovery_failed', { error: error.message || 'unknown error' });
    return 0;
  }

  return Array.isArray(data) ? data.length : 0;
}

exports.handler = async () => {
  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbServiceKey) {
    return response(500, { error: 'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.' });
  }

  const maxRetries = intEnv('OUTBOX_MAX_RETRIES', 5);
  const batchSize = intEnv('OUTBOX_RETRY_BATCH_SIZE', 25);
  const baseDelaySeconds = intEnv('OUTBOX_RETRY_BASE_DELAY_SECONDS', 60);
  const maxDelaySeconds = intEnv('OUTBOX_RETRY_MAX_DELAY_SECONDS', 1800);
  const inviteSendingTimeoutMinutes = intEnv('INVITE_SENDING_TIMEOUT_MINUTES', 15);

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const recoveredInviteClaims = await recoverStaleInviteClaims(sbAdmin, inviteSendingTimeoutMinutes);

  const { data: candidates, error: candidateError } = await sbAdmin
    .from('outbox_events')
    .select('id, event_type, payload, status, retry_count, created_at, last_attempt_at')
    .in('status', ['pending', 'failed'])
    .lt('retry_count', maxRetries)
    .order('created_at', { ascending: true })
    .limit(batchSize * 3);

  if (candidateError) {
    log('error', 'retry_candidates_read_failed', { error: candidateError.message || 'unknown error' });
    return response(500, { error: 'Retry candidates konnten nicht geladen werden.' });
  }

  const nowMs = Date.now();
  const dueCandidates = (Array.isArray(candidates) ? candidates : [])
    .filter((row) => isRetryDue(row, { baseDelaySeconds, maxDelaySeconds, nowMs }))
    .slice(0, batchSize);

  let retried = 0;
  let succeeded = 0;
  let failed = 0;
  let movedToDead = 0;

  for (const candidate of dueCandidates) {
    const claimTs = new Date().toISOString();
    const { data: claimed, error: claimError } = await sbAdmin
      .from('outbox_events')
      .update({ status: 'retrying', last_attempt_at: claimTs })
      .eq('id', candidate.id)
      .eq('status', candidate.status)
      .select('id, event_type, payload, status, retry_count, created_at, last_attempt_at')
      .maybeSingle();

    if (claimError) {
      log('warn', 'retry_claim_failed', { outbox_id: candidate.id, error: claimError.message || 'unknown error' });
      continue;
    }
    if (!claimed) continue;

    retried += 1;
    log('info', 'retry_started', {
      outbox_id: claimed.id,
      event_type: claimed.event_type,
      retry_count: claimed.retry_count,
      previous_status: candidate.status
    });

    const delivery = await dispatchOutboxEvent(sbAdmin, claimed);
    if (delivery.ok) {
      await markOutboxSent(sbAdmin, claimed.id);
      succeeded += 1;
      log('info', 'retry_success', {
        outbox_id: claimed.id,
        event_type: claimed.event_type
      });
      continue;
    }

    const failureMessage = String(delivery.error || 'retry delivery failed');
    await markOutboxFailed(sbAdmin, claimed.id, failureMessage);
    failed += 1;
    log('error', 'retry_failed', {
      outbox_id: claimed.id,
      event_type: claimed.event_type,
      error: failureMessage
    });

    const { data: postFailure } = await sbAdmin
      .from('outbox_events')
      .select('retry_count')
      .eq('id', claimed.id)
      .maybeSingle();

    if (postFailure && Number(postFailure.retry_count || 0) >= maxRetries) {
      await markOutboxTerminal(sbAdmin, claimed.id, `retry limit reached (${maxRetries})`);
      movedToDead += 1;
      log('warn', 'moved_to_terminal_state', {
        outbox_id: claimed.id,
        event_type: claimed.event_type,
        terminal_status: 'dead'
      });
    }
  }

  return response(200, {
    ok: true,
    recovered_invite_sending_claims: recoveredInviteClaims,
    scanned_candidates: Array.isArray(candidates) ? candidates.length : 0,
    due_candidates: dueCandidates.length,
    retried,
    succeeded,
    failed,
    moved_to_dead: movedToDead,
    config: {
      max_retries: maxRetries,
      batch_size: batchSize,
      base_delay_seconds: baseDelaySeconds,
      max_delay_seconds: maxDelaySeconds,
      invite_sending_timeout_minutes: inviteSendingTimeoutMinutes
    }
  });
};
