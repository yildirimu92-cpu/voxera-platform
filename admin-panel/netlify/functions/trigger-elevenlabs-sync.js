// trigger-elevenlabs-sync.js
// Admin Portal Netlify Function — proxied ElevenLabs sync
// Vermeidet CORS Problem zwischen admin.voxera.ch und dashboard.voxera.ch

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

  const { customer_id, agent_id, triggered_by = 'admin_save', prev_values = {} } = body;
  if (!customer_id || !agent_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'customer_id and agent_id required' }) };
  }

  if (!ELEVENLABS_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

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
  if (customer.ai_location_hours)       l3Parts.push(`## STANDORT & ERREICHBARKEIT\n${customer.ai_location_hours}`);
  if (customer.ai_booking_faq)          l3Parts.push(`## TERMINLOGIK & FAQ\n${customer.ai_booking_faq}`);
  if (customer.ai_instructions)         l3Parts.push(`## KUNDENSPEZIFISCHE ANWEISUNGEN\n${customer.ai_instructions}`);
  if (customer.ai_fallback_escalation)  l3Parts.push(`## ESKALATION & FALLBACK\n${customer.ai_fallback_escalation}`);
  if (customer.ai_response_constraints) l3Parts.push(`## ANTWORTGRENZEN\n${customer.ai_response_constraints}`);
  if (customer.ai_branch_extra) {
    const extra = typeof customer.ai_branch_extra === 'string'
      ? JSON.parse(customer.ai_branch_extra)
      : customer.ai_branch_extra;

    const extraLines = [];
    if (extra.pannendienst) extraLines.push('Pannendienst: verfügbar');
    if (extra.notfalldienst) extraLines.push('Notfalldienst: verfügbar');
    if (extra.notfall_kanton) extraLines.push(`Notfalldienst Kanton: ${extra.notfall_kanton}`);
    if (extra.marken) extraLines.push(`Fahrzeugmarken: ${extra.marken}`);
    if (extra.kassentyp) extraLines.push(`Kassentyp: ${extra.kassentyp}`);
    if (extra.fachgebiet) extraLines.push(`Fachgebiet: ${extra.fachgebiet}`);
    if (extra.reservation !== undefined) extraLines.push(`Reservation: ${extra.reservation ? 'Ja' : 'Nein'}`);
    if (extra.takeaway !== undefined) extraLines.push(`Takeaway: ${extra.takeaway ? 'Ja' : 'Nein'}`);
    if (extra.max_gruppe) extraLines.push(`Gruppen über ${extra.max_gruppe} Personen: Rückruf nötig`);
    if (extra.online_booking_url) extraLines.push(`Online-Buchung: ${extra.online_booking_url}`);
    if (extra.schwerpunkte?.length) extraLines.push(`Schwerpunkte: ${extra.schwerpunkte.join(', ')}`);
    if (extra.rechtsgebiete?.length) extraLines.push(`Rechtsgebiete: ${extra.rechtsgebiete.join(', ')}`);

    if (extraLines.length) {
      l3Parts.push(`## BRANCHENSPEZIFISCHE ANGABEN\n${extraLines.join('\n')}`);
    }
  }

  const l3 = l3Parts.join('\n\n');

  // Variablen
  const assistantName = customer.assistant_name   || 'Lara';
  const customerType  = customer.ai_customer_type || 'company';
  const addressForm   = customer.ai_address_form  || 'sie';
  const tone          = customer.ai_tone          || 'professional';
  const language      = customer.ai_language      || 'de';
  const greeting      = customer.ai_greeting      || '';
  const personName    = customer.ai_person_name   || '';
  const firmName      = customer.customer_legal_name || customer.customer_name || '';
  const displayName   = customer.customer_display_name || firmName;
  const legalName     = firmName;
  const wirOderIch    = customerType === 'company' ? 'Wir-Form' : 'Ich-Form';
  const wirMeldetSich = customerType === 'company' ? 'Wir melden uns' : 'Ich melde mich';
  const tonMap        = { formal: 'konservativ-formell', professional: 'warm-professionell', casual: 'locker und direkt' };
  const tonText       = tonMap[tone] || tonMap.professional;
  const anredeText    = addressForm === 'du' ? 'Du-Form (informell)' : 'Sie-Form (formell)';
  const autoGreeting  = greeting || buildGreeting(assistantName, customerType, personName, firmName, language);

  let prompt = l1
    // Uppercase Varianten (neu)
    .replace(/{{ASSISTANT_NAME}}/g,        assistantName)
    .replace(/{{CUSTOMER_DISPLAY_NAME}}/g, displayName)
    .replace(/{{CUSTOMER_LEGAL_NAME}}/g,   legalName)
    .replace(/{{WIR_ODER_ICH}}/g,          wirOderIch)
    .replace(/{{WIR_MELDET_SICH}}/g,       wirMeldetSich)
    .replace(/{{TON}}/g,                   tonText)
    .replace(/{{ANREDE}}/g,                anredeText)
    .replace(/{{SPRACHE}}/g,               language)
    .replace(/{{BEGRUESSUNG}}/g,           autoGreeting)
    // Lowercase Varianten (L1 v1.1)
    .replace(/{{assistant_name}}/g,        assistantName)
    .replace(/{{customer_display_name}}/g, displayName)
    .replace(/{{customer_legal_name}}/g,   legalName)
    .replace(/{{ai_summary}}/g,            customer.ai_summary || '');

  // Ersetze Platzhalter in L1 mit echten Inhalten
  let fullPrompt = prompt
    .replace(/{{INDUSTRY_LAYER}}/g, l2 || '_(kein Branchen-Layer definiert)_')
    .replace(/{{CUSTOMER_LAYER}}/g,  l3 || '_(kein Kunden-Layer definiert)_');

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
  if (lang === 'fr') {
    if (type === 'company') return `Bonjour, ici ${name} de ${firmName}. Cet appel est enregistré. Comment puis-je vous aider?`;
    if (type === 'consultant') return `Bonjour, ici ${name}, l'assistante de ${personName||firmName} chez ${firmName}. Cet appel est enregistré. Comment puis-je vous aider?`;
    return `Bonjour, ici ${name}, l'assistante de ${personName||firmName}. Cet appel est enregistré. Comment puis-je vous aider?`;
  }
  if (lang === 'it') {
    if (type === 'company') return `Buongiorno, sono ${name} di ${firmName}. La chiamata viene registrata. Come posso aiutarla?`;
    if (type === 'consultant') return `Buongiorno, sono ${name}, l'assistente di ${personName||firmName} presso ${firmName}. La chiamata viene registrata. Come posso aiutarla?`;
    return `Buongiorno, sono ${name}, l'assistente di ${personName||firmName}. La chiamata viene registrata. Come posso aiutarla?`;
  }
  if (lang === 'en') {
    if (type === 'company') return `Hello, this is ${name} from ${firmName}. This call is being recorded. How may I help you?`;
    if (type === 'consultant') return `Hello, this is ${name}, assistant to ${personName||firmName} at ${firmName}. This call is being recorded. How may I help you?`;
    return `Hello, this is ${name}, assistant to ${personName||firmName}. This call is being recorded. How may I help you?`;
  }
  if (type === 'company')    return `Grüezi, hier ist ${name} von ${firmName}. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?`;
  if (type === 'consultant') return `Grüezi, hier ist ${name}, die Assistentin von ${personName||firmName} bei ${firmName}. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?`;
  return `Grüezi, hier ist ${name}, die Assistentin von ${personName||firmName}. Das Gespräch wird zur Bearbeitung aufgezeichnet. Wie kann ich Ihnen helfen?`;
}
