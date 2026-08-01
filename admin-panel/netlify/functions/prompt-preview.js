'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { buildPromptV2 } = require('./_lib/prompt-builder-v2');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return { statusCode:405, body:'Method Not Allowed' };
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode:400, body:JSON.stringify({ error:'invalid_json' }) };
  }
  const customerId = String(body.customer_id || '').trim();
  if (!customerId) return { statusCode:400, body:JSON.stringify({ error:'customer_id_required' }) };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    return { statusCode:500, body:JSON.stringify({ error:'missing_environment' }) };
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth:{ autoRefreshToken:false, persistSession:false } });
  const guard = await requireAdminCaller({
    event,
    supabaseUrl:SUPABASE_URL,
    supabaseAnonKey:SUPABASE_ANON_KEY,
    sbAdmin:sb,
    requiredCapability:'customer:write'
  });
  if (!guard.ok) return { statusCode:guard.statusCode, body:JSON.stringify(guard.body) };

  const { data:customer, error:customerError } = await sb.from('customers').select('*').eq('id', customerId).maybeSingle();
  if (customerError || !customer) return { statusCode:404, body:JSON.stringify({ error:'customer_not_found' }) };

  const { data:masterRow } = await sb.from('system_config').select('value').eq('key', 'prompt_master_l1').maybeSingle();
  let industryPrompt = '';
  if (customer.industry_template_id) {
    const { data:templateRow } = await sb.from('industry_templates').select('prompt_block').eq('id', customer.industry_template_id).maybeSingle();
    industryPrompt = templateRow?.prompt_block || '';
  }
  let assistantRole = 'die Assistentin';
  if (customer.voice_id) {
    const { data:voice } = await sb.from('voxera_voices').select('gender').eq('voice_id', customer.voice_id).maybeSingle();
    if (voice?.gender === 'male') assistantRole = 'der Assistent';
  }

  const compiled = buildPromptV2({
    customer,
    masterPrompt:masterRow?.value || '',
    industryPrompt,
    assistantRole
  });

  return {
    statusCode:200,
    headers:{ 'Content-Type':'application/json', 'Cache-Control':'no-store' },
    body:JSON.stringify({
      success:true,
      customer_id:customerId,
      prompt_version:compiled.version,
      prompt:compiled.prompt,
      first_message:compiled.firstMessage,
      quality:compiled.quality
    })
  };
};
