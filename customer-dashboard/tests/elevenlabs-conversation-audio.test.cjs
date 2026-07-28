'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../netlify/functions/elevenlabs-conversation-audio.js');

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  ELEVENLABS_API_KEY: 'elevenlabs-test'
};

function event({ token = 'valid-token', conversationId = 'conv-1', method = 'GET', origin = 'https://dashboard.voxera.ch' } = {}) {
  const headers = { origin };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return {
    httpMethod: method,
    headers,
    queryStringParameters: { conversation_id: conversationId }
  };
}

function queryResult(result) {
  return {
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => result
  };
}

function makeHarness({ authUserId = 'user-1', authError = null, userRow = { id: 'user-1', customer_id: 'cust-1' }, userError = null, adminRow = null, adminError = null, callRow = { id: 'call-1', customer_id: 'cust-1', elevenlabs_conversation_id: 'conv-1' }, callError = null, providerOk = true, providerStatus = 200 } = {}) {
  let providerCalls = 0;
  const authClient = {
    auth: {
      getUser: async () => ({
        data: authUserId ? { user: { id: authUserId } } : { user: null },
        error: authError
      })
    }
  };
  const adminClient = {
    from(table) {
      if (table === 'users') return queryResult({ data: userRow, error: userError });
      if (table === 'admins') return queryResult({ data: adminRow, error: adminError });
      if (table === 'calls') return queryResult({ data: callRow, error: callError });
      throw new Error(`Unexpected table: ${table}`);
    }
  };
  const createClientFn = (_url, key) => key === ENV.SUPABASE_ANON_KEY ? authClient : adminClient;
  const fetchFn = async () => {
    providerCalls += 1;
    return {
      ok: providerOk,
      status: providerStatus,
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
      text: async () => 'provider response must not leak'
    };
  };
  return {
    handler: createHandler({ createClientFn, fetchFn, env: ENV }),
    providerCalls: () => providerCalls
  };
}

function body(response) {
  return JSON.parse(response.body || '{}');
}

test('Request ohne Token liefert 401 und ruft ElevenLabs nicht auf', async () => {
  const h = makeHarness();
  const response = await h.handler(event({ token: null }));
  assert.equal(response.statusCode, 401);
  assert.equal(body(response).error, 'auth_token_missing');
  assert.equal(h.providerCalls(), 0);
});

test('ungültiger Token liefert 401', async () => {
  const h = makeHarness({ authUserId: null, authError: { message: 'invalid' } });
  const response = await h.handler(event({ token: 'invalid' }));
  assert.equal(response.statusCode, 401);
  assert.equal(body(response).error, 'auth_token_invalid');
  assert.equal(h.providerCalls(), 0);
});

test('Benutzer ohne customer_id und ohne Adminrolle liefert 403', async () => {
  const h = makeHarness({ userRow: { id: 'user-1', customer_id: null }, adminRow: null });
  const response = await h.handler(event());
  assert.equal(response.statusCode, 403);
  assert.equal(body(response).error, 'customer_context_missing');
  assert.equal(h.providerCalls(), 0);
});

test('fremde conversation_id liefert 403', async () => {
  const h = makeHarness({ callRow: { id: 'call-2', customer_id: 'cust-2', elevenlabs_conversation_id: 'conv-1' } });
  const response = await h.handler(event());
  assert.equal(response.statusCode, 403);
  assert.equal(body(response).error, 'tenant_access_denied');
  assert.equal(h.providerCalls(), 0);
});

test('unbekannte conversation_id liefert 404', async () => {
  const h = makeHarness({ callRow: null });
  const response = await h.handler(event());
  assert.equal(response.statusCode, 404);
  assert.equal(body(response).error, 'call_not_found');
  assert.equal(h.providerCalls(), 0);
});

test('eigener Call liefert Audio', async () => {
  const h = makeHarness();
  const response = await h.handler(event());
  assert.equal(response.statusCode, 200);
  assert.equal(response.isBase64Encoded, true);
  assert.equal(response.headers['access-control-allow-origin'], 'https://dashboard.voxera.ch');
  assert.equal(h.providerCalls(), 1);
});

test('aktive serverseitig verifizierte Adminrolle darf fremden Call laden', async () => {
  const h = makeHarness({
    userRow: null,
    adminRow: { id: 'user-1', role: 'admin', status: 'active' },
    callRow: { id: 'call-2', customer_id: 'cust-2', elevenlabs_conversation_id: 'conv-1' }
  });
  const response = await h.handler(event());
  assert.equal(response.statusCode, 200);
  assert.equal(h.providerCalls(), 1);
});

test('ElevenLabs-Fehler liefert 502 ohne Provider-Body oder Audio-Daten', async () => {
  const h = makeHarness({ providerOk: false, providerStatus: 503 });
  const response = await h.handler(event());
  const payload = body(response);
  assert.equal(response.statusCode, 502);
  assert.equal(payload.error, 'elevenlabs_audio_fetch_failed');
  assert.equal(payload.provider_status, 503);
  assert.equal('details' in payload, false);
  assert.equal(response.body.includes('provider response must not leak'), false);
  assert.equal(h.providerCalls(), 1);
});

test('nicht erlaubte Origin liefert 403 ohne Wildcard-CORS', async () => {
  const h = makeHarness();
  const response = await h.handler(event({ origin: 'https://attacker.example' }));
  assert.equal(response.statusCode, 403);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.equal(h.providerCalls(), 0);
});
