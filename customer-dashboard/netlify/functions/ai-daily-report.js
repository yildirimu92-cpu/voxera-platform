'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const MAX_PROMPT_LENGTH = 3000;
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey || !anthropicApiKey) {
    console.error('[ai-daily-report] server_configuration_missing');
    return response(503, { error: 'server_configuration_missing' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const caller = await requireCustomerCaller({
    event,
    sbUrl,
    sbAnonKey,
    sbAdmin,
    functionName: 'ai-daily-report'
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: 'invalid_json' });
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
    return response(400, { error: 'invalid_prompt', max_length: MAX_PROMPT_LENGTH });
  }

  try {
    const providerResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!providerResponse.ok) {
      console.error('[ai-daily-report] provider_request_failed', {
        customer_id: caller.customerId,
        status: providerResponse.status
      });
      return response(502, { error: 'report_generation_failed' });
    }

    const data = await providerResponse.json();
    const text = Array.isArray(data && data.content)
      ? String(data.content.find(block => block && block.type === 'text')?.text || '').trim()
      : '';
    if (!text) return response(502, { error: 'report_generation_failed' });

    return response(200, { text });
  } catch {
    console.error('[ai-daily-report] request_failed', { customer_id: caller.customerId });
    return response(500, { error: 'report_generation_failed' });
  }
};
