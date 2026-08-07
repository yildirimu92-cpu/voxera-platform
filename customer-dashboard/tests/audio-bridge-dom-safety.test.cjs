'use strict';

/**
 * Regression test for the "stuck on Audio wird sicher abgerufen…" bug.
 *
 * #vx-call-audio-card is not a unique id: the split panel, the legacy
 * full-page detail and the v2 fullscreen shell can each render one, and
 * hideLegacyDetail() used to leave its copy in the DOM (hidden, not
 * cleared) after switching to a newer view. installConversationAudioBridge()
 * (shared/offer-brand.js) used to re-find the freshly-loaded card via a
 * document-wide getElementById('vx-call-audio-card') after the fetch
 * resolved — with a stale duplicate earlier in the document, that grabs the
 * WRONG (stale, possibly hidden) card instead of the one the user is
 * actually looking at.
 *
 * This test builds a minimal fake DOM with exactly that duplicate-id
 * situation — a stale card ahead of the real one in document order — and
 * installs the real bridge against it (the module self-installs against
 * `globalThis` at require time, the same way it installs against `window`
 * in the browser). It asserts the bridge always resolves the real card by
 * direct node reference, never by a global id re-query, and that the
 * missing re-entrancy guard (present on the base loader, absent on the
 * bridge override before this fix) is now in place.
 */

const assert = require('node:assert/strict');
const path = require('node:path');

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this._attrs = new Map();
    this.children = [];
    this.parentNode = null;
    this._innerHTML = '';
  }

  get id() { return this._attrs.get('id') || ''; }

  getAttribute(name) { return this._attrs.has(name) ? this._attrs.get(name) : null; }
  setAttribute(name, value) { this._attrs.set(name, String(value)); }
  removeAttribute(name) { this._attrs.delete(name); }

  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) {
      const cls = (this._attrs.get('class') || '').split(/\s+/);
      return cls.includes(selector.slice(1));
    }
    return false;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (typeof node.matches === 'function' && node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  get firstElementChild() { return this.children[0] || null; }

  querySelector(selector) {
    const queue = [...this.children];
    while (queue.length) {
      const node = queue.shift();
      if (node.matches(selector)) return node;
      queue.push(...node.children);
    }
    return null;
  }

  replaceWith(node) {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    const idx = parent.children.indexOf(this);
    if (idx === -1) return;
    parent.children[idx] = node;
    node.parentNode = parent;
    this.parentNode = null;
  }

  set innerHTML(html) {
    this._innerHTML = html;
    this.children = [];
    // Minimal single-root parse — good enough for the card markup the
    // bridge itself generates (one root <div ...> with attribute values).
    const rootMatch = html.match(/^<div([^>]*)>/);
    if (!rootMatch) return;
    const el = new FakeElement('div');
    const attrRe = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
    let m;
    while ((m = attrRe.exec(rootMatch[1]))) el.setAttribute(m[1], m[2]);
    this.appendChild(el);
  }

  get innerHTML() { return this._innerHTML; }
}

function findById(root, id) {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

async function main() {
  const body = new FakeElement('body');

  // Document order matters: the stale legacy card sits earlier in the tree
  // than the real one, exactly like #call-detail-content (static, near the
  // top of <body>) versus the dynamically-appended v2 fullscreen shell.
  const legacyHost = body.appendChild(new FakeElement('div'));
  const staleCard = legacyHost.appendChild(new FakeElement('div'));
  staleCard.setAttribute('id', 'vx-call-audio-card');
  staleCard.setAttribute('data-conversation-id', 'stale-conv');
  staleCard.appendChild(new FakeElement('div'));
  staleCard.children[0].setAttribute('class', 'vx-audio-fetch-status');

  const fullscreenHost = body.appendChild(new FakeElement('div'));
  const realCard = fullscreenHost.appendChild(new FakeElement('div'));
  realCard.setAttribute('id', 'vx-call-audio-card');
  realCard.setAttribute('data-conversation-id', 'real-conv');
  const realStatus = realCard.appendChild(new FakeElement('div'));
  realStatus.setAttribute('class', 'vx-audio-fetch-status');
  const realButton = realCard.appendChild(new FakeElement('button'));

  let fetchCount = 0;
  let releaseFetch = null;
  const hydrateCalls = [];

  const fakeDocument = {
    readyState: 'complete',
    head: { appendChild: () => {} },
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => findById(body, id),
    addEventListener: () => {}
  };

  // Drive the module the same way it drives itself in a page: it self-installs
  // against `root = globalThis` at require time (UMD factory called with
  // `typeof globalThis !== 'undefined' ? globalThis : this`).
  const previous = {};
  const patch = {
    document: fakeDocument,
    fetch: async () => {
      fetchCount += 1;
      // Hang until released, so a concurrent second call can be attempted
      // while the first is still in flight (re-entrancy guard check).
      await new Promise((resolve) => { releaseFetch = resolve; });
      return { ok: true, status: 200, blob: async () => ({ type: 'audio/mpeg' }) };
    },
    URL: { createObjectURL: () => 'blob:test-audio', revokeObjectURL: () => {} },
    getSupabaseAuthClient: () => ({
      auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) }
    }),
    vxGetElevenLabsConversationId: () => '',
    vxGetCallAudioUrl: () => '',
    vxRenderModernAudioPlayerHtml: (url) => '<div data-vx-audio-player="" data-audio-url="' + url + '">',
    vxHydrateModernAudioPlayers: (node) => { hydrateCalls.push(node); }
  };
  for (const key of Object.keys(patch)) { previous[key] = globalThis[key]; globalThis[key] = patch[key]; }

  try {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'shared', 'offer-brand.js'))];
    require(path.join(__dirname, '..', 'shared', 'offer-brand.js'));

    assert.equal(
      typeof globalThis.vxTryLoadElevenLabsAudioFromDashboard,
      'function',
      'offer-brand.js must install the audio bridge on the (fake) window'
    );

    // Kick off a real load, triggered the way a click on the button inside the
    // REAL card would (btn.closest('#vx-call-audio-card') resolves to realCard,
    // never through the unscoped document-wide fallback).
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    const firstCall = globalThis.vxTryLoadElevenLabsAudioFromDashboard(realButton);

    // Re-entrancy guard: a second trigger on the same card while the first
    // fetch is still in flight must not start a second fetch.
    await settle(); // let the first call reach its fetch() await (past getSession())
    assert.equal(fetchCount, 1, 'the first load must have started exactly one fetch');
    const secondCall = globalThis.vxTryLoadElevenLabsAudioFromDashboard(realButton);
    await settle();
    assert.equal(fetchCount, 1, 'a concurrent second trigger on the same card must not start a second fetch');

    assert.ok(typeof releaseFetch === 'function', 'the fake fetch must be pending');
    releaseFetch();
    await Promise.all([firstCall, secondCall]);

    // The real card must have been replaced by direct reference — never by
    // re-querying the document for an id that also matches the stale card.
    assert.equal(realCard.parentNode, null, 'the real card node must have been swapped out by replaceWith(), not left in place');
    const mounted = fullscreenHost.children[0];
    assert.notEqual(mounted, realCard, 'the mounted node must be the newly built element, not the old skeleton');
    assert.equal(mounted.getAttribute('data-vx-object-url'), 'blob:test-audio', 'the fullscreen host must contain the loaded player');

    assert.equal(hydrateCalls.length, 1, 'hydration must run exactly once for the real load');
    assert.equal(hydrateCalls[0], mounted, 'hydration must receive the actual mounted node by direct reference, not a stale document-wide lookup');
    assert.notEqual(hydrateCalls[0], staleCard, 'hydration must never target the stale duplicate card');

    // The stale card, still sitting in its (hidden) legacy host, must be
    // completely untouched by the real card's load.
    assert.equal(staleCard.getAttribute('data-conversation-id'), 'stale-conv', 'the stale card must be left alone');
    assert.equal(staleCard.parentNode, legacyHost, 'the stale card must still be exactly where it was');

    console.log('audio bridge DOM safety: all assertions passed');
  } finally {
    for (const key of Object.keys(patch)) {
      if (previous[key] === undefined) delete globalThis[key];
      else globalThis[key] = previous[key];
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
