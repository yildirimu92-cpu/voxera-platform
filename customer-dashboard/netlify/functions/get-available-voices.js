const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Content-Type': 'application/json' };
const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) return response(500, { error: 'supabase_env_missing' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  const { data: customer, error: customerError } = await sbAdmin.from('customers').select('id,plan,plan_code,voice_id').eq('id', caller.customerId).single();
  if (customerError) return response(500, { error: 'customer_load_failed' });
  const planCode = String(customer.plan_code || customer.plan || 'starter').toLowerCase();
  const planTiers = { starter: 1, business: 2, professional: 3 };
  const currentTier = planTiers[planCode] || 1;
  const eligiblePlans = Object.entries(planTiers).filter(([, tier]) => tier <= currentTier).map(([plan]) => plan);
  const { data: voices, error: voicesError } = await sbAdmin.from('voxera_voices').select('voice_id,display_name,description,gender,language,preview_url,is_default,available_from_plan,sort_order').in('available_from_plan', eligiblePlans).eq('is_active', true).order('sort_order', { ascending: true });
  if (voicesError) return response(500, { error: 'voices_load_failed' });

  return response(200, { voices: voices || [], plan_code: planCode, selected_voice_id: customer.voice_id || null });
};
