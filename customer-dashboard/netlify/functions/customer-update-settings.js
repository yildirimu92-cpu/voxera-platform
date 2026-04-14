const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, { error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return response(400, { error: 'Ungueltiger Request Body' }); }

  const allowed = {};

  if (body.notification_mode != null) {
    const mode = String(body.notification_mode).trim();
    if (!['none', 'callback_only', 'all_calls'].includes(mode)) {
      return response(400, { error: 'notification_mode ungueltig' });
    }
    const legacyByMode = {
      none: { notification_active: false, new_log_email_active: false, missed_call_email_active: false },
      callback_only: { notification_active: true, new_log_email_active: false, missed_call_email_active: true },
      all_calls: { notification_active: true, new_log_email_active: true, missed_call_email_active: true }
    };
    allowed.notification_mode = mode;
    Object.assign(allowed, legacyByMode[mode]);
  }

  if (body.forwarding_setup_completed != null) {
    allowed.forwarding_setup_completed = body.forwarding_setup_completed === true;
  }

  if (body.setup_device_type != null) {
    const deviceType = String(body.setup_device_type).trim().toLowerCase();
    if (!['mobile', 'landline'].includes(deviceType)) {
      return response(400, { error: 'setup_device_type ungueltig' });
    }
    allowed.setup_device_type = deviceType;
  }

  if (body.forwarding_status != null) {
    const forwardingStatus = String(body.forwarding_status).trim().toLowerCase();
    if (!['not_started', 'pending_test', 'active', 'inactive'].includes(forwardingStatus)) {
      return response(400, { error: 'forwarding_status ungueltig. Erlaubte Werte: not_started, pending_test, active, inactive' });
    }
    allowed.forwarding_status = forwardingStatus;
  }

  if ('activation_started_at' in body) {
    if (body.activation_started_at === null) {
      allowed.activation_started_at = null;
    } else {
      const ts = String(body.activation_started_at).trim();
      if (!ts || isNaN(Date.parse(ts))) {
        return response(400, { error: 'activation_started_at ungueltig. Erwartet: ISO 8601 Zeitstempel oder null' });
      }
      allowed.activation_started_at = ts;
    }
  }

  if ('activated_at' in body) {
    if (body.activated_at === null) {
      allowed.activated_at = null;
    } else {
      const ts = String(body.activated_at).trim();
      if (!ts || Number.isNaN(Date.parse(ts))) {
        return response(400, { error: 'activated_at ungueltig. Erwartet: ISO 8601 Zeitstempel oder null' });
      }
      allowed.activated_at = ts;
    }
  }

  if (body.forwarding_mode != null) {
    const forwardingMode = String(body.forwarding_mode).trim().toLowerCase();
    if (!['no_answer', 'unreachable', 'always', 'busy'].includes(forwardingMode)) {
      return response(400, { error: 'forwarding_mode ungueltig. Erlaubte Werte: no_answer, unreachable, always, busy' });
    }
    allowed.forwarding_mode = forwardingMode;
  }

  if ('activation_test_mode' in body) {
    if (body.activation_test_mode === null) {
      allowed.activation_test_mode = null;
    } else {
      const activationTestMode = String(body.activation_test_mode).trim().toLowerCase();
      if (!['system_call', 'manual_call'].includes(activationTestMode)) {
        return response(400, { error: 'activation_test_mode ungueltig. Erlaubte Werte: system_call, manual_call' });
      }
      allowed.activation_test_mode = activationTestMode;
    }
  }

  if ('activation_test_candidate_call_id' in body) {
    if (body.activation_test_candidate_call_id === null) {
      allowed.activation_test_candidate_call_id = null;
    } else {
      const candidateCallId = String(body.activation_test_candidate_call_id).trim();
      if (!candidateCallId) {
        return response(400, { error: 'activation_test_candidate_call_id ungueltig. Erwartet: String oder null' });
      }
      allowed.activation_test_candidate_call_id = candidateCallId;
    }
  }

  if (body.last_confirmed_setup_device_type != null) {
    const deviceType = String(body.last_confirmed_setup_device_type).trim().toLowerCase();
    if (!['mobile', 'landline'].includes(deviceType)) {
      return response(400, { error: 'last_confirmed_setup_device_type ungueltig. Erlaubte Werte: mobile, landline' });
    }
    allowed.last_confirmed_setup_device_type = deviceType;
  }

  if (body.last_confirmed_forwarding_mode != null) {
    const confirmedMode = String(body.last_confirmed_forwarding_mode).trim().toLowerCase();
    if (!['no_answer', 'unreachable', 'always', 'busy'].includes(confirmedMode)) {
      return response(400, { error: 'last_confirmed_forwarding_mode ungueltig. Erlaubte Werte: no_answer, unreachable, always, busy' });
    }
    allowed.last_confirmed_forwarding_mode = confirmedMode;
  }

  // ─── Avatar URL ──────────────────────────────────────────────────────────────
  if (body.avatar_url != null) {
    const url = String(body.avatar_url).trim();
    // Basic URL validation – must start with https://
    if (url && !url.startsWith('https://')) {
      return response(400, { error: 'avatar_url ungueltig. Erwartet: https:// URL' });
    }
    allowed.avatar_url = url || null;
  }

  if (Object.keys(allowed).length === 0) {
    return response(400, { error: 'Keine erlaubten Felder uebergeben' });
  }

  allowed.updated_at = new Date().toISOString();
  const { data, error } = await sbAdmin
    .from('customers')
    .update(allowed)
    .eq('id', caller.customerId)
    .select('*')
    .single();

  if (error) return response(500, { error: 'Customer settings konnten nicht gespeichert werden.', details: error.message });
  return response(200, { success: true, customer: data });
};
