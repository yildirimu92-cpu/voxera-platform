/* Automatisch erzeugt von scripts/runtime-config.mjs. Nicht von Hand bearbeiten. */
(function () {
  'use strict';

  var config = {
    "supabaseUrl": null,
    "supabaseAnonKey": null,
    "context": null,
    "branch": null,
    "site": "admin-panel",
    "configured": false
  };
  window.__VX_RUNTIME_CONFIG__ = config;

  if (config.configured) return;

  var isPreview = config.context === 'deploy-preview' || config.context === 'branch-deploy';
  var title = isPreview ? 'Vorschau ohne Datenverbindung' : 'Keine Datenverbindung';
  var body = isPreview
    ? 'Diese Vorschau hat bewusst keinen Zugriff auf die Datenbank. Sichtbar sind Oberfl\u00e4che, Navigation und Design \u2014 alles, was Daten braucht, bleibt leer. Funktionale Tests laufen auf der Staging-Umgebung.'
    : 'Die Laufzeit-Konfiguration fehlt. Der Build hat keine Supabase-Zugangsdaten erhalten \u2014 in Netlify pr\u00fcfen, ob SUPABASE_URL und SUPABASE_ANON_KEY f\u00fcr diesen Kontext gesetzt sind.';
  var detail = [config.site, config.context, config.branch].filter(Boolean).join(' \u00b7 ');

  console.warn('[vx-runtime-config] Keine Supabase-Zugangsdaten fuer diesen Kontext.', config);

  var STYLE_ID = 'vx-runtime-config-notice-style';
  var css = [
    '#vx-runtime-config-notice{',
    'position:fixed;left:16px;bottom:16px;z-index:2147483647;',
    'width:min(380px,calc(100vw - 32px));box-sizing:border-box;',
    'display:flex;gap:12px;align-items:flex-start;',
    'padding:14px 16px;border:1px solid #d7dee7;border-radius:12px;',
    'background:#fff;box-shadow:0 12px 32px rgba(13,27,42,.18);',
    'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:left}',
    '#vx-runtime-config-notice h2{margin:0 0 4px;font-size:14px;line-height:1.35;color:#0d1b2a;font-weight:650}',
    '#vx-runtime-config-notice p{margin:0;font-size:13px;line-height:1.5;color:#41505f}',
    '#vx-runtime-config-notice .vx-rc-meta{margin-top:8px;font-size:11px;line-height:1.4;color:#8b97a3}',
    '#vx-runtime-config-notice button{flex:0 0 auto;margin:-4px -6px 0 0;padding:4px 8px;border:0;',
    'background:none;color:#8b97a3;font-size:18px;line-height:1;cursor:pointer}',
    '#vx-runtime-config-notice button:hover{color:#0d1b2a}',
    '#vx-runtime-config-notice button:focus-visible{outline:2px solid #1a6fe8;outline-offset:2px;border-radius:6px}',
    '@media (max-width:768px){#vx-runtime-config-notice{',
    'left:12px;right:12px;width:auto;bottom:calc(80px + env(safe-area-inset-bottom,0px))}}'
  ].join('');

  function render() {
    if (document.getElementById('vx-runtime-config-notice')) return;

    if (!document.getElementById(STYLE_ID)) {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css;
      document.head.appendChild(style);
    }

    var notice = document.createElement('div');
    notice.id = 'vx-runtime-config-notice';
    // status statt alert: der Hinweis unterbricht nichts mehr, er begleitet.
    notice.setAttribute('role', 'status');

    var copy = document.createElement('div');

    var heading = document.createElement('h2');
    heading.textContent = title;

    var text = document.createElement('p');
    text.textContent = body;

    copy.appendChild(heading);
    copy.appendChild(text);

    if (detail) {
      var meta = document.createElement('p');
      meta.className = 'vx-rc-meta';
      meta.textContent = detail;
      copy.appendChild(meta);
    }

    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Hinweis schliessen');
    close.textContent = '\u00d7';
    close.addEventListener('click', function () {
      notice.remove();
    });

    notice.appendChild(copy);
    notice.appendChild(close);
    document.body.appendChild(notice);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render, { once: true });
  } else {
    render();
  }
})();
