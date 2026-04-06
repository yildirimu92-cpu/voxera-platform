const { createClient } = require('@supabase/supabase-js');

function parseBearerToken(headers) {
  const authHeader = headers.authorization || headers.Authorization || '';
  const [scheme, token] = String(authHeader).split(' ');
  if (!/^Bearer$/i.test(scheme || '')) return '';
  return String(token || '').trim();
}

function fail(statusCode, error, details) {
  return { ok: false, statusCode, body: { error, details: details || null } };
}

async function requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin }) {
  const token = parseBearerToken((event && event.headers) || {});
  if (!token) return fail(401, 'Missing Bearer token');

  const authClient = createClient(sbUrl, sbAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData?.user?.id) return fail(401, 'Invalid or expired token');

  const userId = authData.user.id;
  const { data: userRow, error: userError } = await sbAdmin
    .from('users')
    .select('id, customer_id')
    .eq('id', userId)
    .maybeSingle();

  if (userError) return fail(500, 'User lookup failed', userError.message);
  if (!userRow || !userRow.customer_id) return fail(403, 'Customer context missing');

  return {
    ok: true,
    userId,
    customerId: String(userRow.customer_id)
  };
}

module.exports = {
  requireCustomerCaller
};
