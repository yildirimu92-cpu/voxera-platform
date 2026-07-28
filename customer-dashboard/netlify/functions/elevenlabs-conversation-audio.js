'use strict';

const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  'https://dashboard.voxera.ch',
  'https://admin.voxera.ch',
  'https://voxera.ch'
]);

const ACTIVE_ADMIN_ROLES = new Set(['owner', 'admin', 'support', 'super-admin', 'superadmin', 'ops']);
const ACTIVE_ADMIN_STATUSES = new Set(['active', 'enabled']);

function getHeader(headers, name) {
  const source = headers || {};
  const target = String(name || '').toLowerCase();
  const key = Object.keys(source).find(candidate => String(candidate).toLowerCase() === target);
  return key ? String(source[key] || '').trim() : '';
}

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['https:', 'http:'].includes(parsed.protocol)) return '';
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function getAllowedOrigins(env) {
  const configured = String((env && env.VOXERA_ALLOWED_ORIGINS) || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function resolveCors(event, env) {
  const origin = normalizeOrigin(getHeader(event && event.headers, 'origin'));
  if (!origin) return { allowed: true, headers: {} };
  if (!getAllowedOrigins(env).has(origin)) return { allowed: false, headers: {} };
  return {
    allowed: true,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
      vary: 'Origin'
    }
  };
}

function json(statusCode, payload, corsHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders
    },
    body: JSON.stringify(payload)
  };
}

function getBearerToken(headers) {
  const value = getHeader(headers, 'authorization');
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? String(match[1] || '').trim() : '';
}

function getConversationId(event) {
  const query = (event && event.queryStringParameters) || {};
  if (query.conversation_id) return String(query.conversation_id).trim();
  if (query.conversationId) return String(query.conversationId).trim();
  if (!event || !event.body) return '';
  try {
    const body = JSON.parse(event.body);
    return String(body.conversation_id || body.conversationId || body.elevenlabs_conversation_id || '').trim();
  } catch {
    return '';
  }
}

function isActiveAdmin(adminRow) {
  if (!adminRow) return false;
  const role = String(adminRow.role || '').trim().toLowerCase().replace(/_/g, '-');
  const status = String(adminRow.status || 'active').trim().toLowerCase().replace(/_/g, '-');
  return ACTIVE_ADMIN_ROLES.has(role) && ACTIVE_ADMIN_STATUSES.has(status);
}

function safeAudioContentType(value) {
  const contentType = String(value || '').split(';')[0].trim().toLowerCase();
  if (contentType.startsWith('audio/')) return contentType;
  if (contentType === 'application/octet-stream') return contentType;
  return 'audio/mpeg';
}

function defaultCreateClient(...args) {
  // Lazy import keeps the handler unit-testable without loading external dependencies.
  return require('@supabase/supabase-js').createClient(...args);
}

function createHandler({ createClientFn = defaultCreateClient, fetchFn = global.fetch, env = process.env } = {}) {
  return async function handler(event = {}) {
    const cors = resolveCors(event, env);
    if (!cors.allowed) {
      return json(403, { ok: false, error: 'origin_not_allowed' });
    }

    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: cors.headers, body: '' };
    }

    if (!['GET', 'POST'].includes(event.httpMethod)) {
      return json(405, { ok: false, error: 'method_not_allowed' }, cors.headers);
    }

    const token = getBearerToken(event.headers);
    if (!token) {
      return json(401, { ok: false, error: 'auth_token_missing' }, cors.headers);
    }

    const conversationId = getConversationId(event);
    if (!conversationId) {
      return json(400, { ok: false, error: 'missing_conversation_id' }, cors.headers);
    }

    const supabaseUrl = String(env.SUPABASE_URL || '').trim();
    const supabaseAnonKey = String(env.SUPABASE_ANON_KEY || '').trim();
    const supabaseServiceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return json(500, { ok: false, error: 'server_configuration_missing' }, cors.headers);
    }

    const authClient = createClientFn(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    const authUserId = authData && authData.user && authData.user.id;
    if (authError || !authUserId) {
      return json(401, { ok: false, error: 'auth_token_invalid' }, cors.headers);
    }

    const sbAdmin = createClientFn(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: userRow, error: userError } = await sbAdmin
      .from('users')
      .select('id, customer_id')
      .eq('id', authUserId)
      .maybeSingle();

    if (userError) {
      return json(500, { ok: false, error: 'user_lookup_failed' }, cors.headers);
    }

    let adminAccess = false;
    if (!userRow || !userRow.customer_id) {
      const { data: adminRow, error: adminError } = await sbAdmin
        .from('admins')
        .select('id, role, status')
        .eq('id', authUserId)
        .maybeSingle();

      if (adminError) {
        return json(500, { ok: false, error: 'admin_lookup_failed' }, cors.headers);
      }
      adminAccess = isActiveAdmin(adminRow);
      if (!adminAccess) {
        return json(403, { ok: false, error: 'customer_context_missing' }, cors.headers);
      }
    }

    const { data: callRow, error: callError } = await sbAdmin
      .from('calls')
      .select('id, customer_id, elevenlabs_conversation_id')
      .eq('elevenlabs_conversation_id', conversationId)
      .maybeSingle();

    if (callError) {
      return json(500, { ok: false, error: 'call_lookup_failed' }, cors.headers);
    }
    if (!callRow) {
      return json(404, { ok: false, error: 'call_not_found' }, cors.headers);
    }

    if (!adminAccess && String(callRow.customer_id || '') !== String(userRow.customer_id || '')) {
      return json(403, { ok: false, error: 'tenant_access_denied' }, cors.headers);
    }

    const apiKey = String(env.ELEVENLABS_API_KEY || '').trim();
    if (!apiKey) {
      return json(500, { ok: false, error: 'server_configuration_missing' }, cors.headers);
    }

    let providerResponse;
    try {
      providerResponse = await fetchFn(
        `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}/audio`,
        { headers: { 'xi-api-key': apiKey, accept: 'audio/mpeg, audio/*, application/octet-stream' } }
      );
    } catch {
      return json(502, { ok: false, error: 'elevenlabs_audio_fetch_failed' }, cors.headers);
    }

    if (!providerResponse.ok) {
      return json(502, {
        ok: false,
        error: 'elevenlabs_audio_fetch_failed',
        provider_status: providerResponse.status
      }, cors.headers);
    }

    const contentType = safeAudioContentType(providerResponse.headers && providerResponse.headers.get('content-type'));
    const buffer = Buffer.from(await providerResponse.arrayBuffer());

    if (event.httpMethod === 'GET') {
      return {
        statusCode: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'no-store',
          ...cors.headers
        },
        isBase64Encoded: true,
        body: buffer.toString('base64')
      };
    }

    return json(200, {
      ok: true,
      audio_url: `data:${contentType};base64,${buffer.toString('base64')}`,
      source: 'elevenlabs_data_url'
    }, cors.headers);
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
exports._test = {
  getBearerToken,
  getConversationId,
  getAllowedOrigins,
  resolveCors,
  isActiveAdmin,
  safeAudioContentType
};
