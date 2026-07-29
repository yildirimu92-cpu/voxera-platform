// trigger-elevenlabs-sync.js
// Admin Portal Netlify Function — proxied ElevenLabs sync
// Vermeidet CORS Problem zwischen admin.voxera.ch und dashboard.voxera.ch

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const ELEVENLABS_API_KEY   = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY;
const ELEVENLABS_BASE      = 'https://api.elevenlabs.io/v1/convai/agents';

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

  // L1 Prompt
  const { data: l1Row } = await sb.from('system_config').select('value')
    .eq('key', 'prompt_master_l1').maybeSingle();
  const l1 = l1Row?.value || '';

  // L2 Template
  let l2 = '';
  if (customer.industry_template_id) {
    const { data: tplRow } = await sb.from('industry_templates')
      .select('prompt_block').eq('id', customer.industry_template_id).maybeSingle();
    l2 = tplRow?.prompt_block || '';
  }

  // L3 Kunden-Layer
  const l3Parts = [];
  if (customer.ai_business_description) l3Parts.push(`## GESCHÄFTSPROFIL\n${customer.ai_business_description}`);
  if (customer.ai_services)             l3Parts.push(`## LEISTUNGEN\n${customer.ai_services}`);
  if (customer.ai_location_hours) {
    const lh = customer.ai_location_hours;
    const hasPrefixes = lh.includes('TEL:') || lh.includes('BÜRO:') || lh.includes('TERMIN:');
    const formatted = hasPrefixes
      ? lh.replace(/^TEL:/gm,'Telefonisch:').replace(/^BÜRO:/gm,'Bürozeiten:').replace(/^TERMIN:/gm,'Terminzeiten:')
      : lh;
    l3Parts.push(`## STANDORT & ERREICHBARKEIT\n${formatted}`);
  }
  if (customer.ai_booking_faq)          l3Parts.push(`## TERMINLOGIK & FAQ\n${customer.ai_booking_faq}`);
  if (customer.ai_instructions)         l3Parts.push(`## KUNDENSPEZIFISCHE ANWEISUNGEN\n${customer.ai_instructions}`);
  if (customer.ai_fallback_escalation)  l3Parts.push(`## ESKALATION & FALLBACK\n${customer.ai_fallback_escalation}`);
  if (customer.ai_response_constraints) l3Parts.push(`## ANTWORTGRENZEN\n${customer.ai_response_constraints}`);

  // Weiterleitungen (nur wenn konfiguriert)
  const fwdParts = [];
  if (customer.ai_forwarding_1_name && customer.ai_forwarding_1_number) {
    const trigger1 = customer.ai_forwarding_1_trigger ? ` (bei: ${customer.ai_forwarding_1_trigger})` : '';
    fwdParts.push(`- ${customer.ai_forwarding_1_name}: ${customer.ai_forwarding_1_number}${trigger1}`);
  }
  if (customer.ai_forwarding_2_name && customer.ai_forwarding_2_number) {
    const trigger2 = customer.ai_forwarding_2_trigger ? ` (bei: ${customer.ai_forwarding_2_trigger})` : '';
    fwdParts.push(`- ${customer.ai_forwarding_2_name}: ${customer.ai_forwarding_2_number}${trigger2}`);
  }
  if (fwdParts.length) {
    l3Parts.push(`## WEITERLEITUNGEN\nBei folgenden Anliegen kannst du den Anrufer weiterleiten (sobald Weiterleitungs-Funktion aktiviert):\n${fwdParts.join('\n')}`);
  }
  if (customer.ai_emergency_number && customer.ai_emergency_number !== '144') {
    l3Parts.push(`## NOTFALLNUMMER\nBei akuter Notlage: ${customer.ai_emergency_number}`);
  } else if (customer.ai_emergency_number === '144') {
    l3Parts.push(`## NOTFALLNUMMER\nBei Lebensgefahr: 144 (Rettungsdienst)`);
  }
  const l3 = l3Parts.join('\n\n');

  // ── Variablen auflösen ────────────────────────────────────────────────────────
  const assistantName  = customer.assistant_name        || 'Lara';
  const customerType   = customer.ai_customer_type      || 'company';
  const addressForm    = customer.ai_address_form       || 'sie';
  const tone           = customer.ai_tone               || 'professional';
  const language       = customer.ai_language           || 'de';
  const greeting       = customer.ai_greeting           || '';
  const personName     = customer.ai_person_name        || '';
  const firmName       = customer.customer_legal_name   || customer.customer_name || '';
  const displayName    = customer.customer_display_name || customer.customer_name || firmName;
  const legalName      = firmName;

  // Wir/Ich-Form — company = Wir, consultant/person = Ich
  const isCompany      = customerType === 'company';
  const wirOderIch     = isCompany ? 'Wir' : 'Ich';
  const wirOderIchKl   = isCompany ? 'wir' : 'ich'; // kleingeschrieben für Satzmitte
  const wirMeldetSich  = isCompany ? 'Wir melden uns' : 'Ich melde mich';
  const wirRuftZurueck = isCompany ? 'Wir rufen zurück' : 'Ich rufe zurück';

  // Tonalität — mit konkreten Beispielen damit der LLM es richtig interpretiert
  const tonMap = {
    formal:       'konservativ-formell. Beispiel: "Sehr geehrte Damen und Herren, wir nehmen Ihr Anliegen gerne auf."',
    professional: 'warm-professionell. Beispiel: "Grüezi, ich nehme das gerne für Sie auf."',
    casual:       'locker und direkt. Beispiel: "Hey, ich helfe dir gerne weiter."'
  };
  const tonText = tonMap[tone] || tonMap.professional;

  // Anrede — mit konkreter Handlungsanweisung
  const anredeText = addressForm === 'du'
    ? 'Du-Form: Sprich den Anrufer konsequent mit "du" an. Beispiel: "Wie kann ich dir helfen?", "Wann passt es dir?"'
    : 'Sie-Form: Sprich den Anrufer konsequent mit "Sie" an. Beispiel: "Wie kann ich Ihnen helfen?", "Wann passt es Ihnen?"';

  // Sprache
  const sprachMap = {
    'de':          'Deutsch (Standard)',
    'de_en':       'Deutsch (Standard), Englisch (bei englischsprachigen Anrufern)',
    'de_en_fr':    'Deutsch (Standard), Englisch und Französisch (automatischer Wechsel)',
    'de_fr_it_en': 'Deutsch, Französisch, Italienisch, Englisch (automatischer Wechsel)'
  };
  const sprachText = sprachMap[language] || sprachMap['de'];

  // Gender-aware Assistenz-Rolle aus voxera_voices
  // Wird nach Voice-Lookup gesetzt — Default weiblich
  let assistantRole = 'die Assistentin';
  if (customer.voice_id) {
    // Inline lookup — wir haben die Voices bereits in der DB
    // Male voices: Max, Marco (voice_id lookup via voxera_voices)
    const { data: voiceRow } = await sb
      .from('voxera_voices')
      .select('gender')
      .eq('voice_id', customer.voice_id)
      .maybeSingle();
    if (voiceRow?.gender === 'male') assistantRole = 'der Assistent';
  }

  // Einzelperson-Hinweis für L3
  const ichFormHinweis = !isCompany
    ? '\n\n## ICH-FORM\nDu sprichst im Namen einer Einzelperson, nicht eines Unternehmens. Verwende "ich" statt "wir". Beispiel: "Ich melde mich bei Ihnen." statt "Wir melden uns."'
    : '';

  const autoGreeting = greeting || buildGreeting(assistantName, customerType, personName, firmName, language);

  let prompt = l1
    .replace(/{{ASSISTANT_NAME}}/g,        assistantName)
    .replace(/{{ASSISTANT_ROLE}}/g,        assistantRole)
    .replace(/{{CUSTOMER_DISPLAY_NAME}}/g, displayName)
    .replace(/{{CUSTOMER_LEGAL_NAME}}/g,   legalName)
    .replace(/{{WIR_ODER_ICH}}/g,          wirOderIch)
    .replace(/{{WIR_MELDET_SICH}}/g,       wirMeldetSich)
    .replace(/{{TON}}/g,                   tonText)
    .replace(/{{ANREDE}}/g,                anredeText)
    .replace(/{{SPRACHE}}/g,               sprachText)
    .replace(/{{BEGRUESSUNG}}/g,           autoGreeting)
    // Lowercase Varianten (Legacy)
    .replace(/{{assistant_name}}/g,        assistantName)
    .replace(/{{customer_display_name}}/g, displayName)
    .replace(/{{customer_legal_name}}/g,   legalName)
    .replace(/{{ai_summary}}/g,            customer.ai_summary || '');

  // Ersetze Platzhalter in L1 mit echten Inhalten
  // L3 mit Ich-Form-Hinweis für Einzelpersonen
  const l3Final = l3 + (ichFormHinweis || '');

  let fullPrompt = prompt
    .replace(/{{INDUSTRY_LAYER}}/g, l2      || '_(kein Branchen-Layer definiert)_')
    .replace(/{{CUSTOMER_LAYER}}/g,  l3Final || '_(kein Kunden-Layer definiert)_');

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
    body: JSON.stringify({ success: true, agent_id, promptLength: fullPrompt.length })
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
