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
  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin, requireActiveContract: true, functionName: 'customer-cancel-contract' });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return response(400, { error: 'Ungueltiger Request Body' }); }

  const action = String((body && body.action) || '').trim().toLowerCase();
  if (!['cancel', 'reactivate'].includes(action)) return response(400, { error: 'action muss cancel oder reactivate sein' });

  const activeContract = (caller.contractState && caller.contractState.effectiveContract) || null;
  if (!activeContract || !activeContract.id || String(activeContract.status || '').toLowerCase() !== 'active') {
    return response(409, { error: 'Kein aktiver Vertrag gefunden.' });
  }

  const updatePayload = {};
  if (action === 'cancel') {
    const reason = String((body && body.termination_reason) || '').trim();
    if (!reason) return response(400, { error: 'termination_reason ist erforderlich.' });
    const noticeMatch = String(activeContract.cancellation_notice || '').match(/(\d+)/);
    const noticeDays = noticeMatch ? Math.max(0, Number(noticeMatch[1])) : 30;
    const cancellationDate = new Date(Date.now() + (noticeDays || 30) * 24 * 60 * 60 * 1000);
    updatePayload.cancellation_date = cancellationDate.toISOString();
    updatePayload.termination_reason = reason;
    updatePayload.termination_type = 'customer_request';
  } else {
    updatePayload.cancellation_date = null;
    updatePayload.termination_reason = null;
    updatePayload.termination_type = null;
  }

  const { error: updateError } = await sbAdmin
    .from('contracts')
    .update(updatePayload)
    .eq('id', activeContract.id)
    .eq('customer_id', caller.customerId)
    .eq('status', 'active');

  if (updateError) return response(500, { error: 'Vertrag konnte nicht aktualisiert werden.' });

  return response(200, { success: true, action });
};
