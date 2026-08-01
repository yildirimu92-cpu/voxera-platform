// elevenlabs-sync-prompt.js
// Customer Dashboard proxy to the canonical admin sync implementation.
// Intentionally contains no prompt builder to avoid divergent sync logic.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_e) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { customer_id, agent_id, triggered_by = 'customer_proxy', prev_values = {} } = body;
  if (!customer_id || !agent_id) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'customer_id and agent_id required' })
    };
  }

  const adminUrl = process.env.ADMIN_URL || 'https://admin.voxera.ch';
  try {
    const authorization = event.headers?.authorization || event.headers?.Authorization || '';
    const upstreamRes = await fetch(`${adminUrl}/.netlify/functions/trigger-elevenlabs-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({ customer_id, agent_id, triggered_by, prev_values })
    });
    const upstreamBody = await upstreamRes.text();
    return {
      statusCode: upstreamRes.status,
      headers: CORS_HEADERS,
      body: upstreamBody
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: e.message || 'sync_proxy_failed' })
    };
  }
};
