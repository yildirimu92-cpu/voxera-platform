'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const PREVIEW_TEXT = 'Guten Tag, hier ist Ihr persönlicher Assistent von Voxera. Wie kann ich Ihnen helfen?';
const PLAN_TIERS = { starter: 1, business: 2, professional: 3 };
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (statusCode, payload) => ({
  statusCode,
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!ELEVENLABS_API_KEY) return json(500, { error: 'elevenlabs_api_key_missing' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) return json(500, { error: 'supabase_env_missing' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const caller = await requireCustomerCaller({ event, sbUrl, sbAnonKey, sbAdmin });
  if (!caller.ok) return json(caller.statusCode, caller.body);

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'invalid_body' }); }

  const voiceId = String(body.voice_id || '').trim();
  if (!voiceId) return json(400, { error: 'voice_id_required' });

  const { data: customer, error: customerError } = await sbAdmin
    .from('customers')
    .select('plan,plan_code')
    .eq('id', caller.customerId)
    .maybeSingle();
  if (customerError || !customer) return json(500, { error: 'customer_load_failed' });

  const planCode = String(customer.plan_code || customer.plan || 'starter').toLowerCase();
  const customerTier = PLAN_TIERS[planCode] || PLAN_TIERS.starter;

  const { data: voice, error: voiceError } = await sbAdmin
    .from('voxera_voices')
    .select('voice_id,available_from_plan')
    .eq('voice_id', voiceId)
    .eq('is_active', true)
    .maybeSingle();

  if (voiceError) return json(500, { error: 'voices_load_failed' });
  const requiredTier = PLAN_TIERS[String(voice?.available_from_plan || 'starter').toLowerCase()] || PLAN_TIERS.starter;
  if (!voice || requiredTier > customerTier) return json(403, { error: 'voice_not_available_on_plan' });

  try {
    const ttsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg'
        },
        body: JSON.stringify({
          text: PREVIEW_TEXT,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      }
    );

    if (!ttsResponse.ok) {
      const detail = (await ttsResponse.text()).slice(0, 500);
      return json(502, { error: 'elevenlabs_tts_failed', detail, status: ttsResponse.status });
    }

    const audioBuffer = await ttsResponse.arrayBuffer();
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, max-age=3600'
      },
      body: Buffer.from(audioBuffer).toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    return json(500, { error: error.message || 'preview_failed' });
  }
};
