const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

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
    status: 'open',
    created_at: now,
    updated_at: now,
    ...(validTemplate !== 'none' ? { mail_template: validTemplate } : {})
  };

  ({ data, error } = await sbAdmin
    .from('cases')
    .insert(payloadWithTemplate)
    .select('*')
    .single());

  // Fallback: if mail_template column doesn't exist yet
  if (error && error.message?.includes('mail_template')) {
    const { title: _t, note: _n, ...payloadFallback } = payloadWithTemplate;
    ({ data, error } = await sbAdmin
      .from('cases')
      .insert({ customer_id: customerId, title, note: note || null, status: 'open', created_at: now, updated_at: now })
      .select('*')
      .single());
  }

  if (error) {
    console.error('Case insert failed', error);
    return response(500, { error: 'Case konnte nicht erstellt werden.', details: error.message });
  }

  // Trigger Make webhook for mail if template selected
  if (validTemplate !== 'none' && process.env.MAKE_CASE_WEBHOOK) {
    try {
      const { data: customer } = await sbAdmin
        .from('customers')
        .select('email, customer_name')
        .eq('id', customerId)
        .single();

      await fetch(process.env.MAKE_CASE_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mail_template: validTemplate,
          customer_email: customer?.email,
          customer_name: customer?.customer_name,
          case_title: title,
          case_note: note
        })
      });
    } catch (webhookErr) {
      console.warn('Case webhook failed (non-fatal):', webhookErr.message);
    }
  }

  return response(200, {
    success: true,
    case: data,
    mail_template: validTemplate
  });
};
