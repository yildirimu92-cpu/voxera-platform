const { createClient } = require('@supabase/supabase-js');
const {
  requireAdminCaller,
  hasCapability,
  CANONICAL_ADMIN_ROLES,
  normalizeAdminRole,
  normalizeAdminStatus
} = require('./_lib/require-admin');
const { executeCommercialCommand } = require('./_lib/commercial-orchestrator');

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

function governanceDenied({ message, code, details = null, meta = null }) {
  return response(409, {
    error: message || 'Governance constraint violation',
    code: code || 'governance_blocked',
    details: details || null,
    meta: meta || null
  });
}

async function hasOtherActiveOwner(sbAdmin, excludedAdminId) {
  const { data, error } = await sbAdmin
    .from('admins')
    .select('id, role, status');
  if (error) throw new Error(error.message || 'Owner lookup failed');
  const excludeId = String(excludedAdminId || '').trim();
  const rows = Array.isArray(data) ? data : [];
  return rows.some((row) => {
    const rowId = String(row?.id || '').trim();
    if (excludeId && rowId && rowId === excludeId) return false;
    return normalizeAdminRole(row?.role) === 'owner' && normalizeAdminStatus(row?.status) === 'active';
  });
}

async function findAuthUserByEmail(sbAdmin, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;

  let page = 1;
  const perPage = 200;
  while (page <= 10) {
    const { data, error } = await sbAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message || 'Auth user list failed');
    const users = Array.isArray(data?.users) ? data.users : [];
    const match = users.find((u) => String(u?.email || '').trim().toLowerCase() === normalizedEmail);
    if (match) return match;
    if (users.length < perPage) break;
    page += 1;
  }
  return null;
}

async function createOrFindAdminAuthUser(sbAdmin, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  const created = await sbAdmin.auth.admin.createUser({
    email: normalizedEmail,
    email_confirm: true,
    app_metadata: { role: 'admin' },
    user_metadata: { source: 'admin_panel_provisioning' }
  });

  if (!created.error && created.data?.user?.id) {
    return {
      user: created.data.user,
      mode: 'created'
    };
  }

  const existing = await findAuthUserByEmail(sbAdmin, normalizedEmail);
  if (existing?.id) {
    return {
      user: existing,
      mode: 'existing'
    };
  }

  throw new Error(created.error?.message || 'Auth user create failed.');
}

function normalizeProvisionedRole(role) {
  const normalized = normalizeAdminRole(role || 'admin');
  if (!CANONICAL_ADMIN_ROLES.has(normalized)) {
    throw new Error('Ungueltige Rolle. Erlaubt: owner, admin, support.');
  }
  return normalized;
}

async function writeAdminAudit(sbAdmin, {
  actorId,
  actorRole,
  targetAdminId,
  action,
  previousRole,
  newRole,
  previousStatus,
  newStatus,
  meta
}) {
  const row = {
    actor_admin_id: actorId || null,
    actor_role: actorRole || null,
    target_admin_id: targetAdminId || null,
    action: action || null,
    previous_role: previousRole || null,
    new_role: newRole || null,
    previous_status: previousStatus || null,
    new_status: newStatus || null,
    meta: meta || null,
    happened_at: new Date().toISOString()
  };

  const { error } = await sbAdmin.from('admin_lifecycle_audit').insert(row);
  if (error) {
    throw new Error(`Audit write failed: ${error.message}`);
  }
}

async function getAdminById(sbAdmin, adminId) {
  const { data, error } = await sbAdmin
    .from('admins')
    .select('id, email, role, status, created_at, disabled_at, updated_at')
    .eq('id', adminId)
    .maybeSingle();

  if (error) throw new Error(error.message || 'Admin lookup failed');
  return data || null;
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
      if (!email || !email.includes('@')) return response(400, { error: 'Ungültige E-Mail.' });
      const role = normalizeProvisionedRole(body.role || 'admin');
      const status = 'active';

      const authUser = await createOrFindAdminAuthUser(sbAdmin, email);
      const userId = authUser.user?.id;
      if (!userId) return response(500, { error: 'Auth user id missing.' });

      const previous = await getAdminById(sbAdmin, userId);

      const { error } = await sbAdmin
        .from('admins')
        .upsert({
          id: userId,
          email,
          role,
          status,
          disabled_at: null,
          updated_at: new Date().toISOString(),
          created_at: previous?.created_at || new Date().toISOString()
        }, { onConflict: 'id' });
      if (error) return response(400, { error: error.message });

      await writeAdminAudit(sbAdmin, {
        actorId: caller.userId,
        actorRole: caller.role,
        targetAdminId: userId,
        action: previous ? 'admin.reprovisioned' : 'admin.created',
        previousRole: normalizeAdminRole(previous?.role || ''),
        newRole: role,
        previousStatus: normalizeAdminStatus(previous?.status || ''),
        newStatus: status,
        meta: { email, auth_mode: authUser.mode }
      });

      return response(200, { ok: true, admin: { id: userId, email, role, status } });
    }

    if (action === 'admins.updateRole') {
      const denied = requireCapabilityOrFail(caller, 'admin:manage');
      if (denied) return denied;

      const adminId = String(body.admin_id || '').trim();
      const role = normalizeProvisionedRole(body.role || '');
      if (!adminId || !role) return response(400, { error: 'admin_id und role sind erforderlich.' });

      const previous = await getAdminById(sbAdmin, adminId);
      if (!previous) return response(404, { error: 'Admin nicht gefunden.' });
      const previousRole = normalizeAdminRole(previous.role);
      const nextRole = normalizeAdminRole(role);

      if (adminId === caller.userId && previousRole === 'owner' && nextRole !== 'owner') {
        return governanceDenied({
          message: 'Owner kann die eigene Rolle nicht herabstufen.',
          code: 'owner_self_downgrade_blocked',
          details: 'self role downgrade from owner is not allowed',
          meta: { admin_id: adminId, previous_role: previousRole, next_role: nextRole }
        });
      }

      if (previousRole === 'owner' && nextRole !== 'owner') {
        const hasOtherOwner = await hasOtherActiveOwner(sbAdmin, adminId);
        if (!hasOtherOwner) {
          return governanceDenied({
            message: 'Die Rolle des letzten aktiven Owner kann nicht entfernt werden.',
            code: 'last_owner_role_removal_blocked',
            details: 'at least one active owner must remain',
            meta: { admin_id: adminId, previous_role: previousRole, next_role: nextRole }
          });
        }
      }

      const { error } = await sbAdmin
        .from('admins')
        .update({ role, updated_at: new Date().toISOString() })
        .eq('id', adminId);
      if (error) return response(400, { error: error.message });

      await writeAdminAudit(sbAdmin, {
        actorId: caller.userId,
        actorRole: caller.role,
        targetAdminId: adminId,
        action: 'admin.role_changed',
        previousRole: normalizeAdminRole(previous.role),
        newRole: role,
        previousStatus: normalizeAdminStatus(previous.status),
        newStatus: normalizeAdminStatus(previous.status),
        meta: { email: previous.email || null }
      });

      return response(200, { ok: true });
    }

    if (action === 'admins.setStatus') {
      const denied = requireCapabilityOrFail(caller, 'admin:manage');
      if (denied) return denied;

      const adminId = String(body.admin_id || '').trim();
      const nextStatus = normalizeAdminStatus(body.status);

      if (!adminId || !nextStatus) return response(400, { error: 'admin_id und status sind erforderlich.' });
      if (!['active', 'disabled'].includes(nextStatus)) {
        return response(400, { error: 'Ungueltiger status. Erlaubt: active, disabled.' });
      }
      if (adminId === caller.userId && nextStatus === 'disabled') {
        return response(400, { error: 'Der aktive Admin kann sich nicht selbst deaktivieren.' });
      }

      const previous = await getAdminById(sbAdmin, adminId);
      if (!previous) return response(404, { error: 'Admin nicht gefunden.' });

      const previousStatus = normalizeAdminStatus(previous.status);
      const previousRole = normalizeAdminRole(previous.role);
      if (previousStatus === nextStatus) {
        return response(200, { ok: true, unchanged: true, status: nextStatus });
      }

      if (previousRole === 'owner' && previousStatus === 'active' && nextStatus === 'disabled') {
        const hasOtherOwner = await hasOtherActiveOwner(sbAdmin, adminId);
        if (!hasOtherOwner) {
          return governanceDenied({
            message: 'Der letzte aktive Owner kann nicht deaktiviert werden.',
            code: 'last_owner_disable_blocked',
            details: 'at least one active owner must remain',
            meta: { admin_id: adminId, previous_role: previousRole, previous_status: previousStatus, next_status: nextStatus }
          });
        }
      }

      const nowIso = new Date().toISOString();
      const patch = {
        status: nextStatus,
        disabled_at: nextStatus === 'disabled' ? nowIso : null,
        updated_at: nowIso
      };

      const { error } = await sbAdmin.from('admins').update(patch).eq('id', adminId);
      if (error) return response(400, { error: error.message });

      await writeAdminAudit(sbAdmin, {
        actorId: caller.userId,
        actorRole: caller.role,
        targetAdminId: adminId,
        action: nextStatus === 'disabled' ? 'admin.disabled' : 'admin.reenabled',
        previousRole: normalizeAdminRole(previous.role),
        newRole: normalizeAdminRole(previous.role),
        previousStatus,
        newStatus: nextStatus,
        meta: { email: previous.email || null }
      });

      return response(200, { ok: true, status: nextStatus });
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
      const result = await executeCommercialCommand({
        sbAdmin,
        actor: { userId: caller.userId, role: caller.role },
        command: 'contracts.create',
        payload
      });
      return response(200, { ok: true, contract: result.contract, read_model: result.read_model });
    }

    if (action === 'contracts.update') {
      const denied = requireCapabilityOrFail(caller, 'contract:write');
      if (denied) return denied;
      const contractId = String(body.contract_id || '').trim();
      if (!contractId) return response(400, { error: 'contract_id ist erforderlich.' });
      const payload = sanitizePatch(body.payload);
      const result = await executeCommercialCommand({
        sbAdmin,
        actor: { userId: caller.userId, role: caller.role },
        command: 'contracts.update',
        payload: { contract_id: contractId, payload }
      });
      return response(200, { ok: true, contract: result.contract, read_model: result.read_model });
    }

    if (['contracts.activate', 'contracts.changePlan', 'contracts.suspend', 'contracts.resume', 'contracts.cancel'].includes(action)) {
      const denied = requireCapabilityOrFail(caller, 'contract:write');
      if (denied) return denied;
      const result = await executeCommercialCommand({
        sbAdmin,
        actor: { userId: caller.userId, role: caller.role },
        command: action,
        payload: sanitizePatch(body.payload || body)
      });
      return response(200, { ok: true, ...result });
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
