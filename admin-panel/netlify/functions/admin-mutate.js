const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller, hasCapability } = require('./_lib/require-admin');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function sanitizePatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return { ...input };
}

function requireCapabilityOrFail(caller, capability) {
  if (hasCapability(caller.role, capability)) return null;
  return response(403, {
    error: 'Insufficient capability',
    required_capability: capability,
    caller_role: caller.role || null
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbServiceKey || !sbAnonKey) {
    return response(500, { error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: 'Ungültiger Request Body.' });
  }

  const action = String(body.action || '').trim();

  try {
    if (action === 'customers.update') {
      const denied = requireCapabilityOrFail(caller, 'customer:write');
      if (denied) return denied;
      const id = String(body.id || '').trim();
      if (!id) return response(400, { error: 'Kunden-ID fehlt.' });
      const patch = sanitizePatch(body.patch);
      const { error } = await sbAdmin.from('customers').update(patch).eq('id', id);
      if (error) return response(400, { error: error.message });
      return response(200, { ok: true });
    }

    if (action === 'admins.create') {
      const denied = requireCapabilityOrFail(caller, 'admin:manage');
      if (denied) return denied;
      const email = String(body.email || '').trim().toLowerCase();
      const role = String(body.role || 'admin').trim();
      if (!email || !email.includes('@')) return response(400, { error: 'Ungültige E-Mail.' });

      const authRes = await sbAdmin.auth.admin.createUser({ email, email_confirm: true });
      if (authRes.error) {
        return response(400, { error: authRes.error.message || 'Auth user create failed.' });
      }
      const userId = authRes.data?.user?.id;
      if (!userId) return response(500, { error: 'Auth user id missing.' });

      const { error } = await sbAdmin
        .from('admins')
        .upsert({ id: userId, email, role, created_at: new Date().toISOString() }, { onConflict: 'id' });
      if (error) return response(400, { error: error.message });
      return response(200, { ok: true, admin: { id: userId, email, role } });
    }

    if (action === 'admins.updateRole') {
      const denied = requireCapabilityOrFail(caller, 'admin:manage');
      if (denied) return denied;
      const adminId = String(body.admin_id || '').trim();
      const role = String(body.role || '').trim();
      if (!adminId || !role) return response(400, { error: 'admin_id und role sind erforderlich.' });
      const { error } = await sbAdmin.from('admins').update({ role }).eq('id', adminId);
      if (error) return response(400, { error: error.message });
      return response(200, { ok: true });
    }

    if (action === 'admins.delete') {
      const denied = requireCapabilityOrFail(caller, 'admin:manage');
      if (denied) return denied;
      const adminId = String(body.admin_id || '').trim();
      if (!adminId) return response(400, { error: 'admin_id ist erforderlich.' });
      if (adminId === caller.userId) return response(400, { error: 'Der aktive Admin kann sich nicht selbst entfernen.' });
      const { error } = await sbAdmin.from('admins').delete().eq('id', adminId);
      if (error) return response(400, { error: error.message });
      return response(200, { ok: true });
    }

    if (action === 'offers.create') {
      const denied = requireCapabilityOrFail(caller, 'offer:write');
      if (denied) return denied;
      const payload = sanitizePatch(body.payload);
      const { data, error } = await sbAdmin.from('offers').insert(payload).select('*').single();
      if (error) return response(400, { error: error.message });
      return response(200, { ok: true, offer: data });
    }

    if (action === 'offers.update') {
      const denied = requireCapabilityOrFail(caller, 'offer:write');
      if (denied) return denied;
      const offerId = String(body.offer_id || '').trim();
      if (!offerId) return response(400, { error: 'offer_id ist erforderlich.' });
      const payload = sanitizePatch(body.payload);
      const { error } = await sbAdmin.from('offers').update(payload).eq('id', offerId);
      if (error) return response(400, { error: error.message });
      return response(200, { ok: true });
    }

    if (action === 'offer-events.create') {
      const denied = requireCapabilityOrFail(caller, 'offer:write');
      if (denied) return denied;
      const payload = sanitizePatch(body.payload);
      const { data, error } = await sbAdmin.from('offer_events').insert(payload).select('*').single();
      if (error) return response(400, { error: error.message });
      return response(200, { ok: true, event: data });
    }

    if (action === 'contracts.create') {
      const denied = requireCapabilityOrFail(caller, 'contract:write');
      if (denied) return denied;
      const payload = sanitizePatch(body.payload);
      const { data, error } = await sbAdmin.from('contracts').insert(payload).select('*').single();
      if (error) return response(400, { error: error.message });
      return response(200, { ok: true, contract: data });
    }

    if (action === 'contracts.update') {
      const denied = requireCapabilityOrFail(caller, 'contract:write');
      if (denied) return denied;
      const contractId = String(body.contract_id || '').trim();
      if (!contractId) return response(400, { error: 'contract_id ist erforderlich.' });
      const payload = sanitizePatch(body.payload);
      const { error } = await sbAdmin.from('contracts').update(payload).eq('id', contractId);
      if (error) return response(400, { error: error.message });
      return response(200, { ok: true });
    }

    if (action === 'plan-config.update') {
      const denied = requireCapabilityOrFail(caller, 'plan:write');
      if (denied) return denied;
      const planId = String(body.plan_id || '').trim();
      if (!planId) return response(400, { error: 'plan_id ist erforderlich.' });
      const payload = sanitizePatch(body.payload);
      const { error } = await sbAdmin.from('plan_config').update(payload).eq('id', planId);
      if (error) return response(400, { error: error.message });
      return response(200, { ok: true });
    }

    return response(400, { error: 'Unsupported action' });
  } catch (err) {
    return response(500, { error: err?.message || 'Unknown server error.' });
  }
};
