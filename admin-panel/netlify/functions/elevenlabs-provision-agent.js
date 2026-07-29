// elevenlabs-provision-agent.js v2
// Erstellt neuen ElevenLabs Agent aus Template + kundenspezifischem Prompt
// Wird aufgerufen wenn ein neuer Kunde onboardet wird

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const ELEVENLABS_API_KEY  = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY;
const ELEVENLABS_BASE     = 'https://api.elevenlabs.io/v1/convai/agents';
const AUDIO_TRANSCRIPT_RETENTION_DAYS = 90;

// ── Agent-Template (identisch mit konfiguriertem Yildirim-Agent, ohne Kundendaten) ──
const AGENT_TEMPLATE = {
  conversation_config: {
    asr: {
      quality: 'high',
      provider: 'scribe_realtime',
      user_input_audio_format: 'pcm_16000',
      keywords: []
    },
    turn: {
      turn_timeout: 3,
      silence_end_call_timeout: -1,
      mode: 'turn',
      turn_eagerness: 'eager',
      spelling_patience: 'auto',
      speculative_turn: true,
      retranscribe_on_turn_timeout: false,
      turn_model: 'turn_v2',
      soft_timeout_config: {
        timeout_seconds: 3,
        message: 'Einen Moment',
        use_llm_generated_message: false  // Statisch — nie LLM-generiert
      }
    },
    tts: {
      model_id: 'eleven_v3_conversational',
      voice_id: '1iF3vHdwHKuVKSPDK23Z',  // Lara (Default) — wird nach Sync überschrieben
      expressive_mode: true,
      suggested_audio_tags: [
        { tag: 'Geduldig',   description: '' },
        { tag: 'Einfühlsam', description: '' },
        { tag: 'Herzlich',   description: '' }
      ],
      agent_output_audio_format: 'pcm_16000',
      optimize_streaming_latency: 3,
      stability: 0.5,
      speed: 1,
      similarity_boost: 0.8,
      text_normalisation_type: 'system_prompt'
    },
    conversation: {
      text_only: false,
      max_duration_seconds: 600,
      client_events: ['audio','interruption','user_transcript','agent_response','agent_response_correction']
    },
    vad: { background_voice_detection: false },
    agent: {
      language: 'de',
      disable_first_message_interruptions: false,
      prompt: {
        llm: 'gemini-2.5-flash',
        thinking_budget: 1024,
        temperature: 0.19,
        max_tokens: 1200,
        timezone: 'Europe/Zurich',
        backup_llm_config: { preference: 'default' },
        cascade_timeout_seconds: 8
      }
    }
  },
  platform_settings: {
    data_collection: {
      caller_name: {
        type: 'string',
        description: 'Der vollständige Name der anrufenden Person, exakt wie sie sich selbst vorgestellt hat. Format: "Vorname Nachname". Nur eintragen wenn die Person ihren Namen explizit genannt hat. Niemals raten. Trage NIEMALS den Namen des Assistenten ein.'
      },
      caller_company: {
        type: 'string',
        description: 'Die Firma der anrufenden Person. Nur eintragen wenn explizit genannt. Trage NIEMALS die Firma des Assistenten ein.'
      },
      caller_email: {
        type: 'string',
        description: 'E-Mail-Adresse die der Anrufer mündlich angegeben hat. Nur eintragen wenn klar buchstabiert. Bei Unsicherheit leer lassen.'
      },
      call_summary: {
        type: 'string',
        description: 'Sachliche Zusammenfassung in 2-3 Sätzen auf Deutsch. IMMER auf Deutsch. Beginne mit dem Anliegen. Keine Floskeln.'
      },
      call_summary_short: {
        type: 'string',
        description: 'Kernanliegen in einem Satz auf Deutsch, max. 80 Zeichen. IMMER auf Deutsch. Keine Namen, keine Zeiten.'
      },
      callback_requested: {
        type: 'boolean',
        description: 'true wenn Anrufer Rückruf wünscht oder zugestimmt hat. false wenn kein Rückruf. Im Zweifel false.'
      },
      callback_time: {
        type: 'string',
        description: 'Gewünschter Rückruf-Zeitpunkt auf Deutsch. Leer wenn kein Zeitpunkt genannt.'
      },
      category: {
        type: 'string',
        description: 'Kategorie des Anliegens. Wähle einen der Enum-Werte.',
        enum: ['rueckrufanfrage','terminanfrage','informationsanfrage','offertenanfrage','beschwerde','aenderung_kuendigung','notfall','sonstiges']
      },
      lead_quality: {
        type: 'string',
        description: 'Geschäftspotenzial: hot = konkrete Handlungsabsicht. warm = allgemeines Interesse. cold = kein Geschäftsbezug. Im Zweifel warm.'
      },
      urgency: {
        type: 'string',
        description: 'Dringlichkeit: hoch / mittel / niedrig. Nur aus Anrufer-Aussagen ableiten.'
      },
      next_action: {
        type: 'string',
        description: 'Nächste konkrete Aktion auf Deutsch. "Keine Aktion nötig" wenn nichts zu tun.'
      }
    },
    summary_language: 'de',
    auth: { enable_auth: true, allowlist: [], require_origin_header: false },
    call_limits: { agent_concurrency_limit: 10, daily_limit: 500, bursting_enabled: true },
    privacy: { record_voice: true, retention_days: AUDIO_TRANSCRIPT_RETENTION_DAYS, zero_retention_mode: false },
    analysis_llm: 'gemini-2.5-flash'
  }
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { customer_id, triggered_by = 'admin_manual' } = body;
  if (!customer_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'customer_id required' }) };
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

  // 1. Kundendaten laden
  const { data: customer, error: custErr } = await sb
    .from('customers').select('*').eq('id', customer_id).maybeSingle();

  if (custErr || !customer) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Customer not found' }) };
  }

  // 2. Bereits agent vorhanden?
  if (customer.elevenlabs_agent_id) {
    return { statusCode: 409, body: JSON.stringify({
      error: 'Agent already exists',
      agent_id: customer.elevenlabs_agent_id
    })};
  }

  // 3. Agent-Namen setzen
  const agentName = `Voxera – ${customer.customer_display_name || customer.customer_name || 'Unbekannt'}`;

  // 4. Begrüssung aufbauen
  const assistantName = customer.assistant_name || 'Lara';
  const displayName   = customer.customer_display_name || customer.customer_name || '';
  const language      = customer.ai_language || 'de';
  const greeting      = customer.ai_greeting || buildDefaultGreeting(assistantName, displayName, language);

  // 5. Voice-ID aus Plan bestimmen
  const voiceId = customer.voice_id || '1iF3vHdwHKuVKSPDK23Z'; // Default: Lara

  // 6. Template zusammenbauen
  const agentPayload = JSON.parse(JSON.stringify(AGENT_TEMPLATE)); // Deep clone
  agentPayload.name = agentName;
  agentPayload.conversation_config.agent.first_message = greeting;
  agentPayload.conversation_config.agent.language = language;
  agentPayload.conversation_config.agent.prompt.prompt = '(Wird nach Erstellung durch trigger-elevenlabs-sync befüllt)';
  agentPayload.conversation_config.tts.voice_id = voiceId;

  // 7. Agent erstellen
  let agentId = null;
  try {
    const elRes = await fetch(`${ELEVENLABS_BASE}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': ELEVENLABS_API_KEY },
      body: JSON.stringify(agentPayload)
    });

    if (!elRes.ok) {
      const errText = await elRes.text();
      throw new Error(`ElevenLabs ${elRes.status}: ${errText.substring(0, 200)}`);
    }

    const elData = await elRes.json();
    agentId = elData.agent_id;
  } catch(e) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Agent creation failed', detail: e.message }) };
  }

  // 8. Agent-ID in DB speichern
  const { error: updateErr } = await sb.from('customers')
    .update({ elevenlabs_agent_id: agentId, updated_at: new Date().toISOString() })
    .eq('id', customer_id);

  if (updateErr) {
    console.error('[provision] DB update failed:', updateErr);
    // Agent existiert aber ID nicht gespeichert — kritisch
    return { statusCode: 500, body: JSON.stringify({
      error: 'Agent created but ID not saved',
      agent_id: agentId
    })};
  }

  // 9. Sofort Prompt synchronisieren
  try {
    const adminUrl = process.env.ADMIN_URL || 'https://admin.voxera.ch';
    const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
    const syncResponse = await fetch(`${adminUrl}/.netlify/functions/trigger-elevenlabs-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify({
        customer_id,
        agent_id: agentId,
        triggered_by: `provision_${triggered_by}`
      })
    });
    if (!syncResponse.ok) {
      throw new Error(`Initial sync returned HTTP ${syncResponse.status}`);
    }
  } catch(e) {
    console.warn('[provision] Initial sync failed:', e.message);
    // Nicht kritisch — Agent existiert, kann manuell synchronisiert werden
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      agent_id: agentId,
      agent_name: agentName,
      voice_id: voiceId,
      message: 'Agent erstellt und Prompt-Sync ausgelöst'
    })
  };
};

function buildDefaultGreeting(name, firmName, lang) {
  if (lang === 'fr') return `Bonjour, ici ${name} de ${firmName}. Cet appel est enregistré. Comment puis-je vous aider?`;
  if (lang === 'it') return `Buongiorno, sono ${name} di ${firmName}. La chiamata viene registrata. Come posso aiutarla?`;
  if (lang === 'en') return `Hello, this is ${name} from ${firmName}. This call is being recorded. How may I help you?`;
  return `Grüezi, hier ist ${name} von ${firmName}. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?`;
}
