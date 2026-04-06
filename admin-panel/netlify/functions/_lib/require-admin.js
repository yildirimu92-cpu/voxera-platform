'use strict';

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ADMIN_ROLES = new Set(['super-admin', 'admin', 'support']);

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

function forbidden(message = 'Forbidden') {
  return {
    ok: false,
    statusCode: 403,
    body: { error: message }
  };
}

async function requireAdminCaller({ event, supabaseUrl, supabaseAnonKey, sbAdmin }) {
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
    .select('id, role')
    .eq('id', userId)
    .maybeSingle();

  if (adminError) {
    return {
      ok: false,
      statusCode: 500,
      body: { error: 'Admin role lookup failed', details: adminError.message }
    };
  }

  if (!adminRow) {
    return forbidden('Admin access required');
  }

  const role = String(adminRow.role || '').trim().toLowerCase();
  if (!ALLOWED_ADMIN_ROLES.has(role)) {
    return forbidden('Admin role not allowed for this action');
  }

  return {
    ok: true,
    userId,
    role,
    admin: adminRow
  };
}

module.exports = {
  requireAdminCaller,
  ALLOWED_ADMIN_ROLES
};
