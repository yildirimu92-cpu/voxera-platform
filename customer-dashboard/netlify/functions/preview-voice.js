'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const PREVIEW_TEXT = 'Guten Tag, hier ist Ihr persönlicher Assistent von Voxera. Wie kann ich Ihnen helfen?';
const PLAN_TIERS = { starter: 1, business: 2, professional: 3 };
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const DEFAULT_PREVIEW_HOSTS = new Set([
  'storage.googleapis.com',
  'storage.googleapisusercontent.com',
  'api.elevenlabs.io',
  'elevenlabs.io',
  'www.elevenlabs.io'
]);
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (statusCode, payload) => ({
  statusCode,
  headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload)
});

function allowedPreviewHosts() {
  const configured = String(process.env.VOICE_PREVIEW_ALLOWED_HOSTS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_PREVIEW_HOSTS, ...configured]);
}

function validatedPreviewUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return '';
    if (!allowedPreviewHosts().has(parsed.hostname.toLowerCase())) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function audioContentType(value) {
  const type = String(value || '').split(';')[0].trim().toLowerCase();
  return type.startsWith('audio/') || type === 'application/octet-stream' ? type : 'audio/mpeg';
}

function audioResponse(buffer, contentType, source) {
  return {
    statusCode: 200,
    headers: {
      ...headers,
      'Content-Type': audioContentType(contentType),
      'Cache-Control': 'private, max-age=3600',
      'X-Voxera-Preview-Source': source
    },
    body: buffer.toString('base64'),
    isBase64Encoded: true
  };
}

async function loadCatalogPreview(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'audio/mpeg, audio/*, application/octet-stream' }
  });
  if (!response.ok) throw new Error(`catalog_preview_http_${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_AUDIO_BYTES) throw new Error('catalog_preview_invalid_size');
  return audioResponse(buffer, response.headers.get('content-type'), 'catalog');
}

async function synthesizePreview(voiceId, apiKey) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
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

  if (!response.ok) {
    let providerError = '';
    try { providerError = String(await response.text()).slice(0, 300); } catch { providerError = ''; }
    return json(502, {
      error: 'elevenlabs_tts_failed',
      provider_status: response.status,
      provider_error: providerError || null
    });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_AUDIO_BYTES) {
    return json(502, { error: 'elevenlabs_tts_invalid_audio' });
  }
  return audioResponse(buffer, response.headers.get('content-type'), 'generated');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) return json(500, { error: 'supabase_env_missing' });

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
    .select('voice_id,available_from_plan,preview_url')
    .eq('voice_id', voiceId)
    .eq('is_active', true)
    .maybeSingle();

  if (voiceError) return json(500, { error: 'voices_load_failed' });
  const requiredTier = PLAN_TIERS[String(voice?.available_from_plan || 'starter').toLowerCase()] || PLAN_TIERS.starter;
  if (!voice || requiredTier > customerTier) return json(403, { error: 'voice_not_available_on_plan' });

  const catalogPreviewUrl = validatedPreviewUrl(voice.preview_url);
  if (catalogPreviewUrl) {
    try {
      return await loadCatalogPreview(catalogPreviewUrl);
    } catch (error) {
      console.warn('[preview-voice] catalog_preview_fetch_failed', {
        voice_id: voiceId,
        message: error?.message || String(error)
      });
    }
  }

  const apiKey = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!apiKey) {
    return json(503, {
      error: 'voice_preview_unavailable',
      reason: catalogPreviewUrl ? 'catalog_preview_failed' : 'preview_source_missing'
    });
  }

  try {
    return await synthesizePreview(voiceId, apiKey);
  } catch (error) {
    console.error('[preview-voice] preview_failed', {
      voice_id: voiceId,
      message: error?.message || String(error)
    });
    return json(502, { error: 'voice_preview_unavailable', reason: 'provider_request_failed' });
  }
};
