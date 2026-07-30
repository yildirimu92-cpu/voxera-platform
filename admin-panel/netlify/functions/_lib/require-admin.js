'use strict';

const { createClient } = require('@supabase/supabase-js');

const CANONICAL_ADMIN_ROLES = new Set(['owner', 'admin', 'support']);
const ROLE_ALIASES = {
  'super-admin': 'owner',
  superadmin: 'owner',
  ops: 'admin'
};

const ROLE_CAPABILITIES = {
  owner: new Set(['customer:write', 'admin:manage', 'offer:write', 'contract:write', 'billing:write', 'plan:write', 'lifecycle:approve']),
  admin: new Set(['customer:write', 'offer:write', 'contract:write', 'billing:write', 'plan:write', 'lifecycle:approve']),
  support: new Set(['customer:write'])
};

const ACTIVE_ADMIN_STATUSES = new Set(['active']);
const DISABLED_ADMIN_STATUSES = new Set(['disabled', 'revoked']);

function normalizeAdminRole(role) {
  const raw = String(role || '').trim().toLowerCase().replace(/_/g, '-');
  if (!raw) return '';
  return ROLE_ALIASES[raw] || raw;
}

function normalizeAdminStatus(status) {
  const raw = String(status || '').trim().toLowerCase().replace(/_/g, '-');
  if (!raw) return 'active';
  if (raw === 'enabled') return 'active';
  if (raw === 'inactive') return 'disabled';
  return raw;
}

function getBearerToken(headers) {
  const authHeader = headers.authorization || headers.Authorization || '';
  const [scheme, token] = String(authHeader).split(' ');
  if (!/^Bearer$/i.test(scheme || '')) return '';
  return String(token || '').trim();
}

function unauthorized(message = 'Unauthorized') {
  return {
    ok: false,
    statusCode: 401,
    body: { error: message }
  };
}

function forbidden(message = 'Forbidden', extra = {}) {
  return {
    ok: false,
    statusCode: 403,
    body: { error: message, ...extra }
  };
}

function adminGuardError(statusCode, error, errorCode, extra = {}) {
  return {
    ok: false,
    statusCode,
    body: {
      error,
      error_code: errorCode,
      ...extra
    }
  };
}

function hasCapability(role, capability) {
  if (!capability) return true;
  const caps = ROLE_CAPABILITIES[normalizeAdminRole(role)] || new Set();
  return caps.has(capability);
}

function validateAdminAccess({ role, status, requiredCapability }) {
  const normalizedRole = normalizeAdminRole(role);
  const normalizedStatus = normalizeAdminStatus(status);

  if (!CANONICAL_ADMIN_ROLES.has(normalizedRole)) {
    return adminGuardError(403, 'Admin role is invalid', 'admin_invalid_role', {
      expected_roles: Array.from(CANONICAL_ADMIN_ROLES),
      caller_role: normalizedRole || null
    });
  }

  if (DISABLED_ADMIN_STATUSES.has(normalizedStatus) || !ACTIVE_ADMIN_STATUSES.has(normalizedStatus)) {
    return adminGuardError(403, 'Admin account is disabled', 'admin_disabled', {
      caller_status: normalizedStatus || null
    });
  }

  if (requiredCapability && !hasCapability(normalizedRole, requiredCapability)) {
    return forbidden('Insufficient capability', {
      required_capability: requiredCapability,
      caller_role: normalizedRole
    });
  }

  return {
    ok: true,
    role: normalizedRole,
    status: normalizedStatus
  };
}

async function requireAdminCaller({ event, supabaseUrl, supabaseAnonKey, sbAdmin, requiredCapability = '' }) {
  const token = getBearerToken((event && event.headers) || {});
  if (!token) return unauthorized('Missing Bearer token');

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false,
      statusCode: 500,
      body: { error: 'SUPABASE_URL und SUPABASE_ANON_KEY muessen gesetzt sein.' }
    };
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData || !authData.user || !authData.user.id) {
    return unauthorized('Invalid or expired token');
  }

  const userId = authData.user.id;
  const { data: adminRow, error: adminError } = await sbAdmin
    .from('admins')
    .select('id, role, status')
    .eq('id', userId)
    .maybeSingle();

  if (adminError) {
    return adminGuardError(500, 'Admin role lookup failed', 'admin_lookup_query_failed', {
      details: adminError.message,
      hint: adminError.hint || null,
      code: adminError.code || null
    });
  }

  if (!adminRow) {
    return adminGuardError(403, 'Admin access required', 'admin_not_found');
  }

  const access = validateAdminAccess({
    role: adminRow.role,
    status: adminRow.status,
    requiredCapability
  });
  if (!access.ok) return access;

  return {
    ok: true,
    userId,
    role: access.role,
    status: access.status,
    admin: {
      ...adminRow,
      role: access.role,
      status: access.status
    }
  };
}

module.exports = {
  requireAdminCaller,
  CANONICAL_ADMIN_ROLES,
  ROLE_CAPABILITIES,
  ACTIVE_ADMIN_STATUSES,
  DISABLED_ADMIN_STATUSES,
  normalizeAdminRole,
  normalizeAdminStatus,
  hasCapability,
  forbidden,
  adminGuardError
};
