const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { url } = body;
  if (!url) return { statusCode: 400, body: JSON.stringify({ error: 'url required' }) };
  if (!ANTHROPIC_API_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY' }) };

  let websiteContent = '';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Voxera/1.0)' },
      signal: AbortSignal.timeout(8000)
    });
    const html = await res.text();
    websiteContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 4000);
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Website nicht erreichbar', detail: e.message }) };
  }

  const prompt = `Analysiere folgenden Website-Inhalt eines Schweizer Unternehmens und extrahiere strukturierte Informationen.\n\nWebsite-Inhalt:\n${websiteContent}\n\nAntworte NUR mit einem JSON-Objekt (kein Markdown, keine Erklärungen):\n{\n  "company_name": "Firmenname",\n  "industry_guess": "eine von: generic, versicherung, facharzt, zahnarzt, physiotherapie, garage, hotel, restaurant, coiffeur, kosmetik, treuhand, immobilien, handwerk, reinigung, it-support, fitness, anwalt, baeckerei, digitalmarketing",\n  "short_description": "1-2 Sätze Beschreibung",\n  "services": "Hauptleistungen, kommagetrennt",\n  "location_hours": "Öffnungszeiten und Adresse falls vorhanden",\n  "address": "Adresse falls vorhanden, sonst leer",\n  "phone": "Telefonnummer falls vorhanden, sonst leer",\n  "language": "de, fr, it oder en — Hauptsprache der Website"\n}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await aiRes.json();
    const text = aiData?.content?.[0]?.text || '{}';
    const extracted = JSON.parse(text.replace(/```json|```/g, '').trim());

    return { statusCode: 200, body: JSON.stringify({ success: true, data: extracted }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'AI-Extraktion fehlgeschlagen', detail: e.message }) };
  }
};
