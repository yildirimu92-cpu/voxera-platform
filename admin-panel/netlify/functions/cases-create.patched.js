const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { createOutboxEvent, markOutboxSent, markOutboxFailed } = require('./_lib/webhook-outbox');
const {
  mapManualTaskUiStatusToDb,
  DB_CASE_STATUS_VALUES,
  isStatusConstraintError
} = require('./_lib/case-status');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

const ALLOWED_MAIL_TEMPLATES = [
  'none',
  'onboarding_started',
  'voxera_number_assigned',
  'forwarding_setup',
  'setup_complete',
  'callback_planned',
  'case_resolved'
];

const MANUAL_TASKS_DB_EXTENSION_MESSAGE = 'Aufgaben konnten in dieser Umgebung noch nicht gespeichert werden, da die Datenbank-Erweiterung noch nicht aktiv ist.';
const MANUAL_TASKS_PRIORITY_INVALID_MESSAGE = 'Die gewählte Priorität ist ungültig. Bitte verwenden Sie „Normal“, „Dringend“ oder keine Priorität.';
const MANUAL_TASKS_STATUS_INVALID_MESSAGE = `Der Status ist ungültig. Erlaubte Werte: ${DB_CASE_STATUS_VALUES.join(', ')}.`;
const DEFAULT_CASE_PRIORITY = 'medium';

function isMissingManualTasksSchema(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  const combined = `${message} ${details} ${hint}`;
  const columnMentioned = /title|note|due_at|phone/.test(combined);
  const relationMentioned = /\bvoxera_cases\b/.test(combined);
  const schemaIssue = /schema cache|column|does not exist|could not find/.test(combined);
  return columnMentioned && relationMentioned && schemaIssue;
}

function isPriorityConstraintError(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  const combined = `${message} ${details} ${hint}`;
  return combined.includes('voxera_cases_priority_check')
    || (/\bvoxera_cases\b/.test(combined) && /priority/.test(combined) && /violates check constraint/.test(combined));
}

function mapPriorityToDb(rawPriority) {
  const key = String(rawPriority || '').trim().toLowerCase();
  if (!key) return DEFAULT_CASE_PRIORITY;
  if (key === 'urgent' || key === 'dringend') return 'high';
  if (key === 'normal') return 'medium';
  if (key === 'high' || key === 'medium' || key === 'low') return key;
  return DEFAULT_CASE_PRIORITY;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, { error: 'Supabase-Konfiguration fehlt.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const caller = await requireAdminCaller({
    event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_e) {
    return response(400, { error: 'Ungültiger Request Body.' });
  }

  const customerId = String(body.customer_id || '').trim();
  // Support both 'title' (new modal) and 'type' (legacy)
  const title = String(body.title || body.type || '').trim();
  const note = String(body.note || body.notes || '').trim();
  const priority = mapPriorityToDb(body.priority);
  const status = mapManualTaskUiStatusToDb(body.status || 'open');
  const mailTemplate = String(body.mail_template || 'none').trim();

  if (!customerId) return response(400, { error: 'customer_id fehlt.' });
  if (!title) return response(400, { error: 'Titel fehlt.' });

  // Validate mail template
  const validTemplate = ALLOWED_MAIL_TEMPLATES.includes(mailTemplate) ? mailTemplate : 'none';

  const now = new Date().toISOString();

  // Try insert with mail_template first, fallback without if column missing
  let data, error;

  const payloadWithTemplate = {
    customer_id: customerId,
    title,
    note: note || null,
    priority,
    status,
    created_at: now,
    updated_at: now,
    ...(validTemplate !== 'none' ? { mail_template: validTemplate } : {})
  };

  ({ data, error } = await sbAdmin
    .from('voxera_cases')
    .insert(payloadWithTemplate)
    .select('*')
    .single());

  // Fallback: if mail_template column doesn't exist yet
  if (error && error.message?.includes('mail_template')) {
    const { title: _t, note: _n, ...payloadFallback } = payloadWithTemplate;
    ({ data, error } = await sbAdmin
      .from('voxera_cases')
      .insert({ customer_id: customerId, title, note: note || null, priority, status, created_at: now, updated_at: now })
      .select('*')
      .single());
  }

  if (error) {
    console.error('Case insert failed', error);
    if (isPriorityConstraintError(error)) {
      return response(400, { error: MANUAL_TASKS_PRIORITY_INVALID_MESSAGE, code: 'cases_priority_invalid' });
    }
    if (isStatusConstraintError(error)) {
      return response(400, {
        error: MANUAL_TASKS_STATUS_INVALID_MESSAGE,
        code: 'cases_status_invalid',
        details: { allowed_statuses: DB_CASE_STATUS_VALUES, received_status: status }
      });
    }
    if (isMissingManualTasksSchema(error)) {
      return response(503, {
        error: MANUAL_TASKS_DB_EXTENSION_MESSAGE,
        code: 'cases_schema_extension_missing'
      });
    }
    return response(500, { error: 'Case konnte nicht erstellt werden.', details: error.message });
  }

  let mailDelivery = null;
  // Trigger Make webhook for mail if template selected
  if (validTemplate !== 'none' && process.env.MAKE_CASE_WEBHOOK) {
    let outboxId = null;
    try {
      const { data: customer } = await sbAdmin
        .from('customers')
        .select('email, customer_name')
        .eq('id', customerId)
        .single();

      const payload = {
        mail_template: validTemplate,
        customer_email: customer?.email,
        customer_name: customer?.customer_name,
        case_title: title,
        case_note: note
      };
      const outbox = await createOutboxEvent(sbAdmin, {
        eventType: 'case_mail_notification',
        payload,
        payloadSummary: `case_mail:${validTemplate} -> ${customer?.email || 'unknown'}`
      });
      outboxId = outbox.id;
      console.log(JSON.stringify({ level: 'info', event: 'webhook_send_attempt', event_type: 'case_mail_notification', outbox_id: outboxId, customer_id: customerId }));

      const webhookRes = await fetch(process.env.MAKE_CASE_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!webhookRes.ok) {
        const errMsg = `Case webhook failed: HTTP ${webhookRes.status}`;
        await markOutboxFailed(sbAdmin, outboxId, errMsg);
        console.error(JSON.stringify({ level: 'error', event: 'webhook_send_failed', event_type: 'case_mail_notification', outbox_id: outboxId, status: webhookRes.status }));
        mailDelivery = { sent: false, outbox_id: outboxId, error: errMsg };
      } else {
        await markOutboxSent(sbAdmin, outboxId);
        console.log(JSON.stringify({ level: 'info', event: 'webhook_send_succeeded', event_type: 'case_mail_notification', outbox_id: outboxId }));
        mailDelivery = { sent: true, outbox_id: outboxId };
      }
    } catch (webhookErr) {
      const errMsg = webhookErr && webhookErr.message ? webhookErr.message : 'Case webhook failed';
      if (outboxId) {
        await markOutboxFailed(sbAdmin, outboxId, errMsg);
      }
      console.warn('Case webhook failed (non-fatal):', errMsg);
      mailDelivery = { sent: false, outbox_id: outboxId, error: errMsg };
    }
  } else if (validTemplate !== 'none') {
    try {
      const outbox = await createOutboxEvent(sbAdmin, {
        eventType: 'case_mail_notification',
        payload: { customer_id: customerId, mail_template: validTemplate, case_title: title },
        payloadSummary: `case_mail:${validTemplate} -> webhook missing`
      });
      await markOutboxFailed(sbAdmin, outbox.id, 'MAKE_CASE_WEBHOOK not configured');
      console.error(JSON.stringify({ level: 'error', event: 'webhook_send_failed', event_type: 'case_mail_notification', outbox_id: outbox.id, reason: 'missing_webhook_env' }));
      mailDelivery = { sent: false, outbox_id: outbox.id, error: 'MAKE_CASE_WEBHOOK not configured' };
    } catch (outboxErr) {
      const msg = outboxErr && outboxErr.message ? outboxErr.message : 'outbox insert failed';
      console.error(JSON.stringify({ level: 'error', event: 'outbox_insert_failed', event_type: 'case_mail_notification', customer_id: customerId, error: msg }));
      mailDelivery = { sent: false, outbox_id: null, error: `Webhook-Outbox Fehler: ${msg}` };
    }
  }

  return response(200, {
    success: true,
    case: data,
    mail_template: validTemplate,
    mail_delivery: mailDelivery
  });
};
