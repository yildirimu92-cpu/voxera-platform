// trigger-elevenlabs-sync.js
// Admin Portal Netlify Function — proxied ElevenLabs sync
// Vermeidet CORS Problem zwischen admin.voxera.ch und dashboard.voxera.ch

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { buildPromptV2 } = require('./_lib/prompt-builder-v2');

const ELEVENLABS_API_KEY   = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY;
const ELEVENLABS_BASE      = 'https://api.elevenlabs.io/v1/convai/agents';
const AUDIO_TRANSCRIPT_RETENTION_DAYS = 90;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { customer_id, agent_id, triggered_by = 'admin_save', prev_values = {} } = body;
  if (!customer_id || !agent_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'customer_id and agent_id required' }) };
  }

  if (!ELEVENLABS_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const guard = await requireAdminCaller({
    event,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    sbAdmin: sb,
    requiredCapability: 'customer:write'
  });
  if (!guard.ok) {
    return { statusCode: guard.statusCode, body: JSON.stringify(guard.body) };
  }

  // Lade Kundendaten
  const { data: customer, error: custErr } = await sb
    .from('customers').select('*').eq('id', customer_id).maybeSingle();

  if (custErr || !customer) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Customer not found' }) };
  }

  // Prompt Builder V2: one deterministic compiler for preview, provisioning and sync.
  const { data: l1Row } = await sb.from('system_config').select('value')
    .eq('key', 'prompt_master_l1').maybeSingle();

  let industryPrompt = '';
  if (customer.industry_template_id) {
    const { data: tplRow } = await sb.from('industry_templates')
      .select('prompt_block').eq('id', customer.industry_template_id).maybeSingle();
    industryPrompt = tplRow?.prompt_block || '';
  }

  let assistantRole = 'die Assistentin';
  if (customer.voice_id) {
    const { data: voiceRow } = await sb.from('voxera_voices')
      .select('gender').eq('voice_id', customer.voice_id).maybeSingle();
    if (voiceRow?.gender === 'male') assistantRole = 'der Assistent';
  }

  const compiled = buildPromptV2({
    customer,
    masterPrompt: l1Row?.value || '',
    industryPrompt,
    assistantRole
  });
  const fullPrompt = compiled.prompt;
  const autoGreeting = compiled.firstMessage;

  // Push zu ElevenLabs
  let syncStatus = 'success';
  let syncError  = null;

  try {
    const elRes = await fetch(`${ELEVENLABS_BASE}/${agent_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': ELEVENLABS_API_KEY },
      body: JSON.stringify({
        conversation_config: {
          agent: {
            prompt: { prompt: fullPrompt },
            first_message: autoGreeting
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
      throw new Error(`ElevenLabs ${elRes.status}: ${errText.substring(0, 200)}`);
    }
  } catch(e) {
    syncStatus = 'failed';
    syncError  = e.message;
  }

  // Log schreiben
  await sb.from('elevenlabs_sync_log').insert({
    customer_id, agent_id,
    status: syncStatus, triggered_by,
    prompt_snapshot: syncStatus === 'success' ? fullPrompt : null,
    prompt_length: fullPrompt.length,
    error_message: syncError,
    created_at: new Date().toISOString()
  });

  // Max 10 Logs
  const { data: allLogs } = await sb.from('elevenlabs_sync_log')
    .select('id').eq('customer_id', customer_id)
    .order('created_at', { ascending: false });
  if (allLogs && allLogs.length > 10) {
    await sb.from('elevenlabs_sync_log').delete().in('id', allLogs.slice(10).map(r => r.id));
  }

  // Customer aktualisieren
  await sb.from('customers').update({
    elevenlabs_last_sync_at: new Date().toISOString(),
    elevenlabs_sync_status: syncStatus,
    elevenlabs_sync_error: syncError || null,
    updated_at: new Date().toISOString()
  }).eq('id', customer_id);

  if (syncStatus === 'failed') {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: syncError }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, agent_id, promptLength: fullPrompt.length, promptVersion: compiled.version, quality: compiled.quality })
  };
};

function buildGreeting(name, type, personName, firmName, lang) {
  // Gesprochener Name: Einzelperson/Berater = personName, Firma = firmName
  const spokenName = (type === 'company') ? firmName : (personName || firmName);

  if (lang === 'fr') {
    if (type === 'company')    return `Bonjour, ici ${name} de ${spokenName}. Cet appel est enregistré. Comment puis-je vous aider?`;
    if (type === 'consultant') return `Bonjour, ici ${name}, l'assistante de ${spokenName} chez ${firmName}. Cet appel est enregistré. Comment puis-je vous aider?`;
    return `Bonjour, ici ${name}, l'assistante de ${spokenName}. Cet appel est enregistré. Comment puis-je vous aider?`;
  }
  if (lang === 'it') {
    if (type === 'company')    return `Buongiorno, sono ${name} di ${spokenName}. La chiamata viene registrata. Come posso aiutarla?`;
    if (type === 'consultant') return `Buongiorno, sono ${name}, l'assistente di ${spokenName} presso ${firmName}. La chiamata viene registrata. Come posso aiutarla?`;
    return `Buongiorno, sono ${name}, l'assistente di ${spokenName}. La chiamata viene registrata. Come posso aiutarla?`;
  }
  if (lang === 'en') {
    if (type === 'company')    return `Hello, this is ${name} from ${spokenName}. This call is being recorded. How may I help you?`;
    if (type === 'consultant') return `Hello, this is ${name}, assistant to ${spokenName} at ${firmName}. This call is being recorded. How may I help you?`;
    return `Hello, this is ${name}, assistant to ${spokenName}. This call is being recorded. How may I help you?`;
  }
  if (type === 'company')    return `Grüezi, hier ist ${name} von ${spokenName}. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?`;
  if (type === 'consultant') return `Grüezi, hier ist ${name}, die Assistentin von ${spokenName} bei ${firmName}. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?`;
  return `Grüezi, hier ist ${name}, die Assistentin von ${spokenName}. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?`;
}

