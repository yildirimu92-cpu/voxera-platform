// ── ai-generate.js — Voxera Netlify Function ─────────────────────────────────
// Proxy für Anthropic API — API Key bleibt sicher in Netlify ENV
// Auth: requireAdminCaller (Supabase JWT)
// ─────────────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function response(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}

async function requireAdminCaller(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Nicht autorisiert.');
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE);
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) throw new Error('Ungültiger Token.');
  const { data: admin, error: adminErr } = await sb
    .from('admins').select('id,role,status').eq('id', user.id).single();
  if (adminErr || !admin) throw new Error('Kein Admin-Zugang.');
  if (String(admin.status || '').toLowerCase() === 'disabled') throw new Error('Account deaktiviert.');
  return admin;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return response(200, {});
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  try {
    await requireAdminCaller(event);

    if (!ANTHROPIC_API_KEY) {
      return response(500, { error: 'ANTHROPIC_API_KEY nicht konfiguriert. Bitte in Netlify Environment Variables setzen.' });
    }

    const body = JSON.parse(event.body || '{}');
    const { description, fields, overwrite } = body;

    if (!description || !description.trim()) {
      return response(400, { error: 'Beschreibung fehlt.' });
    }
    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      return response(400, { error: 'Keine Felder ausgewählt.' });
    }

    // Whitelist allowed fields
    const ALLOWED_FIELDS = [
      'businessDescription', 'services', 'locationHours',
      'bookingFaq', 'instructions', 'fallbackEscalation', 'responseConstraints'
    ];
    const validFields = fields.filter(f => ALLOWED_FIELDS.includes(f));
    if (validFields.length === 0) {
      return response(400, { error: 'Ungültige Felder.' });
    }

    const fieldLabels = {
      businessDescription: 'businessDescription — Geschäftsprofil (## GESCHÄFTSPROFIL)',
      services:            'services — Leistungen (## LEISTUNGEN)',
      locationHours:       'locationHours — Standort & Erreichbarkeit (## STANDORT & ERREICHBARKEIT)',
      bookingFaq:          'bookingFaq — Terminlogik & FAQ (## TERMINLOGIK & FAQ)',
      instructions:        'instructions — Kundenspezifische Anweisungen (## KUNDENSPEZIFISCHE ANWEISUNGEN)',
      fallbackEscalation:  'fallbackEscalation — Eskalation & Fallback (## ESKALATION & FALLBACK)',
      responseConstraints: 'responseConstraints — Antwortgrenzen (## ANTWORTGRENZEN)'
    };

    const requestedFields = validFields.map(f => fieldLabels[f]).join('\n');

    const systemPrompt = `Du bist ein Experte für AI-Telefonassistenten für Schweizer KMU.
Basierend auf einer freien Unternehmensbeschreibung generierst du präzise, professionelle Prompt-Inhalte für einen Voxera AI-Assistenten namens "Lara".

Wichtige Regeln:
- Schreibe in klarem, professionellem Schweizer Hochdeutsch (kein Dialekt)
- Sei konkret und spezifisch — keine generischen Floskeln
- Passe den Ton dem Unternehmen an (Einzelperson anders als grosses Team)
- Bei "kein Büro / vor Ort / remote": erwähne nie eine feste Adresse, betone Flexibilität
- Bei Einzelperson: Geschäftsprofil kann "ich" verwenden, aber Lara spricht immer in Wir-Form
- Keine Preise erfinden wenn nicht angegeben — nur wenn explizit genannt
- Antwortgrenzen: was Lara NIE sagen oder zusagen darf
- Leistungen als einfache Liste ohne Aufzählungszeichen, eine Leistung pro Zeile
- Standort: wenn kein Büro erwähnt → "Beratung vor Ort beim Kunden oder per Video (Teams/Zoom)"
- Keine Markdown-Formatierung in den Feldwerten (kein **, keine #)

Antworte NUR mit einem JSON-Objekt. Kein erklärender Text, keine Markdown-Codeblocks.`;

    const userPrompt = `Unternehmensbeschreibung:
"${description.trim()}"

Generiere folgende Felder als JSON-Objekt:
${requestedFields}

Verwende echte Zeilenumbrüche in den Feldern (\\n) für Aufzählungen.
Gib NUR das JSON zurück, keine weiteren Erklärungen.`;

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const apiData = await apiRes.json();
    if (!apiRes.ok) {
      console.error('[ai-generate] Anthropic API error:', apiData);
      return response(500, { error: apiData?.error?.message || 'Anthropic API Fehler.' });
    }

    const raw = apiData.content?.[0]?.text || '';
    // Strip markdown fences if model wraps response
    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (_e) {
      console.error('[ai-generate] JSON parse error:', clean.slice(0, 200));
      return response(500, { error: 'AI-Antwort konnte nicht verarbeitet werden. Bitte erneut versuchen.' });
    }

    // Only return requested fields
    const result = {};
    validFields.forEach(f => {
      if (parsed[f]) result[f] = String(parsed[f]);
    });

    return response(200, { success: true, fields: result });

  } catch (err) {
    console.error('[ai-generate] error:', err.message);
    return response(err.message?.includes('autorisiert') || err.message?.includes('Token') ? 401 : 500,
      { error: err.message || 'Interner Fehler.' });
  }
};
