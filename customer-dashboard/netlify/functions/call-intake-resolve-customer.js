'use strict';

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { normalizePhoneE164 } = require('./_lib/phone-normalize');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Call-Intake-Secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function respond(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function trimOrNull(value) {
  const normalized = String(value == null ? '' : value).trim();
  return normalized || null;
}

async function resolveCustomerByNumber(sbAdmin, rawNumber) {
  const normalizedInput = normalizePhoneE164(rawNumber).normalized;
  if (!normalizedInput) return { customer: null, normalizedInput: null, strategy: null };

  const columns = 'id, customer_name, contact_name, email, voxera_number, notification_active, notification_mode, new_log_email_active, missed_call_email_active';
  const exact = await sbAdmin
    .from('customers')
    .select(columns)
    .eq('voxera_number', normalizedInput)
    .maybeSingle();

  if (exact.error) throw exact.error;
  if (exact.data) return { customer: exact.data, normalizedInput, strategy: 'exact_normalized' };

  const candidates = await sbAdmin
    .from('customers')
    .select(columns)
    .not('voxera_number', 'is', null)
    .limit(5000);

  if (candidates.error) throw candidates.error;

  const matches = (candidates.data || []).filter(row => {
    return normalizePhoneE164(row.voxera_number).normalized === normalizedInput;
  });

  if (matches.length > 1) {
    const error = new Error('Mehrere Kunden verwenden dieselbe normalisierte Voxera-Nummer.');
    error.code = 'AMBIGUOUS_NUMBER';
    throw error;
  }

  return {
    customer: matches[0] || null,
    normalizedInput,
    strategy: matches[0] ? 'normalized_scan' : null
  };
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  const configuredSecret = process.env.CALL_INTAKE_RESOLVER_SECRET || '';
  const suppliedSecret = event.headers?.['x-call-intake-secret']
    || event.headers?.['X-Call-Intake-Secret']
    || '';

  if (!configuredSecret) {
    return respond(500, { error: 'CALL_INTAKE_RESOLVER_SECRET ist nicht konfiguriert.' });
  }
  if (!safeEqual(configuredSecret, suppliedSecret)) {
    return respond(401, { error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return respond(500, { error: 'Supabase-Konfiguration fehlt.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_error) {
    return respond(400, { error: 'Ungültiger Request Body.' });
  }

  const calledNumber = trimOrNull(body.called_number || body.voxera_number);
  if (!calledNumber) return respond(400, { error: 'called_number fehlt.' });

  const sbAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    const resolved = await resolveCustomerByNumber(sbAdmin, calledNumber);
    if (!resolved.customer) {
      return respond(404, {
        resolved: false,
        called_number: calledNumber,
        normalized_called_number: resolved.normalizedInput
      });
    }

    const customer = resolved.customer;
    return respond(200, {
      resolved: true,
      strategy: resolved.strategy,
      normalized_called_number: resolved.normalizedInput,
      customer_id: customer.id,
      customer_name: customer.customer_name || null,
      contact_name: customer.contact_name || null,
      customer_email: customer.email || null,
      notification_active: customer.notification_active === true,
      notification_mode: customer.notification_mode || 'none',
      new_log_email_active: customer.new_log_email_active === true,
      missed_call_email_active: customer.missed_call_email_active === true
    });
  } catch (error) {
    const isAmbiguous = error?.code === 'AMBIGUOUS_NUMBER';
    console.error(JSON.stringify({
      level: 'error',
      event: 'call_intake_customer_resolve_failed',
      called_number: calledNumber,
      error_code: error?.code || null,
      error_message: error?.message || String(error)
    }));
    return respond(isAmbiguous ? 409 : 500, {
      error: isAmbiguous ? 'Voxera-Nummer ist mehreren Kunden zugeordnet.' : 'Customer resolution failed.'
    });
  }
};
