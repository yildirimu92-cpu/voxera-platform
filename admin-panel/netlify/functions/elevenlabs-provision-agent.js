// elevenlabs-provision-agent.js v2
// Erstellt neuen ElevenLabs Agent aus dem geteilten Sollzustand + kundenspezifischem Prompt
// Wird aufgerufen wenn ein neuer Kunde onboardet wird

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
// #932: Das frueher hier stehende AGENT_TEMPLATE liegt jetzt in
// _lib/elevenlabs-agent-config.js und wird vom Sync mitbenutzt. Vorher
// beschrieben zwei Dateien denselben Agenten -- die Provisionierung
// vollstaendig, der Sync nur ausschnittsweise -- und der Ausschnitt gewann,
// weil er oefter laeuft. Der Sollzustand hat jetzt genau eine Quelle.
const { buildAgentConfig, DEFAULT_VOICE_ID } = require('./_lib/elevenlabs-agent-config');

const ELEVENLABS_API_KEY  = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY;
const ELEVENLABS_BASE     = 'https://api.elevenlabs.io/v1/convai/agents';

// Der Prompt kommt unmittelbar danach ueber trigger-elevenlabs-sync; bis dahin
// steht dieser Platzhalter im Agenten.
const PLACEHOLDER_PROMPT = '(Wird nach Erstellung durch trigger-elevenlabs-sync befüllt)';

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
  const voiceId = customer.voice_id || DEFAULT_VOICE_ID; // Default: Lara

  // 6. Sollzustand zusammenbauen — dieselbe Funktion, die auch jeder Sync
  //    benutzt. Genau deshalb kann ein Sync den Agenten nicht mehr in einen
  //    Zustand bringen, den die Provisionierung nie erzeugt haette (#932).
  //    `tool_ids` bleibt hier weg: der Kalender wird erst vom nachgelagerten
  //    Sync provisioniert, und ein leeres Array waere die Aussage "keine
  //    Werkzeuge" statt "noch nicht bekannt".
  const agentPayload = buildAgentConfig({
    customer,
    prompt: PLACEHOLDER_PROMPT,
    firstMessage: greeting
  });
  agentPayload.name = agentName;

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
