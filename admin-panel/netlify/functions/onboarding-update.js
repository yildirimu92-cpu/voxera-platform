const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const {
  normalizeOnboardingStatus,
  assertOnboardingTransition
} = require('./_lib/status-model');

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
  if (!customerId) return response(400, { error: 'customer_id fehlt' });

  const { data: current, error: currentError } = await sbAdmin
    .from('onboarding')
    .select('*')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (currentError) return response(500, { error: 'Onboarding konnte nicht geladen werden.', details: currentError.message });
  if (!current) return response(404, { error: 'Onboarding nicht gefunden' });

  const patch = { updated_at: new Date().toISOString() };
  if (body.status != null) {
    const fromStatus = normalizeOnboardingStatus(current.status);
    const toStatus = normalizeOnboardingStatus(body.status);
    try {
      assertOnboardingTransition(fromStatus, toStatus);
    } catch (e) {
      return response(409, { error: e.message, from_status: fromStatus, to_status: toStatus });
    }
    patch.status = toStatus;
  }
  if (body.progress != null) {
    const p = Number(body.progress);
    if (!Number.isFinite(p) || p < 0 || p > 100) return response(400, { error: 'progress muss zwischen 0 und 100 liegen' });
    patch.progress = Math.round(p);
  }
  if (body.next_step != null) patch.next_step = String(body.next_step || '').trim() || null;
  if (body.blocker != null) patch.blocker = String(body.blocker || '').trim() || null;
  if (body.owner != null) patch.owner = String(body.owner || '').trim() || null;

  const { data, error } = await sbAdmin
    .from('onboarding')
    .update(patch)
    .eq('id', current.id)
    .select('*')
    .single();

  if (error) return response(500, { error: 'Onboarding konnte nicht aktualisiert werden.', details: error.message });

  // Onboarding and customer lifecycle are intentionally separate.
  // Completing onboarding never promotes a customer to LIVE; only customer-go-live may do that.
  return response(200, { success: true, onboarding: data, customer: null });
};
