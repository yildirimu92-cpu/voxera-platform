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

  const callId = String(body.call_id || '').trim();
  if (!callId) return response(400, { error: 'call_id fehlt' });

  const { data: callRow, error: callError } = await sbAdmin
    .from('calls')
    .select('id, customer_id')
    .eq('id', callId)
    .maybeSingle();
  if (callError) return response(500, { error: 'Call lookup failed', details: callError.message });
  if (!callRow) return response(404, { error: 'Call nicht gefunden' });
  if (String(callRow.customer_id) !== caller.customerId) return response(403, { error: 'Call gehoert nicht zum Customer-Kontext' });

  const patch = {
    updated_at: new Date().toISOString(),
    notes_customer_voxera: body.notes_customer_voxera != null ? String(body.notes_customer_voxera).trim() || null : undefined,
    next_action: body.next_action != null ? String(body.next_action).trim() || null : undefined,
    follow_up_at: body.follow_up_at != null ? (String(body.follow_up_at).trim() || null) : undefined
  };

  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
  if (Object.keys(patch).length === 1 && patch.updated_at) return response(400, { error: 'Keine erlaubten Aenderungen uebergeben' });

  const { data, error } = await sbAdmin
    .from('calls')
    .update(patch)
    .eq('id', callId)
    .eq('customer_id', caller.customerId)
    .select('*')
    .single();

  if (error) return response(500, { error: 'Follow-up konnte nicht gespeichert werden.', details: error.message });
  return response(200, { success: true, call: data });
};
