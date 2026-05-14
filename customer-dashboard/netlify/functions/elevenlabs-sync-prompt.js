// elevenlabs-sync-prompt.js v3
// Netlify Function — baut vollständigen Prompt + pusht zu ElevenLabs
// [PATCH v3] Gender-aware Begrüssung: "die Assistentin" vs "der Assistent"

const { createClient } = require('@supabase/supabase-js');

const ELEVENLABS_API_KEY   = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ELEVENLABS_BASE      = 'https://api.elevenlabs.io/v1/convai/agents';

const TRACKED_FIELDS = {
  assistant_name:           'Assistenzname',
  ai_customer_type:         'Kundentyp',
  ai_address_form:          'Anrede',
  ai_tone:                  'Tonalität',
  ai_language:              'Hauptsprache',
  ai_greeting:              'Begrüssung',
  ai_business_description:  'Geschäftsprofil',
  ai_services:              'Leistungen',
  ai_location_hours:        'Standort & Erreichbarkeit',
  ai_booking_faq:           'Terminlogik & FAQ',
  ai_instructions:          'Gesprächsregeln',
  ai_fallback_escalation:   'Eskalation & Fallback',
  ai_response_constraints:  'Antwortgrenzen',
  industry_template_id:     'Branchen-Vorlage',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { customer_id, agent_id, triggered_by = 'admin_save', prev_values = {} } = body;
  if (!customer_id || !agent_id) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'customer_id and agent_id required' }) };
  }

  if (!ELEVENLABS_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 1. Lade Kundendaten
  const { data: customer, error: custErr } = await sb
    .from('customers').select('*').eq('id', customer_id).maybeSingle();

  if (custErr || !customer) {
    return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Customer not found' }) };
  }

  // 2. Berechne geänderte Felder (Vorher/Nachher aus prev_values)
  const changedFields = {};
  for (const [field, label] of Object.entries(TRACKED_FIELDS)) {
    const currentVal = String(customer[field] || '').trim();
    const prevVal    = String(prev_values[field] || '').trim();
    if (prevVal !== '' && prevVal !== currentVal) {
      changedFields[label] = { from: prevVal.substring(0, 100), to: currentVal.substring(0, 100) };
    }
  }

  // 3. L1 Prompt laden
  const { data: l1Row } = await sb.from('system_config').select('value')
    .eq('key', 'prompt_master_l1').maybeSingle();
  const l1 = l1Row?.value || '';

  // 4. L2 Branchen-Template
  let l2 = '';
  if (customer.industry_template_id) {
    const { data: tplRow } = await sb.from('industry_templates')
      .select('prompt_block').eq('id', customer.industry_template_id).maybeSingle();
    l2 = tplRow?.prompt_block || '';
  }

  // 5. L3 Kunden-Layer
  const l3Parts = [];
  if (customer.ai_business_description) l3Parts.push(`## GESCHÄFTSPROFIL\n${customer.ai_business_description}`);
  if (customer.ai_services)             l3Parts.push(`## LEISTUNGEN\n${customer.ai_services}`);
  if (customer.ai_location_hours)       l3Parts.push(`## STANDORT & ERREICHBARKEIT\n${customer.ai_location_hours}`);
  if (customer.ai_booking_faq)          l3Parts.push(`## TERMINLOGIK & FAQ\n${customer.ai_booking_faq}`);
  if (customer.ai_instructions)         l3Parts.push(`## KUNDENSPEZIFISCHE ANWEISUNGEN\n${customer.ai_instructions}`);
  if (customer.ai_fallback_escalation)  l3Parts.push(`## ESKALATION & FALLBACK\n${customer.ai_fallback_escalation}`);
  if (customer.ai_response_constraints) l3Parts.push(`## ANTWORTGRENZEN\n${customer.ai_response_constraints}`);
  const l3 = l3Parts.join('\n\n');

  // 6. [PATCH v3] Gender der gewählten Stimme aus voxera_voices laden
  let voiceGender = 'female'; // Default: weiblich (Lara)
  if (customer.voice_id) {
    const { data: voiceRow } = await sb
      .from('voxera_voices')
      .select('gender')
      .eq('voice_id', customer.voice_id)
      .maybeSingle();
    if (voiceRow?.gender) voiceGender = voiceRow.gender;
  }
  const isMale = voiceGender === 'male';

  // 7. Variablen auflösen
  const assistantName = customer.assistant_name   || 'Lara';
  const customerType  = customer.ai_customer_type || 'company';
  const addressForm   = customer.ai_address_form  || 'sie';
  const tone          = customer.ai_tone          || 'professional';
  const language      = customer.ai_language      || 'de';
  const greeting      = customer.ai_greeting      || '';
  const displayName   = customer.customer_display_name || customer.customer_name || '';
  const legalName     = customer.customer_legal_name   || customer.customer_name || '';
  const wirOderIch    = customerType === 'company' ? 'Wir-Form' : 'Ich-Form';
  const wirMeldetSich = customerType === 'company' ? 'Wir melden uns' : 'Ich melde mich';
  const tonMap        = { formal: 'konservativ-formell', professional: 'warm-professionell', casual: 'locker und direkt' };
  const tonText       = tonMap[tone] || tonMap.professional;
  const anredeText    = addressForm === 'du' ? 'Du-Form (informell)' : 'Sie-Form (formell)';

  // [PATCH v3] Gender-aware Begrüssung
  const autoGreeting  = greeting || buildGreeting(assistantName, customerType, displayName, language, isMale);

  // [PATCH v3] Gender-aware Pronomen für Prompt-Variablen
  const assistantRole = isMale ? 'der Assistent' : 'die Assistentin';
  const assistantPronoun = isMale ? 'er' : 'sie';

  let prompt = l1
    .replace(/{{ASSISTANT_NAME}}/g,        assistantName)
    .replace(/{{CUSTOMER_DISPLAY_NAME}}/g, displayName)
    .replace(/{{CUSTOMER_LEGAL_NAME}}/g,   legalName)
    .replace(/{{WIR_ODER_ICH}}/g,          wirOderIch)
    .replace(/{{WIR_MELDET_SICH}}/g,       wirMeldetSich)
    .replace(/{{TON}}/g,                   tonText)
    .replace(/{{ANREDE}}/g,                anredeText)
    .replace(/{{SPRACHE}}/g,               language)
    .replace(/{{BEGRUESSUNG}}/g,           autoGreeting)
    .replace(/{{ASSISTANT_ROLE}}/g,        assistantRole)      // [PATCH v3] neu
    .replace(/{{ASSISTANT_PRONOUN}}/g,     assistantPronoun);  // [PATCH v3] neu

  const sections = [prompt];
  if (l2) sections.push('---\n\n## BRANCHEN-LAYER\n\n' + l2);
  if (l3) sections.push('---\n\n## KUNDEN-LAYER\n\n' + l3);
  const fullPrompt = sections.join('\n\n');

  // 8. Push zu ElevenLabs
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
          // [PATCH v3] TTS Voice ID aktualisieren
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
    console.error('[sync-prompt] ElevenLabs error', { error: e.message });
  }

  // 9. Log schreiben
  await sb.from('elevenlabs_sync_log').insert({
    customer_id,
    agent_id,
    status:          syncStatus,
    triggered_by,
    changed_fields:  Object.keys(changedFields).length > 0 ? changedFields : null,
    prompt_snapshot: syncStatus === 'success' ? fullPrompt : null,
    prompt_length:   fullPrompt.length,
    error_message:   syncError,
    created_at:      new Date().toISOString()
  });

  // 10. Max 10 Logs pro Kunde
  const { data: allLogs } = await sb.from('elevenlabs_sync_log')
    .select('id').eq('customer_id', customer_id)
    .order('created_at', { ascending: false });
  if (allLogs && allLogs.length > 10) {
    const toDelete = allLogs.slice(10).map(r => r.id);
    await sb.from('elevenlabs_sync_log').delete().in('id', toDelete);
  }

  // 11. Customer Status aktualisieren
  await sb.from('customers').update({
    elevenlabs_last_sync_at: new Date().toISOString(),
    elevenlabs_sync_status:  syncStatus,
    elevenlabs_sync_error:   syncError || null,
    updated_at:              new Date().toISOString()
  }).eq('id', customer_id);

  if (syncStatus === 'failed') {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: syncError }) };
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      success: true, agent_id,
      promptLength: fullPrompt.length,
      changedFields: Object.keys(changedFields),
      voiceGender  // [PATCH v3] zur Diagnose
    })
  };
};

// [PATCH v3] Gender-aware Begrüssung
// isMale = true → "der Assistent" / false → "die Assistentin"
function buildGreeting(name, type, firmName, lang, isMale = false) {
  const role = {
    de: isMale ? 'der Assistent' : 'die Assistentin',
    fr: isMale ? "l'assistant"   : "l'assistante",
    it: isMale ? "l'assistente"  : "l'assistente", // IT: gleich
    en: isMale ? 'assistant'     : 'assistant'      // EN: gleich
  };

  if (lang === 'fr') {
    if (type === 'company') return `Bonjour, ici ${name} de ${firmName}. Cet appel est enregistré pour traitement. Comment puis-je vous aider?`;
    return `Bonjour, ici ${name}, ${role.fr} de ${firmName}. Cet appel est enregistré. Comment puis-je vous aider?`;
  }
  if (lang === 'it') {
    if (type === 'company') return `Buongiorno, sono ${name} di ${firmName}. La chiamata viene registrata. Come posso aiutarla?`;
    return `Buongiorno, sono ${name}, ${role.it} di ${firmName}. La chiamata viene registrata. Come posso aiutarla?`;
  }
  if (lang === 'en') {
    if (type === 'company') return `Hello, this is ${name} from ${firmName}. This call is being recorded. How may I help you?`;
    return `Hello, this is ${name}, ${role.en} to ${firmName}. This call is being recorded. How may I help you?`;
  }
  // Deutsch (default)
  if (type === 'company') return `Grüezi, hier ist ${name} von ${firmName}. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?`;
  return `Grüezi, hier ist ${name}, ${role.de} von ${firmName}. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?`;
}
