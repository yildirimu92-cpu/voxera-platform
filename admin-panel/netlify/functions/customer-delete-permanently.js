const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const HARD_DELETE_ALLOWED_ROLES = new Set(['super-admin', 'owner']);

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
  if (!HARD_DELETE_ALLOWED_ROLES.has(String(caller.role || ''))) {
    return response(403, { error: 'Nur owner/super-admin duerfen endgueltig loeschen.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return response(400, { error: 'Ungueltiger Request Body' }); }

  const customerId = String(body.customer_id || '').trim();
  if (!customerId) return response(400, { error: 'customer_id fehlt' });

  const steps = [];
  const { data: userRow, error: userErr } = await sbAdmin
    .from('users')
    .select('id')
    .eq('customer_id', customerId)
    .maybeSingle();
  if (userErr) return response(500, { error: 'User-Lookup fehlgeschlagen', details: userErr.message, steps });
  const authUserId = userRow?.id || null;
  steps.push('lookup_auth_user');

  const deleteByCustomer = async (table) => {
    const { error } = await sbAdmin.from(table).delete().eq('customer_id', customerId);
    if (error) throw new Error(`${table} loeschen fehlgeschlagen: ${error.message}`);
    steps.push(`delete_${table}`);
  };

  try {
    await deleteByCustomer('contracts');

    const { error: clearSubRefErr } = await sbAdmin
      .from('customers')
      .update({ subscription_id: null })
      .eq('id', customerId);
    if (clearSubRefErr) throw new Error(`subscription_id Referenz loesen fehlgeschlagen: ${clearSubRefErr.message}`);
    steps.push('clear_subscription_ref');

    await deleteByCustomer('subscriptions');
    await deleteByCustomer('calls');
    await deleteByCustomer('cases');
    await deleteByCustomer('onboarding');
    await deleteByCustomer('users');

    const { error: customerDeleteErr } = await sbAdmin
      .from('customers')
      .delete()
      .eq('id', customerId);
    if (customerDeleteErr) throw new Error(`customer loeschen fehlgeschlagen: ${customerDeleteErr.message}`);
    steps.push('delete_customer');

    if (authUserId) {
      const { error: authErr } = await sbAdmin.auth.admin.deleteUser(authUserId);
      if (authErr) {
        const msg = String(authErr.message || '').toLowerCase();
        if (authErr.status === 404 || msg.includes('not found') || msg.includes('not_found')) {
          steps.push('delete_auth_user_skipped_not_found');
        } else {
          throw new Error(`auth user loeschen fehlgeschlagen: ${authErr.message}`);
        }
      } else {
        steps.push('delete_auth_user');
      }
    } else {
      steps.push('delete_auth_user_skipped_no_user');
    }
  } catch (error) {
    return response(500, { error: error.message, steps_completed: steps });
  }

  return response(200, { success: true, customer_id: customerId, steps_completed: steps });
};
