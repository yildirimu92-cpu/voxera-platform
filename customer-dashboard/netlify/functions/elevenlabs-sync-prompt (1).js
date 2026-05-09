// elevenlabs-sync-prompt.js
// Netlify Function — baut den vollständigen Prompt aus Supabase
// und pusht ihn direkt zur ElevenLabs Agent API
//
// Trigger: nach jedem AI Setup Save im Admin Portal
// POST body: { customer_id, agent_id }

const { createClient } = require('@supabase/supabase-js');

const ELEVENLABS_API_KEY   = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ELEVENLABS_BASE      = 'https://api.elevenlabs.io/v1/convai/agents';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { customer_id, agent_id } = body;
  if (!customer_id || !agent_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'customer_id and agent_id required' }) };
  }

  if (!ELEVENLABS_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 1. Lade Kundendaten + plan_config
  const { data: customer, error: custErr } = await sb
    .from('customers')
    .select('*')
    .eq('id', customer_id)
    .maybeSingle();

  if (custErr || !customer) {
    console.error('[sync-prompt] customer not found', { customer_id, error: custErr?.message });
    return { statusCode: 404, body: JSON.stringify({ error: 'Customer not found' }) };
  }

  // 2. Lade L1 Prompt aus system_config
  const { data: l1Row } = await sb
    .from('system_config')
    .select('value')
    .eq('key', 'prompt_master_l1')
    .maybeSingle();

  const l1 = l1Row?.value || '';

  // 3. Lade Branchen-Template (L2)
  let l2 = '';
  if (customer.industry_template_id) {
    const { data: tplRow } = await sb
      .from('industry_templates')
      .select('prompt_block')
      .eq('id', customer.industry_template_id)
      .maybeSingle();
    l2 = tplRow?.prompt_block || '';
  }

  // 4. Baue L3 Kunden-Layer
  const l3Parts = [];
  if (customer.ai_business_description) l3Parts.push(`## GESCHÄFTSPROFIL\n${customer.ai_business_description}`);
  if (customer.ai_services)             l3Parts.push(`## LEISTUNGEN\n${customer.ai_services}`);
  if (customer.ai_location_hours)       l3Parts.push(`## STANDORT & ERREICHBARKEIT\n${customer.ai_location_hours}`);
  if (customer.ai_booking_faq)          l3Parts.push(`## TERMINLOGIK & FAQ\n${customer.ai_booking_faq}`);
  if (customer.ai_instructions)         l3Parts.push(`## KUNDENSPEZIFISCHE ANWEISUNGEN\n${customer.ai_instructions}`);
  if (customer.ai_fallback_escalation)  l3Parts.push(`## ESKALATION & FALLBACK\n${customer.ai_fallback_escalation}`);
  if (customer.ai_response_constraints) l3Parts.push(`## ANTWORTGRENZEN\n${customer.ai_response_constraints}`);
  const l3 = l3Parts.join('\n\n');

  // 5. Resolve Variablen im L1 Prompt
  const assistantName   = customer.assistant_name   || 'Lara';
  const customerType    = customer.ai_customer_type || 'company';
  const addressForm     = customer.ai_address_form  || 'sie';
  const tone            = customer.ai_tone          || 'professional';
  const language        = customer.ai_language      || 'de';
  const greeting        = customer.ai_greeting      || '';
  const displayName     = customer.customer_display_name || customer.customer_name || '';
  const legalName       = customer.customer_legal_name   || customer.customer_name || '';

  const wirOderIch    = customerType === 'company' ? 'Wir-Form' : 'Ich-Form';
  const wirMeldetSich = customerType === 'company' ? 'Wir melden uns' : 'Ich melde mich';
  const tonMap        = { formal: 'konservativ-formell', professional: 'warm-professionell', casual: 'locker und direkt' };
  const tonText       = tonMap[tone] || tonMap.professional;
  const anredeText    = addressForm === 'du' ? 'Du-Form (informell)' : 'Sie-Form (formell)';

  const autoGreeting = greeting || buildGreeting(assistantName, customerType, displayName, language);

  let prompt = l1
    .replace(/{{ASSISTANT_NAME}}/g, assistantName)
    .replace(/{{CUSTOMER_DISPLAY_NAME}}/g, displayName)
    .replace(/{{CUSTOMER_LEGAL_NAME}}/g, legalName)
    .replace(/{{WIR_ODER_ICH}}/g, wirOderIch)
    .replace(/{{WIR_MELDET_SICH}}/g, wirMeldetSich)
    .replace(/{{TON}}/g, tonText)
    .replace(/{{ANREDE}}/g, anredeText)
    .replace(/{{SPRACHE}}/g, language)
    .replace(/{{BEGRUESSUNG}}/g, autoGreeting);

  // 6. Zusammensetzen: L1 + L2 + L3
  const sections = [prompt];
  if (l2) sections.push('---\n\n## BRANCHEN-LAYER\n\n' + l2);
  if (l3) sections.push('---\n\n## KUNDEN-LAYER\n\n' + l3);
  const fullPrompt = sections.join('\n\n');

  console.log('[sync-prompt] prompt built', {
    customer_id,
    agent_id,
    promptLength: fullPrompt.length,
    hasL2: !!l2,
    hasL3: !!l3
  });

  // 7. Push zu ElevenLabs
  const elRes = await fetch(`${ELEVENLABS_BASE}/${agent_id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY
    },
    body: JSON.stringify({
      conversation_config: {
        agent: {
          prompt: {
            prompt: fullPrompt
          },
          first_message: autoGreeting
        }
      }
    })
  });

  if (!elRes.ok) {
    const errText = await elRes.text();
    console.error('[sync-prompt] ElevenLabs API error', { status: elRes.status, body: errText });
    return { statusCode: 500, body: JSON.stringify({ error: 'ElevenLabs API error', detail: errText }) };
  }

  console.log('[sync-prompt] ElevenLabs updated successfully', { agent_id });

  // 8. Updated_at in DB setzen
  await sb.from('customers').update({ updated_at: new Date().toISOString() }).eq('id', customer_id);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, agent_id, promptLength: fullPrompt.length })
  };
};

function buildGreeting(name, type, firmName, lang) {
  if (lang === 'fr') {
    if (type === 'company') return `Bonjour, ici ${name} de ${firmName}. Cet appel est enregistré pour traitement. Comment puis-je vous aider?`;
    return `Bonjour, ici ${name}, l'assistante de ${firmName}. Cet appel est enregistré. Comment puis-je vous aider?`;
  }
  if (lang === 'it') {
    if (type === 'company') return `Buongiorno, sono ${name} di ${firmName}. La chiamata viene registrata. Come posso aiutarla?`;
    return `Buongiorno, sono ${name}, l'assistente di ${firmName}. La chiamata viene registrata. Come posso aiutarla?`;
  }
  if (lang === 'en') {
    if (type === 'company') return `Hello, this is ${name} from ${firmName}. This call is being recorded. How may I help you?`;
    return `Hello, this is ${name}, assistant to ${firmName}. This call is being recorded. How may I help you?`;
  }
  // Deutsch
  if (type === 'company') return `Grüezi, hier ist ${name} von ${firmName}. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?`;
  if (type === 'consultant') return `Grüezi, hier ist ${name}, die Assistentin von ${firmName}. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?`;
  return `Grüezi, hier ist ${name}, die Assistentin von ${firmName}. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?`;
}
