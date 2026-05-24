function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    },
    body: JSON.stringify(payload)
  };
}

function getConversationId(event) {
  const query = event.queryStringParameters || {};
  if (query.conversation_id) return String(query.conversation_id).trim();
  if (query.conversationId) return String(query.conversationId).trim();
  if (!event.body) return '';
  try {
    const body = JSON.parse(event.body);
    return String(body.conversation_id || body.conversationId || body.elevenlabs_conversation_id || '').trim();
  } catch {
    return '';
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization' }, body: '' };
  }

  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }

  const conversationId = getConversationId(event);
  if (!conversationId) {
    return json(400, { ok: false, error: 'missing_conversation_id' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY || '';
  if (!apiKey) {
    return json(500, { ok: false, error: 'missing_elevenlabs_api_key' });
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}/audio`, {
    headers: { 'xi-api-key': apiKey, accept: 'audio/mpeg, audio/*, application/octet-stream' }
  });

  if (!res.ok) {
    const details = await res.text().catch(() => '');
    return json(502, { ok: false, error: 'elevenlabs_audio_fetch_failed', status: res.status, details: details.slice(0, 300) });
  }

  const contentType = res.headers.get('content-type') || 'audio/mpeg';
  const buffer = Buffer.from(await res.arrayBuffer());

  if (event.httpMethod === 'GET') {
    return { statusCode: 200, headers: { 'content-type': contentType, 'cache-control': 'no-store', 'access-control-allow-origin': '*' }, isBase64Encoded: true, body: buffer.toString('base64') };
  }

  return json(200, { ok: true, audio_url: `data:${contentType};base64,${buffer.toString('base64')}`, source: 'elevenlabs_data_url' });
};
