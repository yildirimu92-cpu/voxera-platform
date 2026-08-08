/* Automatisch erzeugt von scripts/runtime-config.mjs. Nicht von Hand bearbeiten. */
(function () {
  'use strict';

  var config = {
    "supabaseUrl": null,
    "supabaseAnonKey": null,
    "context": null,
    "branch": null,
    "site": "customer-dashboard",
    "configured": false
  };
  window.__VX_RUNTIME_CONFIG__ = config;

  if (config.configured) return;

  var isPreview = config.context === 'deploy-preview' || config.context === 'branch-deploy';
  var title = isPreview ? 'Vorschau ohne Datenverbindung' : 'Keine Datenverbindung';
  var body = isPreview
    ? 'Diese Vorschau hat bewusst keinen Zugriff auf die Datenbank. Sichtbar sind Oberflaeche, Navigation und Design \u2014 alles, was Daten braucht, bleibt leer. Funktionale Tests laufen auf der Staging-Umgebung.'
    : 'Die Laufzeit-Konfiguration fehlt. Der Build hat keine Supabase-Zugangsdaten erhalten \u2014 in Netlify pruefen, ob SUPABASE_URL und SUPABASE_ANON_KEY fuer diesen Kontext gesetzt sind.';
  var detail = [config.site, config.context, config.branch].filter(Boolean).join(' \u00b7 ');

  console.warn('[vx-runtime-config] Keine Supabase-Zugangsdaten fuer diesen Kontext.', config);

  function render() {
    if (document.getElementById('vx-runtime-config-notice')) return;
    var overlay = document.createElement('div');
    overlay.id = 'vx-runtime-config-notice';
    overlay.setAttribute('role', 'alert');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:24px', 'background:#0d1b2a',
      'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif'
    ].join(';');

    var card = document.createElement('div');
    card.style.cssText = [
      'max-width:460px', 'width:100%', 'box-sizing:border-box',
      'background:#fff', 'border-radius:12px', 'padding:28px 26px',
      'box-shadow:0 18px 48px rgba(0,0,0,.28)', 'text-align:left'
    ].join(';');

    var heading = document.createElement('h1');
    heading.textContent = title;
    heading.style.cssText = 'margin:0 0 10px;font-size:19px;line-height:1.3;color:#0d1b2a;font-weight:650';

    var text = document.createElement('p');
    text.textContent = body;
    text.style.cssText = 'margin:0;font-size:14px;line-height:1.6;color:#41505f';

    card.appendChild(heading);
    card.appendChild(text);

    if (detail) {
      var meta = document.createElement('p');
      meta.textContent = detail;
      meta.style.cssText = 'margin:16px 0 0;font-size:12px;line-height:1.5;color:#8b97a3';
      card.appendChild(meta);
    }

    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render, { once: true });
  } else {
    render();
  }
})();
