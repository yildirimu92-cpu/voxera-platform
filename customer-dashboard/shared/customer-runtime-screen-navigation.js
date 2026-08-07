/* ============================================================
   Voxera Customer Dashboard — Screen navigation (Etappe 2)
   ============================================================
   Owns the back-navigation contract behind the .vx-appbar back
   arrow.

   The five top-level screens (Heute, Anfragen, Assistent,
   Bericht, Einstellungen) never carry an arrow. Screens opened
   from a top-level screen do, and the arrow must land wherever
   the user actually came from — which is exactly what the
   browser's own history already knows.

   So a sub-screen pushes a history entry when it opens, and the
   arrow is a plain history.back(). Browser back, gesture back
   and the arrow are then the same operation and cannot drift
   apart. When a sub-screen is closed by something other than
   back — a root tab switch, for instance — the marker is
   stripped from the current entry instead, so the stale entry
   never reopens it.

   Public API:

     vxScreenBack(fallback)        back arrow handler
     vxScreenNav.enter(key)        a sub-screen became visible
     vxScreenNav.exit(key)         a sub-screen was closed in code
     vxScreenNav.current()         key of the open sub-screen

   Sub-screens driven by vxMehrShow / vxMehrBack are registered
   automatically; modules that own their own page (calendar)
   call enter/exit directly.
   ============================================================ */

(function initVoxeraScreenNavigation(root) {
  'use strict';
  if (!root || !root.document || root.__vxScreenNavigationInstalled) return;
  if (/\/activate(?:\.html)?$/i.test(String(root.location?.pathname || ''))) return;
  root.__vxScreenNavigationInstalled = true;

  const STATE_KEY = 'vxSubScreen';

  let openKey = '';
  // Set while a popstate is being applied, so replaying a history entry does
  // not write new history of its own.
  let replaying = false;

  function history() {
    return root.history && typeof root.history.pushState === 'function' ? root.history : null;
  }

  function stateKey() {
    const state = history()?.state;
    return state && typeof state === 'object' ? String(state[STATE_KEY] || '') : '';
  }

  function writeState(key, mode) {
    const api = history();
    if (!api) return;
    const next = { ...(api.state || {}) };
    if (key) next[STATE_KEY] = key;
    else delete next[STATE_KEY];
    const url = root.location.pathname + root.location.search + (root.location.hash || '');
    try {
      if (mode === 'push') api.pushState(next, '', url);
      else api.replaceState(next, '', url);
    } catch (_error) { /* history is unavailable (sandboxed frame) — arrow falls back below */ }
  }

  function enter(key) {
    const next = String(key || '');
    if (!next || next === openKey) return;
    const previous = openKey;
    openKey = next;
    if (replaying) return;
    // Drilling from a top-level screen adds an entry; moving sideways between
    // two sub-screens replaces it, so back always returns to the parent.
    writeState(next, previous ? 'replace' : 'push');
  }

  function exit(key) {
    if (key && String(key) !== openKey) return;
    if (!openKey) return;
    openKey = '';
    if (replaying) return;
    // Closed without using history: neutralize the current entry so a later
    // back() cannot resurrect a screen the user has already left.
    if (stateKey()) writeState('', 'replace');
  }

  function closeCurrent() {
    if (!openKey) return false;
    if (openKey.indexOf('mehr:') === 0 && typeof root.vxMehrBack === 'function') {
      root.vxMehrBack();
      return true;
    }
    return false;
  }

  function runFallback(fallback) {
    const handler = typeof fallback === 'function'
      ? fallback
      : (typeof fallback === 'string' && typeof root[fallback] === 'function' ? root[fallback] : null);
    if (handler) {
      handler.call(root);
      return true;
    }
    return closeCurrent();
  }

  // The one handler behind every .vx-appbar back arrow.
  function back(fallback) {
    if (openKey && stateKey() === openKey && history()) {
      root.history.back();
      return;
    }
    runFallback(fallback);
  }

  function applyState(key) {
    if (key === openKey) return;
    replaying = true;
    try {
      if (!key) {
        if (openKey.indexOf('mehr:') === 0 && typeof root.vxMehrBack === 'function') root.vxMehrBack();
        openKey = '';
        return;
      }
      if (key.indexOf('mehr:') === 0 && typeof root.vxMehrShow === 'function') {
        root.vxMehrShow(key.slice(5));
        openKey = key;
        return;
      }
      openKey = key;
    } finally {
      replaying = false;
    }
  }

  // vxMehrShow / vxMehrBack stay the entry points every settings screen
  // already calls; they only gain the history entry around them.
  function bridgeSettingsNavigation() {
    if (typeof root.vxMehrShow === 'function' && !root.vxMehrShow.__vxScreenNavBridged) {
      const originalShow = root.vxMehrShow;
      const show = function bridgedMehrShow(sub) {
        const result = originalShow.apply(this, arguments);
        enter('mehr:' + String(sub || ''));
        return result;
      };
      show.__vxScreenNavBridged = true;
      root.vxMehrShow = show;
    }

    if (typeof root.vxMehrBack === 'function' && !root.vxMehrBack.__vxScreenNavBridged) {
      const originalBack = root.vxMehrBack;
      const close = function bridgedMehrBack() {
        const result = originalBack.apply(this, arguments);
        exit('');
        return result;
      };
      close.__vxScreenNavBridged = true;
      root.vxMehrBack = close;
    }

    return typeof root.vxMehrShow === 'function' && root.vxMehrShow.__vxScreenNavBridged;
  }

  function install() {
    let attempts = 0;
    const bridge = () => {
      if (bridgeSettingsNavigation() || attempts >= 40) return;
      attempts += 1;
      root.setTimeout(bridge, 150);
    };
    bridge();

    root.addEventListener('popstate', (event) => {
      const state = event && event.state && typeof event.state === 'object' ? event.state : {};
      applyState(String(state[STATE_KEY] || ''));
    });
  }

  root.vxScreenBack = back;
  root.vxScreenNav = { enter, exit, back, current: () => openKey };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof globalThis !== 'undefined' ? globalThis : this);
