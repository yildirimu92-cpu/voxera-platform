'use strict';

const { createClient } = require('@supabase/supabase-js');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const PREVIEW_TEXT = 'Guten Tag, hier ist Ihr persönlicher Assistent von Voxera. Wie kann ich Ihnen helfen?';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!ELEVENLABS_API_KEY) return { statusCode: 500, body: 'ELEVENLABS_API_KEY fehlt' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const voiceId = String(body.voice_id || '').trim();
  if (!voiceId) return { statusCode: 400, body: 'voice_id required' };

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: voice, error: voiceError } = await supabase
    .from('voxera_voices')
    .select('voice_id')
    .eq('voice_id', voiceId)
    .eq('is_active', true)
    .maybeSingle();

  if (voiceError || !voice) return { statusCode: 403, body: 'Voice not available' };

  try {
    const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
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
    });

    if (!ttsResponse.ok) return { statusCode: 502, body: 'ElevenLabs TTS fehlgeschlagen' };

    const audioBuffer = await ttsResponse.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=3600' },
      body: audioBase64,
      isBase64Encoded: true
    };
  } catch (error) {
    console.error('[preview-voice] Fehler:', error);
    return { statusCode: 500, body: 'Interner Fehler' };
  }
};
