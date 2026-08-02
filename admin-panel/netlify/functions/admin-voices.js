'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const BUCKET = 'voice-previews';
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const DEFAULT_PREVIEW_TEXT = 'Grüezi, ich bin Ihre digitale Telefonassistenz von Voxera. Ich nehme Ihre Anrufe freundlich und zuverlässig entgegen. Wie kann ich Ihnen helfen?';
const PLAN_TIERS = new Set(['starter', 'business', 'professional']);
const GENDERS = new Set(['female', 'male', 'neutral']);
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

const respond = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });
const text = (value, max = 500) => String(value == null ? '' : value).trim().slice(0, max);
const bool = (value, fallback = false) => value === true || value === 'true' ? true : value === false || value === 'false' ? false : fallback;

function normalizePreviewText(value) {
  return text(value || DEFAULT_PREVIEW_TEXT, 500).replace(/\s+/g, ' ');
}

function validVoiceId(value) {
  return /^[A-Za-z0-9_-]{8,80}$/.test(String(value || ''));
}

function detectMp3(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return false;
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return true;
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

async function providerError(response) {
  let raw = '';
  try { raw = String(await response.text()).slice(0, 500); } catch { raw = ''; }
  let code = '';
  try {
    const payload = raw ? JSON.parse(raw) : null;
    code = String(payload?.detail?.status || payload?.detail?.code || payload?.status || payload?.code || '');
  } catch { code = ''; }
  return { provider_status: response.status, provider_code: code || null, provider_error: raw || null };
}

async function audit(sbAdmin, caller, action, metadata) {
  try {
    await sbAdmin.from('commercial_lifecycle_audit').insert({
      actor_admin_id: caller.userId,
      actor_role: caller.role,
      action,
      metadata,
      happened_at: new Date().toISOString()
    });
  } catch (_error) {
    // Voice administration must not fail because an optional audit sink is unavailable.
  }
}

async function listVoices(sbAdmin) {
  const { data: voices, error: voicesError } = await sbAdmin
    .from('voxera_voices')
    .select('voice_id,display_name,description,gender,language,preview_url,preview_text,is_default,available_from_plan,sort_order,is_active')
    .order('sort_order', { ascending: true })
    .order('display_name', { ascending: true });
  if (voicesError) return { error: voicesError };

  const { data: assignments, error: assignmentsError } = await sbAdmin
    .from('customers')
    .select('voice_id')
    .not('voice_id', 'is', null);
  if (assignmentsError) return { error: assignmentsError };

  const counts = new Map();
  for (const row of assignments || []) {
    const id = String(row.voice_id || '');
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }

  return {
    data: (voices || []).map((voice) => ({
      ...voice,
      preview_text: voice.preview_text || DEFAULT_PREVIEW_TEXT,
      assigned_customers: counts.get(String(voice.voice_id)) || 0
    }))
  };
}

function normalizeVoiceUpdate(body) {
  const voiceId = text(body.voice_id, 80);
  const gender = text(body.gender, 20).toLowerCase();
  const plan = text(body.available_from_plan, 30).toLowerCase();
  const previewText = normalizePreviewText(body.preview_text);
  return {
    voiceId,
    payload: {
      display_name: text(body.display_name, 80),
      description: text(body.description, 300) || null,
      gender,
      language: text(body.language, 80) || null,
      available_from_plan: plan,
      sort_order: Math.max(0, Math.min(9999, Math.trunc(Number(body.sort_order || 0)))),
      is_active: bool(body.is_active, true),
      is_default: bool(body.is_default, false),
      preview_text: previewText
    }
  };
}

function validateVoiceUpdate(row) {
  if (!validVoiceId(row.voiceId)) return 'Die Voice-ID ist ungültig.';
  if (!row.payload.display_name) return 'Der Anzeigename ist erforderlich.';
  if (!GENDERS.has(row.payload.gender)) return 'Das Geschlecht muss female, male oder neutral sein.';
  if (!PLAN_TIERS.has(row.payload.available_from_plan)) return 'Die Tarifstufe ist ungültig.';
  if (row.payload.preview_text.length < 20) return 'Der Vorschautext muss mindestens 20 Zeichen enthalten.';
  if (row.payload.is_default && !row.payload.is_active) return 'Die Standardstimme muss aktiv sein.';
  return null;
}

async function updateVoice(sbAdmin, caller, body) {
  const normalized = normalizeVoiceUpdate(body);
  const validationError = validateVoiceUpdate(normalized);
  if (validationError) return respond(400, { success: false, error: validationError });

  const { data: existing, error: existingError } = await sbAdmin
    .from('voxera_voices')
    .select('voice_id,is_active,is_default')
    .eq('voice_id', normalized.voiceId)
    .maybeSingle();
  if (existingError) return respond(500, { success: false, error: existingError.message });
  if (!existing) return respond(404, { success: false, error: 'Stimme wurde nicht gefunden.' });

  if (normalized.payload.is_default) {
    const { error: clearError } = await sbAdmin
      .from('voxera_voices')
      .update({ is_default: false })
      .neq('voice_id', normalized.voiceId);
    if (clearError) return respond(500, { success: false, error: clearError.message });
  }

  const { data: voice, error } = await sbAdmin
    .from('voxera_voices')
    .update(normalized.payload)
    .eq('voice_id', normalized.voiceId)
    .select('voice_id,display_name,description,gender,language,preview_url,preview_text,is_default,available_from_plan,sort_order,is_active')
    .single();
  if (error) return respond(500, { success: false, error: error.message });

  await audit(sbAdmin, caller, 'voice_catalog.update', {
    voice_id: normalized.voiceId,
    is_active: voice.is_active,
    is_default: voice.is_default,
    available_from_plan: voice.available_from_plan
  });

  return respond(200, { success: true, voice });
}

async function ensureVoiceExists(sbAdmin, voiceId) {
  const { data, error } = await sbAdmin
    .from('voxera_voices')
    .select('voice_id,display_name')
    .eq('voice_id', voiceId)
    .maybeSingle();
  return { voice: data || null, error };
}

async function synthesizeMp3(voiceId, previewText, apiKey) {
  let response;
  try {
    response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg'
        },
        body: JSON.stringify({
          text: previewText,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      }
    );
  } catch (error) {
    return { error: { statusCode: 502, payload: { success: false, error: 'ElevenLabs ist momentan nicht erreichbar.', detail: error.message } } };
  }

  if (!response.ok) {
    return {
      error: {
        statusCode: 502,
        payload: { success: false, error: 'ElevenLabs konnte die Vorschau nicht erzeugen.', ...(await providerError(response)) }
      }
    };
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length || audio.length > MAX_AUDIO_BYTES || !detectMp3(audio)) {
    return { error: { statusCode: 502, payload: { success: false, error: 'ElevenLabs hat keine gültige MP3-Vorschau geliefert.' } } };
  }
  return { audio };
}

async function testPreview(sbAdmin, body) {
  const voiceId = text(body.voice_id, 80);
  const previewText = normalizePreviewText(body.preview_text);
  if (!validVoiceId(voiceId)) return respond(400, { success: false, error: 'Die Voice-ID ist ungültig.' });
  if (previewText.length < 20) return respond(400, { success: false, error: 'Der Vorschautext muss mindestens 20 Zeichen enthalten.' });

  const lookup = await ensureVoiceExists(sbAdmin, voiceId);
  if (lookup.error) return respond(500, { success: false, error: lookup.error.message });
  if (!lookup.voice) return respond(404, { success: false, error: 'Stimme wurde nicht gefunden.' });

  const apiKey = text(process.env.ELEVENLABS_API_KEY, 500);
  if (!apiKey) return respond(500, { success: false, error: 'ELEVENLABS_API_KEY fehlt.' });

  const result = await synthesizeMp3(voiceId, previewText, apiKey);
  if (result.error) return respond(result.error.statusCode, result.error.payload);
  return respond(200, {
    success: true,
    voice_id: voiceId,
    content_type: 'audio/mpeg',
    audio_base64: result.audio.toString('base64')
  });
}

async function generatePreview(sbAdmin, caller, body) {
  const voiceId = text(body.voice_id, 80);
  const previewText = normalizePreviewText(body.preview_text);
  if (!validVoiceId(voiceId)) return respond(400, { success: false, error: 'Die Voice-ID ist ungültig.' });
  if (previewText.length < 20) return respond(400, { success: false, error: 'Der Vorschautext muss mindestens 20 Zeichen enthalten.' });

  const lookup = await ensureVoiceExists(sbAdmin, voiceId);
  if (lookup.error) return respond(500, { success: false, error: lookup.error.message });
  if (!lookup.voice) return respond(404, { success: false, error: 'Stimme wurde nicht gefunden.' });

  const apiKey = text(process.env.ELEVENLABS_API_KEY, 500);
  if (!apiKey) return respond(500, { success: false, error: 'ELEVENLABS_API_KEY fehlt.' });

  const result = await synthesizeMp3(voiceId, previewText, apiKey);
  if (result.error) return respond(result.error.statusCode, result.error.payload);

  // A unique object path prevents Supabase/CDN caches from serving the previous audio.
  const objectPath = `${voiceId}/preview-${Date.now()}.mp3`;
  const { error: uploadError } = await sbAdmin.storage
    .from(BUCKET)
    .upload(objectPath, result.audio, {
      contentType: 'audio/mpeg',
      cacheControl: '86400',
      upsert: false
    });
  if (uploadError) return respond(500, { success: false, error: `Vorschau konnte nicht gespeichert werden: ${uploadError.message}` });

  const publicResult = sbAdmin.storage.from(BUCKET).getPublicUrl(objectPath);
  const previewUrl = String(publicResult?.data?.publicUrl || '').trim();
  if (!previewUrl) return respond(500, { success: false, error: 'Öffentliche Vorschau-URL konnte nicht erzeugt werden.' });

  const { data: updated, error: updateError } = await sbAdmin
    .from('voxera_voices')
    .update({ preview_url: previewUrl, preview_text: previewText })
    .eq('voice_id', voiceId)
    .select('voice_id,display_name,description,gender,language,preview_url,preview_text,is_default,available_from_plan,sort_order,is_active')
    .single();
  if (updateError) return respond(500, { success: false, error: updateError.message });

  await audit(sbAdmin, caller, 'voice_catalog.preview.generate', {
    voice_id: voiceId,
    preview_text_length: previewText.length,
    storage_bucket: BUCKET,
    storage_path: objectPath
  });

  return respond(200, { success: true, voice: updated, preview_url: previewUrl });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return respond(405, { success: false, error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) return respond(500, { success: false, error: 'Supabase-Konfiguration fehlt.' });

  const sbAdmin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireAdminCaller({
    event,
    supabaseUrl,
    supabaseAnonKey: anonKey,
    sbAdmin,
    requiredCapability: 'plan:write'
  });
  if (!caller.ok) return respond(caller.statusCode, caller.body);

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { success: false, error: 'Ungültiger Request Body.' }); }

  const action = text(body.action, 40).toLowerCase();
  if (action === 'list') {
    const result = await listVoices(sbAdmin);
    if (result.error) return respond(500, { success: false, error: result.error.message });
    return respond(200, { success: true, voices: result.data, default_preview_text: DEFAULT_PREVIEW_TEXT });
  }
  if (action === 'update') return updateVoice(sbAdmin, caller, body);
  if (action === 'test_preview') return testPreview(sbAdmin, body);
  if (action === 'generate_preview') return generatePreview(sbAdmin, caller, body);

  return respond(400, { success: false, error: 'Unbekannte Aktion.' });
};

exports._test = { normalizePreviewText, validVoiceId, detectMp3, normalizeVoiceUpdate, validateVoiceUpdate };
