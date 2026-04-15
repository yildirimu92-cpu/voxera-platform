const { createClient } = require('@supabase/supabase-js');
const { evaluateCustomerEntitlement } = require('./customer-entitlement');
const { deriveContractState } = require('./contract-state');

function parseBearerToken(headers) {
  const authHeader = headers.authorization || headers.Authorization || '';
  const [scheme, token] = String(authHeader).split(' ');
  if (!/^Bearer$/i.test(scheme || '')) return '';
  return String(token || '').trim();
}

function fail(statusCode, error, details) {
  return { ok: false, statusCode, body: { error, details: details || null } };
}

async function requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin, requireActiveContract = true }) {
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

  const customerId = String(userRow.customer_id);
  const { data: customerRow, error: customerError } = await sbAdmin
    .from('customers')
    .select('id, status')
    .eq('id', customerId)
    .maybeSingle();

  if (customerError) return fail(500, 'Customer lookup failed', customerError.message);
  if (!customerRow) return fail(403, 'Customer record missing');

  const entitlement = evaluateCustomerEntitlement(customerRow);
  if (!entitlement.entitled) {
    return fail(403, 'Customer entitlement denied', {
      reason: entitlement.code,
      message: entitlement.message,
      customer_status: entitlement.customer_status
    });
  }

  const { data: contractRows, error: contractError } = await sbAdmin
    .from('contracts')
    .select('*')
    .eq('customer_id', customerId)
    .limit(50);
  if (contractError) return fail(500, 'Contract lookup failed', contractError.message);

  const contractState = deriveContractState(contractRows || []);
  if (requireActiveContract && !contractState.hasActiveContract) {
    return fail(403, 'Customer entitlement denied', {
      reason: 'contract_inactive',
      message: 'Zugriff gesperrt: Kein aktiver Vertrag vorhanden.',
      contract_status: contractState.status
    });
  }

  return {
    ok: true,
    userId,
    customerId,
    contractState
  };
}

module.exports = {
  requireCustomerCaller
};
