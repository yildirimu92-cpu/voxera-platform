'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) return response(500, { error: 'supabase_env_missing' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select([
      'id', 'customer_name', 'plan', 'plan_code', 'assistant_name', 'voice_id',
      'ai_tone', 'ai_address_form', 'ai_business_description', 'ai_services',
      'ai_location_hours', 'ai_booking_faq', 'elevenlabs_agent_id', 'updated_at'
    ].join(','))
    .eq('id', caller.customerId)
    .maybeSingle();

  if (customerError) return response(500, { error: 'customer_load_failed', detail: customerError.message });
  if (!customer) return response(404, { error: 'customer_not_found' });

  const planCode = String(customer.plan_code || customer.plan || 'starter').toLowerCase();
  const { data: planConfig, error: planError } = await sbAdmin
    .from('plan_config')
    .select('allow_custom_assistant_name,voice_selection_enabled')
    .eq('id', planCode)
    .maybeSingle();

  if (planError) return response(500, { error: 'plan_config_load_failed', detail: planError.message });

  const permanentFields = [
    customer.ai_business_description,
    customer.ai_services,
    customer.ai_location_hours,
    customer.ai_booking_faq
  ];
  const completedFields = permanentFields.filter((value) => String(value || '').trim()).length;

  return response(200, {
    assistant: {
      name: customer.assistant_name || null,
      voice_id: customer.voice_id || null,
      tone: customer.ai_tone || null,
      address_form: customer.ai_address_form || null,
      has_agent: Boolean(customer.elevenlabs_agent_id)
    },
    business_profile: {
      company_name: customer.customer_name || null,
      description: customer.ai_business_description || null,
      services: customer.ai_services || null,
      location_hours: customer.ai_location_hours || null,
      booking_faq: customer.ai_booking_faq || null,
      completed_fields: completedFields,
      total_fields: permanentFields.length,
      updated_at: customer.updated_at || null
    },
    permissions: {
      can_change_voice: planConfig?.voice_selection_enabled === true,
      can_change_name: planConfig?.allow_custom_assistant_name === true
    },
    plan_code: planCode
  });
};
