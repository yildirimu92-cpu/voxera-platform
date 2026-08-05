'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

const reply = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });
const clean = (value) => String(value == null ? '' : value).trim();

function normalizeE164(value) {
  const raw = clean(value);
  if (!raw || /zuweisung offen|pending|nicht zugewiesen/i.test(raw)) return '';
  const compact = raw.replace(/[\s().-]/g, '');
  if (compact.startsWith('+')) {
    const digits = compact.slice(1).replace(/\D/g, '');
    return digits ? `+${digits}` : '';
  }
  const digits = compact.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+41${digits.slice(1)}`;
  return `+${digits}`;
}

function formatPhone(value) {
  const normalized = normalizeE164(value);
  if (!normalized) return '';
  if (/^\+41\d{9}$/.test(normalized)) {
    return `${normalized.slice(0, 3)} ${normalized.slice(3, 5)} ${normalized.slice(5, 8)} ${normalized.slice(8, 10)} ${normalized.slice(10)}`;
  }
  return normalized;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') return reply(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) return reply(500, { error: 'supabase_env_missing' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin });
  if (!caller.ok) return reply(caller.statusCode, caller.body);

  const { data, error } = await sbAdmin
    .from('customers')
    .select('voxera_number')
    .eq('id', caller.customerId)
    .maybeSingle();

  if (error) return reply(500, { error: 'customer_number_load_failed' });
  if (!data) return reply(404, { error: 'customer_not_found' });

  const normalized = normalizeE164(data.voxera_number);
  return reply(200, {
    assigned: Boolean(normalized),
    phone_number: normalized || null,
    display_phone_number: normalized ? formatPhone(normalized) : 'Noch nicht zugewiesen',
    editable: false
  });
};

exports._test = { normalizeE164, formatPhone };
