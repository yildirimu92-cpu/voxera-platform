'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationAudioClient } = require('../shared/offer-brand.js');

function authClient(session, error = null) {
  return { auth: { getSession: async () => ({ data: { session }, error }) } };
}

function harness({ session = { access_token: 'access-token' }, responseStatus = 200 } = {}) {
  const calls = [];
  const revoked = [];
  const blob = { type: 'audio/mpeg', size: 3 };
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: responseStatus >= 200 && responseStatus < 300,
      status: responseStatus,
      blob: async () => blob
    };
  };
  const urlApi = {
    createObjectURL: value => {
      assert.equal(value, blob);
      return 'blob:new-audio';
    },
    revokeObjectURL: value => revoked.push(value)
  };
  const client = ConversationAudioClient.createConversationAudioClient({
    authClient: authClient(session),
    fetchFn,
    urlApi
  });
  return { client, calls, revoked, blob };
}

test('Session fehlt', async () => {
  const { client, calls } = harness({ session: null });
  await assert.rejects(
    client.loadAudio({ conversationId: 'conv-1' }),
    error => error.code === 'session_missing' && error.status === 401
  );
  assert.equal(calls.length, 0);
});

test('Access Token fehlt', async () => {
  const { client, calls } = harness({ session: {} });
  await assert.rejects(
    client.loadAudio({ conversationId: 'conv-1' }),
    error => error.code === 'access_token_missing' && error.status === 401
  );
  assert.equal(calls.length, 0);
});

test('Bearer-Header wird korrekt gesetzt', async () => {
  const { client, calls } = harness();
  await client.loadAudio({ conversationId: 'conv / 1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer access-token');
  assert.match(calls[0].url, /conversation_id=conv%20%2F%201$/);
});

test('erfolgreiche Antwort wird als Blob-URL bereitgestellt', async () => {
  const { client, blob } = harness();
  const result = await client.loadAudio({ conversationId: 'conv-1' });
  assert.equal(result.objectUrl, 'blob:new-audio');
  assert.equal(result.blob, blob);
});

const statusMessages = {
  401: 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.',
  403: 'Sie haben keinen Zugriff auf diese Audioaufnahme.',
  404: 'Für diesen Anruf wurde keine Audioaufnahme gefunden.',
  502: 'Die Audioaufnahme ist momentan nicht verfügbar. Bitte versuchen Sie es später erneut.'
};

for (const status of [401, 403, 404, 502]) {
  test(`HTTP ${status} wird kontrolliert weitergegeben`, async () => {
    const { client } = harness({ responseStatus: status });
    await assert.rejects(
      client.loadAudio({ conversationId: 'conv-1' }),
      error => {
        assert.equal(ConversationAudioClient.getAudioErrorMessage(error), statusMessages[status]);
        return error.status === status && error.code === `audio_request_${status}`;
      }
    );
  });
}

test('alte Object-URL wird erst nach erfolgreicher neuer Antwort freigegeben', async () => {
  const { client, revoked } = harness();
  const result = await client.loadAudio({
    conversationId: 'conv-1',
    previousObjectUrl: 'blob:old-audio'
  });
  assert.equal(result.objectUrl, 'blob:new-audio');
  assert.deepEqual(revoked, ['blob:old-audio']);
});
