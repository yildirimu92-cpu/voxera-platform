'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const PREVIEW_TEXT = 'Guten Tag, hier ist Ihr persönlicher Assistent von Voxera. Wie kann ich Ihnen helfen?';
const MAX_PREVIEW_TEXT_LENGTH = 500;
const PLAN_TIERS = { starter: 1, business: 2, professional: 3 };
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
  const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey || !elevenLabsApiKey) {
    console.error('[preview-voice] server_configuration_missing');
    return response(503, { error: 'server_configuration_missing' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: 'invalid_json' });
  }

  const voiceId = String(body.voice_id || '').trim();
  const requestText = String(body.text || '').trim();
  if (!voiceId || !/^[A-Za-z0-9_-]{1,128}$/.test(voiceId)) {
    return response(400, { error: 'invalid_voice_id' });
  }
  if (requestText.length > MAX_PREVIEW_TEXT_LENGTH) {
    return response(400, { error: 'preview_text_too_long', max_length: MAX_PREVIEW_TEXT_LENGTH });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const caller = await requireCustomerCaller({
    event,
    sbUrl,
    sbAnonKey,
    sbAdmin,
    functionName: 'preview-voice'
  });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('id, plan, plan_code')
    .eq('id', caller.customerId)
    .single();
  if (customerError) {
    console.error('[preview-voice] customer_load_failed', { customer_id: caller.customerId });
    return response(500, { error: 'customer_load_failed' });
  }

  const { data: voice, error: voiceError } = await sbAdmin
    .from('voxera_voices')
    .select('voice_id, available_from_plan')
    .eq('voice_id', voiceId)
    .eq('is_active', true)
    .maybeSingle();
  if (voiceError) {
    console.error('[preview-voice] voice_load_failed', { customer_id: caller.customerId });
    return response(500, { error: 'voice_load_failed' });
  }
  if (!voice) return response(403, { error: 'voice_not_available' });

  const planCode = String(customer.plan_code || customer.plan || 'starter').trim().toLowerCase();
  const currentTier = PLAN_TIERS[planCode] || PLAN_TIERS.starter;
  const voiceTier = PLAN_TIERS[String(voice.available_from_plan || '').trim().toLowerCase()] || Number.POSITIVE_INFINITY;
  if (voiceTier > currentTier) {
    return response(403, { error: 'voice_not_available_for_plan' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const ttsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': elevenLabsApiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg'
        },
        body: JSON.stringify({
          text: requestText || PREVIEW_TEXT,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        }),
        signal: controller.signal
      }
    );

    if (!ttsResponse.ok) {
      console.error('[preview-voice] provider_request_failed', {
        customer_id: caller.customerId,
        status: ttsResponse.status
      });
      return response(502, { error: 'voice_preview_failed' });
    }

    const audioBuffer = await ttsResponse.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'audio/mpeg'
      },
      body: audioBase64,
      isBase64Encoded: true
    };
  } catch (error) {
    const timedOut = error && error.name === 'AbortError';
    console.error('[preview-voice] request_failed', {
      customer_id: caller.customerId,
      reason: timedOut ? 'timeout' : 'unexpected_error'
    });
    return response(timedOut ? 504 : 500, { error: timedOut ? 'voice_preview_timeout' : 'voice_preview_failed' });
  } finally {
    clearTimeout(timeout);
  }
};
