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
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return response(400, { error: 'Ungueltiger Request Body' }); }

  const customerId = String(body.customer_id || '').trim();
  const action = String(body.action || '').trim().toLowerCase();
  if (!customerId) return response(400, { error: 'customer_id fehlt' });
  if (!['send_payment_link', 'mark_paid'].includes(action)) {
    return response(400, { error: 'Unbekannte action. Erlaubt: send_payment_link, mark_paid' });
  }

  const nowIso = new Date().toISOString();

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();

  if (customerError) return response(500, { error: 'Customer lookup failed', details: customerError.message });
  if (!customer) return response(404, { error: 'Customer nicht gefunden' });

  const nextPatch = { updated_at: nowIso };

  if (action === 'send_payment_link') {
    const paymentLink = String(body.payment_link || customer.payment_link || '').trim();
    if (!paymentLink) {
      return response(400, { error: 'payment_link fehlt. Bitte zuerst einen Zahlungslink hinterlegen.' });
    }

    if (!/^https?:\/\//i.test(paymentLink)) {
      return response(400, { error: 'payment_link muss mit http:// oder https:// beginnen.' });
    }

    nextPatch.payment_link = paymentLink;
    nextPatch.payment_status = 'pending';
    nextPatch.payment_sent_at = nowIso;
    nextPatch.payment_received_at = null;

    if (body.setup_fee_amount !== undefined && body.setup_fee_amount !== null && String(body.setup_fee_amount).trim() !== '') {
      const amount = Number(body.setup_fee_amount);
      if (!Number.isFinite(amount) || amount < 0) {
        return response(400, { error: 'setup_fee_amount muss eine nicht-negative Zahl sein.' });
      }
      nextPatch.setup_fee_amount = amount;
    }
  }

  if (action === 'mark_paid') {
    nextPatch.payment_status = 'paid';
    nextPatch.payment_received_at = nowIso;
    if (!customer.payment_sent_at) nextPatch.payment_sent_at = nowIso;
  }

  const { data: updated, error: updateErr } = await sbAdmin
    .from('customers')
    .update(nextPatch)
    .eq('id', customerId)
    .select('*')
    .single();

  if (updateErr) {
    return response(500, { error: 'Billing-Status konnte nicht gespeichert werden.', details: updateErr.message });
  }

  return response(200, {
    success: true,
    action,
    customer: updated
  });
};
