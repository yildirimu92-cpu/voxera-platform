'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requirePromptSyncCaller } = require('./_lib/require-prompt-sync-caller');
const { buildPromptV2 } = require('./_lib/prompt-builder-v2');
const {
  configured: calendarToolProvisioningConfigured,
  ensureWorkspaceTool,
  mergedAgentToolIds,
  calendarPromptBlock
} = require('./_lib/elevenlabs-calendar-tool');
const { ensureAgentPhoneNumber } = require('./_lib/elevenlabs-phone-number');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1/convai/agents';
const AUDIO_TRANSCRIPT_RETENTION_DAYS = 90;

function response(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  };
}

async function loadPromptInputs(sb, customerId, customer) {
  const nowIso = new Date().toISOString();
  const [masterResult, operationalResult, calendarResult] = await Promise.all([
    sb.from('system_config').select('value').eq('key', 'prompt_master_l1').maybeSingle(),
    sb.from('customer_operational_updates')
      .select('id,type,title,message,behavior,starts_at,ends_at,status')
      .eq('customer_id', customerId)
      .eq('status', 'published')
      .gt('ends_at', nowIso)
      .order('starts_at', { ascending: true })
      .limit(20),
    sb.from('calendar_settings').select('*').eq('customer_id', customerId).maybeSingle()
  ]);

  if (masterResult.error) throw masterResult.error;
  if (operationalResult.error) {
    const error = new Error('operational_updates_lookup_failed');
    error.cause = operationalResult.error;
    throw error;
  }
  if (calendarResult.error) throw calendarResult.error;

  let industryPrompt = '';
  if (customer.industry_template_id) {
    const { data, error } = await sb.from('industry_templates')
      .select('prompt_block')
      .eq('id', customer.industry_template_id)
      .maybeSingle();
    if (error) throw error;
    industryPrompt = data?.prompt_block || '';
  }

  let assistantRole = 'die Assistentin';
  if (customer.voice_id) {
    const { data, error } = await sb.from('voxera_voices')
      .select('gender')
      .eq('voice_id', customer.voice_id)
      .maybeSingle();
    if (error) throw error;
    if (data?.gender === 'male') assistantRole = 'der Assistent';
  }

  return {
    masterPrompt: masterResult.data?.value || '',
    operationalUpdates: operationalResult.data || [],
    calendarSettings: calendarResult.data || null,
    industryPrompt,
    assistantRole
  };
}

async function trimSyncLogs(sb, customerId) {
  const { data: allLogs, error } = await sb.from('elevenlabs_sync_log')
    .select('id')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error || !allLogs || allLogs.length <= 10) return;
  await sb.from('elevenlabs_sync_log').delete().in('id', allLogs.slice(10).map((row) => row.id));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return response(405, { error: 'method_not_allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_error) { return response(400, { error: 'invalid_json' }); }

  const {
    customer_id,
    agent_id,
    triggered_by = 'admin_save',
    prev_values = {}
  } = body;
  void prev_values;

  if (!customer_id || !agent_id) {
    return response(400, { error: 'customer_id_and_agent_id_required' });
  }
  if (!ELEVENLABS_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    return response(500, { error: 'missing_environment_configuration' });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const guard = await requirePromptSyncCaller({
    event,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    sbAdmin: sb,
    requestedCustomerId: customer_id
  });
  if (!guard.ok) return response(guard.statusCode, guard.body);

  const { data: customer, error: customerError } = await sb.from('customers')
    .select('*')
    .eq('id', customer_id)
    .maybeSingle();
  if (customerError || !customer) return response(404, { error: 'customer_not_found' });
  if (String(customer.elevenlabs_agent_id || '').trim() && String(customer.elevenlabs_agent_id) !== String(agent_id)) {
    return response(409, { error: 'agent_customer_mapping_mismatch' });
  }

  let fullPrompt = '';
  let compiled = null;
  let syncStatus = 'success';
  let syncError = null;
  let calendarToolId = null;
  let calendarToolStatus = 'not_configured';
  let phoneNumberStatus = 'not_attempted';
  let phoneNumberId = null;
  let phoneNumber = null;

  try {
    const inputs = await loadPromptInputs(sb, customer_id, customer);
    compiled = buildPromptV2({
      customer,
      masterPrompt: inputs.masterPrompt,
      industryPrompt: inputs.industryPrompt,
      assistantRole: inputs.assistantRole,
      operationalUpdates: inputs.operationalUpdates
    });

    const calendarBlock = calendarPromptBlock(inputs.calendarSettings || {});
    fullPrompt = [compiled.prompt, calendarBlock].filter(Boolean).join('\n\n');

    let toolIds;
    if (calendarToolProvisioningConfigured()) {
      calendarToolId = await ensureWorkspaceTool();
      toolIds = await mergedAgentToolIds(agent_id, calendarToolId);
      calendarToolStatus = 'configured';
    } else if (calendarBlock) {
      throw new Error('calendar_tool_provisioning_configuration_missing');
    }

    const promptPatch = { prompt: fullPrompt };
    if (toolIds) promptPatch.tool_ids = toolIds;

    const elRes = await fetch(`${ELEVENLABS_BASE}/${encodeURIComponent(agent_id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        conversation_config: {
          agent: {
            prompt: promptPatch,
            first_message: compiled.firstMessage
          },
          tts: customer.voice_id ? { voice_id: customer.voice_id } : undefined
        },
        platform_settings: {
          privacy: {
            record_voice: true,
            retention_days: AUDIO_TRANSCRIPT_RETENTION_DAYS,
            zero_retention_mode: false
          }
        }
      })
    });

    if (!elRes.ok) {
      const errText = await elRes.text();
      throw new Error(`ElevenLabs ${elRes.status}: ${errText.substring(0, 300)}`);
    }

    const phoneAssignment = await ensureAgentPhoneNumber({
      apiKey: ELEVENLABS_API_KEY,
      agentId: agent_id,
      customer
    });
    phoneNumberStatus = phoneAssignment.status;
    phoneNumberId = phoneAssignment.phone_number_id;
    phoneNumber = phoneAssignment.phone_number;
  } catch (error) {
    syncStatus = 'failed';
    syncError = error?.message || String(error);
  }

  await sb.from('elevenlabs_sync_log').insert({
    customer_id,
    agent_id,
    status: syncStatus,
    triggered_by,
    prompt_snapshot: syncStatus === 'success' ? fullPrompt : null,
    prompt_length: fullPrompt.length,
    error_message: syncError,
    created_at: new Date().toISOString()
  });
  await trimSyncLogs(sb, customer_id);

  await sb.from('customers').update({
    elevenlabs_last_sync_at: new Date().toISOString(),
    elevenlabs_sync_status: syncStatus,
    elevenlabs_sync_error: syncError || null,
    updated_at: new Date().toISOString()
  }).eq('id', customer_id);

  if (syncStatus === 'failed') {
    return response(500, {
      success: false,
      error: syncError,
      calendar_tool_status: calendarToolStatus,
      phone_number_status: phoneNumberStatus,
      phone_number_id: phoneNumberId,
      phone_number: phoneNumber
    });
  }

  return response(200, {
    success: true,
    agent_id,
    promptLength: fullPrompt.length,
    promptVersion: compiled?.version,
    quality: compiled?.quality,
    calendar_tool_status: calendarToolStatus,
    calendar_tool_id: calendarToolId,
    phone_number_status: phoneNumberStatus,
    phone_number_id: phoneNumberId,
    phone_number: phoneNumber
  });
};
