// Netlify Function: ai-daily-report
// Ruft Anthropic API server-side auf und gibt KI-Tagesbericht zurück
// Deployment: netlify/functions/ai-daily-report.js

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Auth check via Supabase JWT (basic)
  const authHeader = event.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { prompt } = body;
  if (!prompt || typeof prompt !== 'string' || prompt.length > 3000) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid prompt' }) };
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await resp.json();
    const text = data?.content?.[0]?.text?.trim() || null;

    if (!text) {
      return { statusCode: 502, body: JSON.stringify({ error: 'No response from AI' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    };

  } catch(e) {
    console.error('[ai-daily-report] Error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
