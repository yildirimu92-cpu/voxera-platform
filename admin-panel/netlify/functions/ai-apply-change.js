// ai-apply-change.js
// Netlify Function — liest Kundenanfrage + aktuelle Felder,
// generiert mit Claude passende Feldänderungen (Vorher/Nachher)

const { createClient } = require('@supabase/supabase-js');

const ANTHROPIC_API_KEY    = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FIELD_LABELS = {
  ai_business_description:  'Geschäftsprofil',
  ai_services:              'Leistungen',
  ai_location_hours:        'Standort & Erreichbarkeit',
  ai_booking_faq:           'Terminlogik & FAQ',
  ai_instructions:          'Gesprächsregeln',
  ai_fallback_escalation:   'Eskalation & Fallback',
  ai_response_constraints:  'Antwortgrenzen',
  ai_greeting:              'Begrüssung',
  assistant_name:           'Assistenzname',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://admin.voxera.ch',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

exports.handler = async (event) => {
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {
    return { statusCode: 400, headers: CORS_HEADERS, body: 'Invalid JSON' };
  }

  const { customer_id, request_id, request_message } = body;
  if (!customer_id || !request_message) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'customer_id and request_message required' }) };
  }

  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 1. Lade aktuelle Kundenfelder
  const { data: customer, error: custErr } = await sb
    .from('customers')
    .select('assistant_name, ai_business_description, ai_services, ai_location_hours, ai_booking_faq, ai_instructions, ai_fallback_escalation, ai_response_constraints, ai_greeting, customer_name, ai_tone, ai_address_form, ai_language')
    .eq('id', customer_id)
    .maybeSingle();

  if (custErr || !customer) {
    return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Customer not found' }) };
  }

  // 2. Baue Kontext für Claude
  const currentFields = Object.entries(FIELD_LABELS)
    .map(([key, label]) => `${label}: ${customer[key] || '(leer)'}`)
    .join('\n');

  const systemPrompt = `Du bist ein Assistent der hilft, die Konfiguration eines KI-Telefonassistenten zu aktualisieren.

Du erhältst:
1. Die aktuellen Konfigurationsfelder des Kunden
2. Eine Änderungsanfrage des Kunden

Deine Aufgabe:
- Identifiziere welche Felder geändert werden müssen
- Generiere den neuen Inhalt passend zum bestehenden Stil und Inhalt
- Behalte den bestehenden Inhalt bei wo keine Änderung nötig ist
- Antworte NUR mit einem JSON-Objekt

Das JSON muss folgende Struktur haben:
{
  "changes": {
    "feldname": "neuer_wert"
  },
  "reasoning": "kurze Erklärung was geändert wurde"
}

Mögliche Feldnamen: ai_business_description, ai_services, ai_location_hours, ai_booking_faq, ai_instructions, ai_fallback_escalation, ai_response_constraints, ai_greeting, assistant_name

Wichtig:
- Nur Felder zurückgeben die tatsächlich geändert werden
- Neuer Inhalt muss auf Deutsch sein (ausser Sprache ist anders konfiguriert)
- Ton und Stil des bestehenden Inhalts beibehalten
- Keine Markdown-Formatierung in den Feldwerten`;

  const userPrompt = `Aktuelle Konfiguration:
${currentFields}

Änderungsanfrage des Kunden:
"${request_message}"

Generiere die notwendigen Feldänderungen als JSON.`;

  // 3. Claude API aufrufen
  let aiResult = null;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) throw new Error(`Anthropic API ${response.status}`);
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    aiResult = JSON.parse(clean);
  } catch(e) {
    console.error('[ai-apply-change] Claude error', { error: e.message });
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'AI generation failed: ' + e.message }) };
  }

  if (!aiResult?.changes || Object.keys(aiResult.changes).length === 0) {
    return { statusCode: 200, body: JSON.stringify({ success: true, changes: {}, reasoning: aiResult?.reasoning || 'Keine Änderungen nötig.' }) };
  }

  // 4. Vorher/Nachher aufbauen
  const preview = {};
  for (const [field, newVal] of Object.entries(aiResult.changes)) {
    if (FIELD_LABELS[field]) {
      preview[field] = {
        label: FIELD_LABELS[field],
        from: customer[field] || '',
        to: newVal
      };
    }
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      success: true,
      changes: aiResult.changes,
      preview,
      reasoning: aiResult.reasoning || ''
    })
  };
};
