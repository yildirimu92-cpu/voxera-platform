'use strict';

/**
 * Regression test for the audio card loading state.
 *
 * vxAutoLoadAudioCards() mounts the real player by locating
 *   #vx-call-audio-card[data-vx-audio-auto="1"]
 * and reading data-conversation-id off it. If the loading state renders
 * anything without that shell, the fetch never starts and the loading
 * placeholder stays on screen forever.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dashboard = fs.readFileSync(
  path.join(__dirname, '..', 'index.html'),
  'utf8'
);

function extractFunction(name) {
  const start = dashboard.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' not found in index.html');
  let depth = 0;
  let seenBody = false;
  for (let i = start; i < dashboard.length; i += 1) {
    const char = dashboard[i];
    if (char === '{') { depth += 1; seenBody = true; }
    else if (char === '}') {
      depth -= 1;
      if (seenBody && depth === 0) return dashboard.slice(start, i + 1);
    }
  }
  throw new Error('unterminated function: ' + name);
}

const sandbox = {
  vxAudioEscapeAttr: (value) => String(value == null ? '' : value),
  vxAudioEscapeText: (value) => String(value == null ? '' : value),
  // Mirrors the real accessor in index.html.
  vxUiSkeleton: (options) =>
    '<div class="vx-ui-skeleton" role="status" aria-busy="true" aria-label="'
    + ((options && options.label) || '') + ' wird geladen"></div>'
};
vm.createContext(sandbox);
vm.runInContext(extractFunction('vxRenderAudioStateCardHtml'), sandbox);
vm.runInContext(extractFunction('vxRenderCallAudioCardHtml'), sandbox);
sandbox.vxGetCallAudioUrl = () => '';
sandbox.vxGetElevenLabsConversationId = () => 'conv_test_123';

const loading = sandbox.vxRenderAudioStateCardHtml(
  'loading',
  'Aufnahme wird geladen …',
  'conv_test_123'
);

assert.ok(
  loading.includes('id="vx-call-audio-card"'),
  'loading state must carry the card id the auto-loader queries'
);
assert.ok(
  loading.includes('data-vx-audio-auto="1"'),
  'loading state must opt into auto-loading'
);
assert.ok(
  loading.includes('data-conversation-id="conv_test_123"'),
  'loading state must carry the conversation id the fetch needs'
);
assert.ok(
  loading.includes('vx-ui-skeleton'),
  'loading state must render the canonical skeleton'
);
assert.ok(
  loading.includes('vx-audio-fetch-status'),
  'loading state must keep the status node the fetch writes into'
);

// Without a conversation id there is nothing to fetch, so no auto-load hook.
const empty = sandbox.vxRenderAudioStateCardHtml('empty', 'Keine Aufnahme.', '');
assert.ok(
  !empty.includes('data-vx-audio-auto'),
  'empty state must not ask the auto-loader to fetch'
);
assert.ok(
  empty.includes('id="vx-call-audio-card"'),
  'empty state still renders the card shell'
);

// The error state must keep the hook so "Erneut versuchen" can retry.
const error = sandbox.vxRenderAudioStateCardHtml(
  'error',
  'Aufnahme konnte nicht geladen werden.',
  'conv_test_123'
);
assert.ok(
  error.includes('data-vx-audio-auto="1"') && error.includes('vxTryLoadElevenLabsAudioFromDashboard'),
  'error state must keep the retry path'
);

// End to end through the card factory: a call with only a conversation id
// must produce the mountable loading card, not a bare skeleton.
const card = sandbox.vxRenderCallAudioCardHtml({});
assert.ok(
  card.includes('id="vx-call-audio-card"') && card.includes('data-vx-audio-auto="1"'),
  'vxRenderCallAudioCardHtml must return a mountable card while loading'
);

console.log('audio card mount hook: all assertions passed');
