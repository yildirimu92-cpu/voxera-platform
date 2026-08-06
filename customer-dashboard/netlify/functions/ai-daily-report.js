// Netlify Function: ai-daily-report
// Ruft Anthropic API server-side auf und gibt KI-Tagesbericht zurück
// Deployment: netlify/functions/ai-daily-report.js

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return response(405, { error: 'Method Not Allowed' });
  }

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, { error: 'supabase_env_missing' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin, functionName: 'ai-daily-report' });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  if (!ANTHROPIC_API_KEY) {
    return response(500, { error: 'API key not configured' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return response(400, { error: 'Invalid JSON' });
  }

  const { prompt } = body;
  if (!prompt || typeof prompt !== 'string' || prompt.length > 3000) {
    return response(400, { error: 'Invalid prompt' });
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
      return response(502, { error: 'No response from AI' });
    }

    return response(200, { text });

  } catch (e) {
    console.error('[ai-daily-report] Error:', e.message);
    return response(500, { error: e.message });
  }
};
