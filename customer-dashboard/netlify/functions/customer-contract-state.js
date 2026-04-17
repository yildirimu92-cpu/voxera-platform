const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function toValidNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizePlanCode(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveContractCommercialValues(contractRow, offerRow, planRow) {
  const contract = contractRow && typeof contractRow === 'object' ? contractRow : {};
  const offer = offerRow && typeof offerRow === 'object' ? offerRow : {};
  const plan = planRow && typeof planRow === 'object' ? planRow : {};

  const monthlyPrice = toValidNumber(
    contract.recurring_amount_monthly
    ?? contract.recurring_amount
    ?? contract.monthly_price
    ?? contract.price_monthly
    ?? contract.price_monthly_chf
    ?? offer.monthly_price
    ?? plan.monthly_price
  );
  const includedMinutes = toValidNumber(
    contract.included_minutes
    ?? contract.plan_minutes_included
    ?? contract.minutes
    ?? offer.included_minutes
    ?? plan.minutes
    ?? plan.included_minutes
  );
  const extraPerMinute = toValidNumber(
    contract.extra_per_minute
    ?? contract.extra_rate
    ?? contract.overage_rate
    ?? offer.extra_per_minute
    ?? plan.extra_rate
    ?? plan.extra_per_minute
  );

  return {
    monthly_price: monthlyPrice,
    included_minutes: includedMinutes,
    extra_per_minute: extraPerMinute
  };
}

async function enrichContractRowsWithCommercials(sbAdmin, rows) {
  const contracts = Array.isArray(rows) ? rows : [];
  if (!contracts.length) return contracts;

  const offerIds = [...new Set(
    contracts
      .map((row) => String(row?.offer_id || '').trim())
      .filter(Boolean)
  )];

  const offersById = new Map();
  if (offerIds.length) {
    const { data: offerRows } = await sbAdmin
      .from('offers')
      .select('id, plan, monthly_price, included_minutes, extra_per_minute')
      .in('id', offerIds);
    (Array.isArray(offerRows) ? offerRows : []).forEach((offer) => {
      offersById.set(String(offer.id), offer);
    });
  }

  const planCodes = [...new Set(
    contracts
      .map((row) => normalizePlanCode(row?.plan || row?.plan_code || offersById.get(String(row?.offer_id || ''))?.plan || ''))
      .filter(Boolean)
  )];
  const plansByCode = new Map();
  if (planCodes.length) {
    const { data: planRows } = await sbAdmin
      .from('plan_config')
      .select('id, monthly_price, minutes, included_minutes, extra_rate, extra_per_minute')
      .in('id', planCodes);
    (Array.isArray(planRows) ? planRows : []).forEach((plan) => {
      plansByCode.set(normalizePlanCode(plan.id), plan);
    });
  }

  return contracts.map((row) => {
    const offer = offersById.get(String(row?.offer_id || '')) || null;
    const planCode = normalizePlanCode(row?.plan || row?.plan_code || offer?.plan || '');
    const plan = plansByCode.get(planCode) || null;
    const commercial = resolveContractCommercialValues(row, offer, plan);
    const resolvedPlan = String(row?.plan || row?.plan_code || offer?.plan || '').trim();
    return {
      ...row,
      ...(resolvedPlan ? { plan: resolvedPlan } : {}),
      ...(commercial.monthly_price != null ? { monthly_price: commercial.monthly_price } : {}),
      ...(commercial.included_minutes != null ? { included_minutes: commercial.included_minutes } : {}),
      ...(commercial.extra_per_minute != null ? { extra_per_minute: commercial.extra_per_minute } : {})
    };
  });
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
  const caller = await requireCustomerCaller({
    event,
    sbUrl,
    sbAnonKey,
    sbAdmin,
    requireActiveContract: false
  });

  if (!caller.ok) return response(caller.statusCode, caller.body);

  const state = caller.contractState || {
    status: 'none',
    hasContract: false,
    hasActiveContract: false,
    latestContract: null,
    effectiveContract: null,
    rows: []
  };

  const contractRows = await enrichContractRowsWithCommercials(sbAdmin, Array.isArray(state.rows) ? state.rows : []);
  const rowsById = new Map(contractRows.map((row) => [String(row?.id || ''), row]));
  const latestContract = state.latestContract ? (rowsById.get(String(state.latestContract.id || '')) || state.latestContract) : null;
  const effectiveContract = state.effectiveContract ? (rowsById.get(String(state.effectiveContract.id || '')) || state.effectiveContract) : null;

  return response(200, {
    success: true,
    customer_id: caller.customerId,
    state: {
      status: state.status || 'none',
      hasContract: state.hasContract === true,
      hasActiveContract: state.hasActiveContract === true,
      latestContract: latestContract || null,
      effectiveContract: effectiveContract || null,
      contracts: contractRows
    }
  });
};
