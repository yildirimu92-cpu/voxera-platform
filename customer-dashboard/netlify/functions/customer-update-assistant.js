'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const response = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

const FORWARDING_FIELDS = ['ai_forwarding_1_name','ai_forwarding_1_number','ai_forwarding_1_trigger','ai_forwarding_2_name','ai_forwarding_2_number','ai_forwarding_2_trigger','ai_emergency_number'];
const BLOCKED_CUSTOMER_FIELDS = ['ai_instructions', 'ai_fallback_escalation', 'ai_response_constraints'];
const PLAN_TIERS = { starter: 1, business: 2, professional: 3 };

function buildContractPayload(extra) {
  return {
    success: false,
    errors: [],
    blocked_fields: [],
    sync_status: 'skipped_no_sync_fields',
    sync_error: null,
    ...extra
  };
}

function text(value, maxLength) {
  const normalized = String(value ?? '').trim();
  return (maxLength ? normalized.slice(0, maxLength) : normalized) || null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, buildContractPayload({ error: 'Method not allowed' }));

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) return response(500, buildContractPayload({ error: 'supabase_env_missing' }));

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin });
  if (!caller.ok) {
    const callerBody = (caller && caller.body && typeof caller.body === 'object') ? caller.body : {};
    return response(caller.statusCode, buildContractPayload(callerBody));
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return response(400, buildContractPayload({ error: 'invalid_body' })); }

  // Vollständiger Datensatz, damit die Werte vor dem Schreiben als prev_values
  // an den Sync gehen und dort in elevenlabs_sync_log.changed_fields landen.
  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('*')
    .eq('id', caller.customerId)
    .maybeSingle();
  if (customerError || !customer) return response(500, buildContractPayload({ error: 'customer_load_failed' }));

  const planCode = String(customer.plan_code || customer.plan || 'starter').toLowerCase();
  const currentTier = PLAN_TIERS[planCode] || PLAN_TIERS.starter;

  const { data: planCfg, error: planError } = await sbAdmin
    .from('plan_config')
    .select('allow_custom_assistant_name,voice_selection_enabled')
    .eq('id', planCode)
    .maybeSingle();
  if (planError) return response(500, buildContractPayload({ error: 'plan_config_load_failed' }));

  const canEditName = planCfg?.allow_custom_assistant_name === true;
  const canEditVoice = planCfg?.voice_selection_enabled === true;
  const canEditForwarding = planCode === 'professional';

  const {
    voice_id,
    assistant_name,
    ai_business_description,
    ai_services,
    ai_location_hours,
    ai_booking_faq,
    ai_fallback_escalation,
    ai_response_constraints,
    ai_instructions,
    ai_greeting,
    ai_tone,
    ai_address_form,
    ai_forwarding_1_name,
    ai_forwarding_1_number,
    ai_forwarding_1_trigger,
    ai_forwarding_2_name,
    ai_forwarding_2_number,
    ai_forwarding_2_trigger,
    ai_emergency_number,
    notification_mode,
    sms_notify_enabled,
    sms_notify_trigger,
    sms_notify_number,
    sms_caller_enabled,
    sms_caller_trigger,
    sms_caller_template
  } = body;

  const patch = { updated_at: new Date().toISOString() };
  const errors = [];
  const blockedFields = [];

  if (ai_business_description !== undefined) patch.ai_business_description = text(ai_business_description, 6000);
  if (ai_services !== undefined) patch.ai_services = text(ai_services, 6000);
  if (ai_location_hours !== undefined) patch.ai_location_hours = text(ai_location_hours, 6000);
  if (ai_booking_faq !== undefined) patch.ai_booking_faq = text(ai_booking_faq, 6000);

  if (ai_fallback_escalation !== undefined) blockedFields.push('ai_fallback_escalation');
  if (ai_response_constraints !== undefined) blockedFields.push('ai_response_constraints');
  if (ai_instructions !== undefined) blockedFields.push('ai_instructions');
  if (blockedFields.length) errors.push('blocked_customer_fields_present');

  if (ai_greeting !== undefined) patch.ai_greeting = text(ai_greeting, 1000);
  if (ai_tone !== undefined) patch.ai_tone = text(ai_tone, 120);
  if (ai_address_form !== undefined) patch.ai_address_form = text(ai_address_form, 40);

  if (voice_id !== undefined) {
    if (!canEditVoice) {
      return response(403, buildContractPayload({ error: 'voice_not_allowed_on_plan', errors: ['voice_not_allowed_on_plan'] }));
    }
    const requestedVoiceId = String(voice_id || '').trim();
    if (!requestedVoiceId) return response(400, buildContractPayload({ error: 'voice_id_required' }));

    const { data: voice, error: voiceError } = await sbAdmin
      .from('voxera_voices')
      .select('voice_id,available_from_plan')
      .eq('voice_id', requestedVoiceId)
      .eq('is_active', true)
      .maybeSingle();
    if (voiceError) return response(500, buildContractPayload({ error: 'voices_load_failed' }));

    const requiredTier = PLAN_TIERS[String(voice?.available_from_plan || 'starter').toLowerCase()] || PLAN_TIERS.starter;
    if (!voice || requiredTier > currentTier) {
      return response(403, buildContractPayload({ error: 'voice_not_available_on_plan', errors: ['voice_not_available_on_plan'] }));
    }
    patch.voice_id = requestedVoiceId;
  }

  if (assistant_name !== undefined) {
    if (!canEditName) {
      return response(403, buildContractPayload({ error: 'assistant_name_not_allowed_on_plan', errors: ['assistant_name_not_allowed_on_plan'] }));
    }
    patch.assistant_name = text(assistant_name, 40);
  }

  if (notification_mode !== undefined) {
    const validModes = ['none', 'callback_only', 'all_calls'];
    if (validModes.includes(String(notification_mode))) patch.notification_mode = notification_mode;
  }

  if (sms_notify_enabled !== undefined) patch.sms_notify_enabled = Boolean(sms_notify_enabled);
  if (sms_notify_trigger !== undefined) patch.sms_notify_trigger = text(sms_notify_trigger, 80) || 'all';
  if (sms_notify_number !== undefined) patch.sms_notify_number = text(sms_notify_number, 40);
  if (sms_caller_enabled !== undefined) patch.sms_caller_enabled = Boolean(sms_caller_enabled);
  if (sms_caller_trigger !== undefined) patch.sms_caller_trigger = text(sms_caller_trigger, 80) || 'callback_only';
  if (sms_caller_template !== undefined) patch.sms_caller_template = text(sms_caller_template, 1000);

  if (ai_forwarding_1_name !== undefined || ai_forwarding_1_number !== undefined || ai_forwarding_1_trigger !== undefined ||
      ai_forwarding_2_name !== undefined || ai_forwarding_2_number !== undefined || ai_forwarding_2_trigger !== undefined ||
      ai_emergency_number !== undefined) {
    if (!canEditForwarding) {
      errors.push('forwarding_not_allowed_on_plan');
    } else {
      if (ai_forwarding_1_name !== undefined) patch.ai_forwarding_1_name = text(ai_forwarding_1_name, 120);
      if (ai_forwarding_1_number !== undefined) patch.ai_forwarding_1_number = text(ai_forwarding_1_number, 40);
      if (ai_forwarding_1_trigger !== undefined) patch.ai_forwarding_1_trigger = text(ai_forwarding_1_trigger, 500);
      if (ai_forwarding_2_name !== undefined) patch.ai_forwarding_2_name = text(ai_forwarding_2_name, 120);
      if (ai_forwarding_2_number !== undefined) patch.ai_forwarding_2_number = text(ai_forwarding_2_number, 40);
      if (ai_forwarding_2_trigger !== undefined) patch.ai_forwarding_2_trigger = text(ai_forwarding_2_trigger, 500);
      if (ai_emergency_number !== undefined) patch.ai_emergency_number = text(ai_emergency_number, 40) || '144';
    }
  }

  const patchKeys = Object.keys(patch).filter((key) => key !== 'updated_at');
  if (!patchKeys.length) {
    return response(400, buildContractPayload({
      error: 'no_valid_fields',
      errors,
      blocked_fields: blockedFields
    }));
  }

  const { error: dbErr } = await sbAdmin.from('customers').update(patch).eq('id', caller.customerId);
  if (dbErr) return response(500, buildContractPayload({ error: 'update_failed', detail: dbErr.message, errors, blocked_fields: blockedFields }));

  const hasForwardingChange = patchKeys.some((key) => FORWARDING_FIELDS.includes(key));
  const hasNonForwardingChange = patchKeys.some((key) => !FORWARDING_FIELDS.includes(key));
  let syncStatus = 'skipped_no_sync_fields';
  let syncError = null;

  if (hasNonForwardingChange && customer.elevenlabs_agent_id) {
    try {
      const adminUrl = process.env.ADMIN_URL || 'https://admin.voxera.ch';
      const authorization = event.headers?.authorization || event.headers?.Authorization || '';
      const syncRes = await fetch(`${adminUrl}/.netlify/functions/trigger-elevenlabs-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify({
          customer_id: caller.customerId,
          agent_id: customer.elevenlabs_agent_id,
          triggered_by: 'customer_self_edit',
          changed_fields: patchKeys,
          prev_values: patchKeys.reduce((acc, key) => {
            if (Object.prototype.hasOwnProperty.call(customer, key)) acc[key] = customer[key];
            return acc;
          }, {})
        })
      });
      if (!syncRes.ok) {
        syncStatus = 'failed';
        syncError = `sync_http_${syncRes.status}`;
      } else {
        syncStatus = 'success';
      }
    } catch (error) {
      syncStatus = 'failed';
      syncError = error.message || 'sync_failed';
    }
  } else if (hasNonForwardingChange && !customer.elevenlabs_agent_id) {
    syncStatus = 'skipped_no_agent';
  } else if (hasForwardingChange) {
    syncStatus = 'skipped_forwarding_only';
  }

  return response(200, buildContractPayload({
    success: true,
    updated: patchKeys,
    errors,
    blocked_fields: blockedFields,
    sync_status: syncStatus,
    sync_error: syncError
  }));
};
