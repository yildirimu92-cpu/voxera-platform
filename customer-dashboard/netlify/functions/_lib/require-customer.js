const { createClient } = require('@supabase/supabase-js');
const { deriveContractState } = require('./contract-state');

function parseBearerToken(headers) {
  const authHeader = headers.authorization || headers.Authorization || '';
  const [scheme, token] = String(authHeader).split(' ');
  if (!/^Bearer$/i.test(scheme || '')) return '';
  return String(token || '').trim();
}

function fail(statusCode, error, code, details) {
  return { ok: false, statusCode, body: { error, code, details: details || null } };
}

function toErrorLogDetails(err) {
  if (!err) return null;
  return {
    name: err.name || '',
    message: err.message || String(err),
    status: err.status || err.statusCode || null,
    code: err.code || null,
    details: err.details || null
  };
}

async function requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin, requireActiveContract = true, functionName = '' }) {
  const requestHeaders = (event && event.headers) || {};
  const authHeader = requestHeaders.authorization || requestHeaders.Authorization || '';
  const token = parseBearerToken(requestHeaders);
  if (!token) {
    console.error('[require-customer] auth_token_missing', {
      functionName,
      hasAuthorizationHeader: !!String(authHeader || '').trim()
    });
    return fail(401, 'Missing Bearer token', 'auth_token_missing', {
      functionName,
      hasAuthorizationHeader: !!String(authHeader || '').trim(),
      hasAccessToken: false
    });
  }

  const authClient = createClient(sbUrl, sbAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData?.user?.id) {
    const authDetails = toErrorLogDetails(authError);
    console.error('[require-customer] auth_token_invalid', {
      functionName,
      hasAuthorizationHeader: !!String(authHeader || '').trim(),
      hasAccessToken: !!token,
      authError: authDetails
    });
    return fail(401, 'Invalid or expired token', 'auth_token_invalid', {
      functionName,
      hasAuthorizationHeader: !!String(authHeader || '').trim(),
      hasAccessToken: !!token,
      authError: authDetails
    });
  }

  const userId = authData.user.id;
  const { data: userRow, error: userError } = await sbAdmin
    .from('users')
    .select('id, customer_id')
    .eq('id', userId)
    .maybeSingle();

  if (userError) return fail(500, 'User lookup failed', 'guard_user_lookup_failed', userError.message);
  if (!userRow || !userRow.customer_id) return fail(403, 'Customer context missing', 'guard_customer_context_missing');

  const customerId = String(userRow.customer_id);
  const { data: customerRow, error: customerError } = await sbAdmin
    .from('customers')
    .select('id, status, subscription_id')
    .eq('id', customerId)
    .maybeSingle();

  if (customerError) return fail(500, 'Customer lookup failed', 'guard_customer_lookup_failed', customerError.message);
  if (!customerRow) return fail(403, 'Customer record missing', 'guard_customer_missing');

  let contractQuery = sbAdmin
    .from('contracts')
    .select('*')
    .limit(50);

  const subscriptionId = customerRow.subscription_id ? String(customerRow.subscription_id).trim() : '';
  if (subscriptionId) {
    contractQuery = contractQuery.or(`customer_id.eq.${customerId},subscription_id.eq.${subscriptionId}`);
  } else {
    contractQuery = contractQuery.eq('customer_id', customerId);
  }

  const { data: contractRows, error: contractError } = await contractQuery;
  if (contractError) return fail(500, 'Contract lookup failed', 'guard_contract_lookup_failed', contractError.message);

  const contractState = deriveContractState(contractRows || []);
  if (requireActiveContract && !contractState.hasActiveContract) {
    return fail(409, 'Customer entitlement denied', 'guard_contract_inactive', {
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
