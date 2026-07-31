'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

const respond = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });
const compact = (value) => String(value || '').replace(/\s+/g, '').toUpperCase();

function mod97(value) {
  let remainder = 0;
  for (const ch of value) {
    const converted = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of converted) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

function validIban(raw) {
  const iban = compact(raw);
  if (!/^CH\d{19}$/.test(iban)) return false;
  return mod97(iban.slice(4) + iban.slice(0, 4)) === 1;
}

function isQrIban(raw) {
  const iban = compact(raw);
  if (!validIban(iban)) return false;
  const iid = Number(iban.slice(4, 9));
  return iid >= 30000 && iid <= 31999;
}

function normalize(body) {
  const iban = compact(body.iban);
  const qrIban = compact(body.qr_iban);
  const referenceType = String(body.reference_type || 'NON').toUpperCase();
  return {
    id: body.id || null,
    account_name: String(body.account_name || 'Voxera CHF').trim(),
    creditor_name: String(body.creditor_name || '').trim(),
    creditor_street: String(body.creditor_street || '').trim(),
    creditor_house_number: String(body.creditor_house_number || '').trim() || null,
    creditor_postal_code: String(body.creditor_postal_code || '').trim(),
    creditor_city: String(body.creditor_city || '').trim(),
    creditor_country: String(body.creditor_country || 'CH').trim().toUpperCase(),
    bank_name: String(body.bank_name || '').trim() || null,
    iban,
    qr_iban: qrIban || null,
    bic: compact(body.bic) || null,
    currency: String(body.currency || 'CHF').trim().toUpperCase(),
    reference_type: referenceType,
    payment_terms_days: Math.max(0, Math.min(365, Math.trunc(Number(body.payment_terms_days || 30)))),
    billing_email: String(body.billing_email || '').trim() || null,
    vat_number: String(body.vat_number || '').trim() || null,
    default_message: String(body.default_message || '').trim() || null,
    qr_enabled: body.qr_enabled !== false,
    stripe_link_enabled: body.stripe_link_enabled === true,
    is_default: body.is_default !== false,
    is_active: body.is_active !== false
  };
}

function validate(row) {
  const missing = ['creditor_name','creditor_street','creditor_postal_code','creditor_city','iban']
    .filter((key) => !row[key]);
  if (missing.length) return `Pflichtfelder fehlen: ${missing.join(', ')}`;
  if (!validIban(row.iban)) return 'Die IBAN ist ungültig.';
  if (!['CHF','EUR'].includes(row.currency)) return 'Ungültige Währung.';
  if (!['QRR','SCOR','NON'].includes(row.reference_type)) return 'Ungültige Referenzart.';
  if (row.reference_type === 'QRR') {
    if (!row.qr_iban) return 'Für QR-Referenzen ist eine QR-IBAN erforderlich.';
    if (!isQrIban(row.qr_iban)) return 'Die angegebene QR-IBAN ist keine gültige Schweizer QR-IBAN.';
  }
  if (row.reference_type !== 'QRR' && row.qr_iban && !isQrIban(row.qr_iban)) {
    return 'Die angegebene QR-IBAN ist ungültig.';
  }
  if (row.reference_type === 'SCOR' && isQrIban(row.iban)) {
    return 'SCOR muss mit einer normalen IBAN verwendet werden.';
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (!['GET','POST'].includes(event.httpMethod)) return respond(405, { error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) return respond(500, { error: 'Supabase-Konfiguration fehlt.' });

  const sbAdmin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireAdminCaller({ event, supabaseUrl: url, supabaseAnonKey: anonKey, sbAdmin });
  if (!caller.ok) return respond(caller.statusCode, caller.body);

  if (event.httpMethod === 'GET') {
    const { data, error } = await sbAdmin
      .from('payment_accounts')
      .select('*')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) return respond(500, { error: error.message });
    return respond(200, { success: true, accounts: data || [] });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return respond(400, { error: 'Ungültiger Request Body.' }); }
  const row = normalize(body);
  const validationError = validate(row);
  if (validationError) return respond(400, { error: validationError });

  const now = new Date().toISOString();
  if (row.is_default) {
    const { error: clearError } = await sbAdmin
      .from('payment_accounts')
      .update({ is_default: false, updated_at: now, updated_by: caller.userId })
      .eq('currency', row.currency)
      .neq('id', row.id || '00000000-0000-0000-0000-000000000000');
    if (clearError) return respond(500, { error: clearError.message });
  }

  const payload = { ...row, updated_at: now, updated_by: caller.userId };
  delete payload.id;
  let result;
  if (row.id) {
    result = await sbAdmin.from('payment_accounts').update(payload).eq('id', row.id).select('*').single();
  } else {
    payload.created_at = now;
    payload.created_by = caller.userId;
    result = await sbAdmin.from('payment_accounts').insert(payload).select('*').single();
  }
  if (result.error) return respond(500, { error: result.error.message });

  await sbAdmin.from('commercial_lifecycle_audit').insert({
    actor_admin_id: caller.userId,
    actor_role: caller.role,
    action: row.id ? 'payment_account.update' : 'payment_account.create',
    metadata: {
      payment_account_id: result.data.id,
      currency: result.data.currency,
      reference_type: result.data.reference_type,
      is_default: result.data.is_default
    },
    happened_at: now
  });

  return respond(200, { success: true, account: result.data });
};
