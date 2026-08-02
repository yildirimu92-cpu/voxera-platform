'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const DEFAULT_PREVIEW_TEXT = 'Grüezi, ich bin Ihre digitale Telefonassistenz von Voxera. Ich nehme Ihre Anrufe freundlich und zuverlässig entgegen. Wie kann ich Ihnen helfen?';
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

function environmentHost(value) {
  try { return new URL(String(value || '')).hostname.toLowerCase(); }
  catch { return ''; }
}

function allowedPreviewHosts() {
  const configured = String(process.env.VOICE_PREVIEW_ALLOWED_HOSTS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const supabaseHost = environmentHost(process.env.SUPABASE_URL);
  return new Set([...DEFAULT_PREVIEW_HOSTS, ...configured, ...(supabaseHost ? [supabaseHost] : [])]);
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

function normalizedAudioContentType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function isAcceptedAudioContentType(value) {
  const type = normalizedAudioContentType(value);
  return type.startsWith('audio/') || type === 'application/octet-stream';
}

function detectAudioContentType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return '';

  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg';
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
  if (buffer.subarray(0, 4).toString('ascii') === 'fLaC') return 'audio/flac';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'audio/mp4';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'FORM') return 'audio/aiff';

  return '';
}

function resolveAudioContentType(headerValue, buffer) {
  const detected = detectAudioContentType(buffer);
  if (detected) return detected;
  const declared = normalizedAudioContentType(headerValue);
  return isAcceptedAudioContentType(declared) ? declared : '';
}

function audioResponse(buffer, contentType, source) {
  return {
    statusCode: 200,
    headers: {
      ...headers,
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
      'X-Voxera-Preview-Source': source
    },
    body: buffer.toString('base64'),
    isBase64Encoded: true
  };
}

function providerErrorCode(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const detail = payload.detail;
  if (detail && typeof detail === 'object') {
    return String(detail.status || detail.code || '').trim();
  }
  return String(payload.status || payload.code || '').trim();
}

async function readProviderError(response) {
  let payload = null;
  let text = '';
  try {
    text = String(await response.text()).slice(0, 500);
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return {
    provider_status: response.status,
    provider_code: providerErrorCode(payload) || null,
    provider_error: text || null
  };
}

async function loadCatalogPreview(url, source = 'catalog') {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'audio/mpeg, audio/*, application/octet-stream' }
  });
  if (!response.ok) throw new Error(`catalog_preview_http_${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_AUDIO_BYTES) throw new Error('catalog_preview_invalid_size');

  const declaredType = response.headers.get('content-type');
  const resolvedType = resolveAudioContentType(declaredType, buffer);
  if (!resolvedType) {
    throw new Error(`catalog_preview_invalid_content_type_${normalizedAudioContentType(declaredType) || 'missing'}`);
  }

  if (!isAcceptedAudioContentType(declaredType) && detectAudioContentType(buffer)) {
    console.warn('[preview-voice] catalog_preview_mislabeled_content_type', {
      source,
      declared_content_type: normalizedAudioContentType(declaredType) || null,
      detected_content_type: resolvedType
    });
  }

  return audioResponse(buffer, resolvedType, source);
}

async function loadElevenLabsMetadataPreview(voiceId, apiKey) {
  const requestHeaders = { Accept: 'application/json' };
  if (apiKey) requestHeaders['xi-api-key'] = apiKey;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`,
    { method: 'GET', headers: requestHeaders }
  );

  if (!response.ok) {
    const error = new Error(`elevenlabs_voice_lookup_http_${response.status}`);
    error.provider = await readProviderError(response);
    throw error;
  }

  let payload = {};
  try { payload = await response.json(); }
  catch { throw new Error('elevenlabs_voice_lookup_invalid_json'); }

  const previewUrl = validatedPreviewUrl(payload.preview_url);
  if (!previewUrl) throw new Error('elevenlabs_voice_preview_url_missing');
  return loadCatalogPreview(previewUrl, 'elevenlabs-metadata');
}

async function synthesizePreview(voiceId, apiKey, metadataFailure, previewText) {
  const safePreviewText = String(previewText || DEFAULT_PREVIEW_TEXT).trim().slice(0, 500) || DEFAULT_PREVIEW_TEXT;
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
        text: safePreviewText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    }
  );

  if (!response.ok) {
    const provider = await readProviderError(response);
    return json(502, {
      error: 'elevenlabs_tts_failed',
      ...provider,
      metadata_status: metadataFailure?.provider?.provider_status || null,
      metadata_code: metadataFailure?.provider?.provider_code || null
    });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_AUDIO_BYTES) {
    return json(502, { error: 'elevenlabs_tts_invalid_audio' });
  }

  const declaredType = response.headers.get('content-type');
  const resolvedType = resolveAudioContentType(declaredType, buffer);
  if (!resolvedType) {
    return json(502, {
      error: 'elevenlabs_tts_invalid_content_type',
      provider_content_type: normalizedAudioContentType(declaredType) || null
    });
  }

  return audioResponse(buffer, resolvedType, 'generated');
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
    .select('voice_id,available_from_plan,preview_url,preview_text')
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
  let metadataFailure = null;
  try {
    return await loadElevenLabsMetadataPreview(voiceId, apiKey);
  } catch (error) {
    metadataFailure = error;
    console.warn('[preview-voice] elevenlabs_voice_preview_lookup_failed', {
      voice_id: voiceId,
      message: error?.message || String(error),
      provider_status: error?.provider?.provider_status || null,
      provider_code: error?.provider?.provider_code || null
    });
  }

  if (!apiKey) {
    return json(503, {
      error: 'voice_preview_unavailable',
      reason: catalogPreviewUrl ? 'catalog_preview_failed' : 'preview_source_missing',
      metadata_status: metadataFailure?.provider?.provider_status || null,
      metadata_code: metadataFailure?.provider?.provider_code || null
    });
  }

  try {
    return await synthesizePreview(voiceId, apiKey, metadataFailure, voice.preview_text);
  } catch (error) {
    console.error('[preview-voice] preview_failed', {
      voice_id: voiceId,
      message: error?.message || String(error)
    });
    return json(502, { error: 'voice_preview_unavailable', reason: 'provider_request_failed' });
  }
};

exports._test = { environmentHost, allowedPreviewHosts, validatedPreviewUrl, detectAudioContentType, resolveAudioContentType };
