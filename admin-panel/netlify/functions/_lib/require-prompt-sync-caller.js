'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./require-admin');

function bearer(headers) {
  const value = String(headers?.authorization || headers?.Authorization || '').trim();
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function requirePromptSyncCaller({
  event,
  supabaseUrl,
  supabaseAnonKey,
  sbAdmin,
  requestedCustomerId
}) {
  const admin = await requireAdminCaller({
    event,
    supabaseUrl,
    supabaseAnonKey,
    sbAdmin,
    requiredCapability: 'customer:write'
  });
  if (admin.ok) return { ok: true, actorType: 'admin' };

  const token = bearer(event?.headers || {});
  if (!token) return admin;

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  const userId = authData?.user?.id;
  if (authError || !userId) {
    return { ok: false, statusCode: 401, body: { error: 'Invalid or expired token', code: 'auth_token_invalid' } };
  }

  const { data: userRow, error: userError } = await sbAdmin
    .from('users')
    .select('customer_id')
    .eq('id', userId)
    .maybeSingle();
  if (userError) {
    return { ok: false, statusCode: 500, body: { error: 'User lookup failed', code: 'guard_user_lookup_failed' } };
  }

  const customerId = String(userRow?.customer_id || '').trim();
  if (!customerId || customerId !== String(requestedCustomerId || '').trim()) {
    return { ok: false, statusCode: 403, body: { error: 'Customer context mismatch', code: 'guard_customer_mismatch' } };
  }
  return { ok: true, actorType: 'customer', userId, customerId };
}

module.exports = { requirePromptSyncCaller };
