'use strict';

const { createClient } = require('@supabase/supabase-js');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const PREVIEW_TEXT = 'Guten Tag, hier ist Ihr persönlicher Assistent von Voxera. Wie kann ich Ihnen helfen?';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!ELEVENLABS_API_KEY) {
    console.error('[preview-voice] ELEVENLABS_API_KEY fehlt');
    return { statusCode: 500, body: JSON.stringify({ error: 'ELEVENLABS_API_KEY fehlt' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const voiceId = String(body.voice_id || '').trim();
  if (!voiceId) return { statusCode: 400, body: JSON.stringify({ error: 'voice_id required' }) };

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: voice, error: voiceError } = await supabase
    .from('voxera_voices')
    .select('voice_id')
    .eq('voice_id', voiceId)
    .eq('is_active', true)
    .maybeSingle();

  if (voiceError) {
    console.error('[preview-voice] Supabase Fehler:', voiceError);
    return { statusCode: 500, body: JSON.stringify({ error: 'DB Fehler' }) };
  }
  if (!voice) {
    console.error('[preview-voice] Voice nicht gefunden:', voiceId);
    return { statusCode: 403, body: JSON.stringify({ error: 'Voice not available' }) };
  }

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
      const errText = await ttsResponse.text();
      console.error('[preview-voice] ElevenLabs Fehler:', ttsResponse.status, errText);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'ElevenLabs TTS fehlgeschlagen', detail: errText, status: ttsResponse.status })
      };
    }

    const audioBuffer = await ttsResponse.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');

    // Netlify hat ein 6MB Response-Limit — Audio-Preview sollte weit darunter sein (~50-100KB)
    console.log('[preview-voice] Audio-Grösse (base64):', audioBase64.length, 'bytes');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*'
      },
      body: audioBase64,
      isBase64Encoded: true
    };
  } catch (error) {
    console.error('[preview-voice] Unerwarteter Fehler:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Interner Fehler' }) };
  }
};
