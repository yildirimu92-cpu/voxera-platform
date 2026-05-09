const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { customer_id, triggered_by = 'admin_manual' } = body;

  if (!customer_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'customer_id required' }) };
  }

  if (!ELEVENLABS_API_KEY || !process.env.ELEVENLABS_DEFAULT_VOICE_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing ElevenLabs env configuration' }) };
  }

  try {
    const { data: customer, error: custErr } = await supabase
      .from('customers')
      .select('id,subscription_plan_code,elevenlabs_agent_id,customer_display_name,customer_legal_name,assistant_name,ai_business_description,ai_services,ai_location_hours,ai_greeting,ai_language')
      .eq('id', customer_id)
      .single();

    if (custErr || !customer) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Kunde nicht gefunden' }) };
    }

    if (customer.elevenlabs_agent_id) {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: 'Agent bereits vorhanden', agent_id: customer.elevenlabs_agent_id })
      };
    }

    const planCode = customer.subscription_plan_code || 'starter';
    const { data: planConfig, error: planErr } = await supabase
      .from('plan_config')
      .select('*')
      .eq('plan_code', planCode)
      .single();

    if (planErr || !planConfig) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Plan-Konfiguration nicht gefunden' }) };
    }

    const voiceId = planConfig.elevenlabs_default_voice_id || process.env.ELEVENLABS_DEFAULT_VOICE_ID;
    if (!voiceId) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Keine Voice-ID konfiguriert' }) };
    }

    const agentName = `Voxera – ${customer.customer_display_name || customer.customer_legal_name || 'Unbekannt'}`;
    const languages = planConfig.languages || ['de'];
    const systemPrompt = buildBasePrompt(customer);

    const elResponse = await fetch(`${ELEVENLABS_API_BASE}/convai/agents/create`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: agentName,
        conversation_config: {
          agent: {
            prompt: { prompt: systemPrompt },
            first_message: customer.ai_greeting || `Guten Tag, hier ist ${customer.assistant_name || 'Lara'} von ${customer.customer_display_name || 'unserem Unternehmen'}. Wie kann ich Ihnen helfen?`,
            language: languages[0]
          },
          tts: { voice_id: voiceId }
        },
        platform_settings: {
          auth: { enable_auth: false }
        }
      })
    });

    if (!elResponse.ok) {
      const elError = await elResponse.text();
      console.error('[provision-agent] ElevenLabs Fehler:', elError);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'ElevenLabs Agent-Erstellung fehlgeschlagen', detail: elError })
      };
    }

    const elData = await elResponse.json();
    const agentId = elData.agent_id;

    if (!agentId) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Keine Agent-ID in ElevenLabs-Antwort' }) };
    }

    const { error: updateErr } = await supabase
      .from('customers')
      .update({ elevenlabs_agent_id: agentId, updated_at: new Date().toISOString() })
      .eq('id', customer_id);

    if (updateErr) {
      console.error('[provision-agent] Supabase Update Fehler:', updateErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Agent erstellt, aber ID konnte nicht gespeichert werden', agent_id: agentId })
      };
    }

    try {
      await fetch(`${process.env.URL}/.netlify/functions/trigger-elevenlabs-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id, agent_id: agentId, triggered_by: `provision_${triggered_by}` })
      });
    } catch (syncErr) {
      console.warn('[provision-agent] Sync-Trigger fehlgeschlagen:', syncErr.message);
    }

    await supabase.from('elevenlabs_sync_log').insert({
      customer_id,
      agent_id: agentId,
      triggered_by: `provision_${triggered_by}`,
      status: 'success',
      prompt_length: systemPrompt.length,
      created_at: new Date().toISOString()
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, agent_id: agentId, agent_name: agentName, voice_id: voiceId, languages })
    };
  } catch (err) {
    console.error('[provision-agent] Unerwarteter Fehler:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Unbekannter Fehler' }) };
  }
};

function buildBasePrompt(customer) {
  const name = customer.assistant_name || 'Lara';
  const displayName = customer.customer_display_name || customer.customer_legal_name || 'unserem Unternehmen';
  return `Du bist ${name}, der KI-Telefonassistent von ${displayName}. Dieser Prompt wird nach der Erstellung automatisch durch den vollständigen System-Prompt ersetzt.`;
}
