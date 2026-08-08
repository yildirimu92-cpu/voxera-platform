// runtime-config.mjs
//
// Erzeugt `vx-runtime-config.js` im Publish-Verzeichnis einer Site.
//
// Hintergrund: `SUPABASE_URL` und `SUPABASE_ANON_KEY` waren in fünf HTML-Dateien
// fest einkompiliert. Damit zeigte jede Deploy-Preview zwangsläufig auf die
// Produktions-Datenbank — es gab keinen Schalter, der auf etwas anderes hätte
// zeigen können. Siehe STAGING_PRODUKTION_TRENNUNG_KONZEPT_2026-08-08.md, Abschnitt 0.
//
// Die Werte kommen jetzt zur Build-Zeit aus der Umgebung. Sind in Netlify die
// Variablen auf den Production-Kontext eingeschränkt, bekommt ein Preview-Build
// keine Zugangsdaten, die erzeugte Datei enthält `null`, und die Anwendung zeigt
// einen bewussten Zustand statt einer scheinbar funktionierenden Oberfläche auf
// Produktionsdaten.
//
// Bewusste Entscheidung gegen einen Laufzeit-Endpunkt: ein blockierendes
// `<script src>` auf eine Netlify Function kostet bei jedem Seitenaufruf einen
// Roundtrip inklusive Cold Start. Eine statisch erzeugte Datei wird vom CDN
// ausgeliefert und kostet nichts.
//
// Fehlende Zugangsdaten sind KEIN Build-Fehler. Genau das ist im Preview-Kontext
// der gewünschte Zustand; ein harter Abbruch würde jede Preview rot färben.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUTPUT_FILENAME = 'vx-runtime-config.js';

/** Leere Strings zählen als "nicht gesetzt" — Netlify liefert entfernte Variablen so aus. */
function readEnv(name) {
  const raw = process.env[name];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Baut den Inhalt der Konfigurationsdatei.
 * Exportiert, damit der Verifizierer denselben Code prüft, der auch deployt wird.
 */
export function renderRuntimeConfig({ supabaseUrl, supabaseAnonKey, context, branch, site }) {
  const configured = Boolean(supabaseUrl && supabaseAnonKey);
  const payload = {
    supabaseUrl: supabaseUrl || null,
    supabaseAnonKey: supabaseAnonKey || null,
    context: context || null,
    branch: branch || null,
    site: site || null,
    configured
  };

  // Der Hinweis lebt in dieser Datei und nicht in den vier HTML-Dateien: so gibt
  // es genau eine Stelle, die den Zustand "keine Datenverbindung" beschreibt.
  return `/* Automatisch erzeugt von scripts/runtime-config.mjs. Nicht von Hand bearbeiten. */
(function () {
  'use strict';

  var config = ${JSON.stringify(payload, null, 2).replace(/\n/g, '\n  ')};
  window.__VX_RUNTIME_CONFIG__ = config;

  if (config.configured) return;

  var isPreview = config.context === 'deploy-preview' || config.context === 'branch-deploy';
  var title = isPreview ? 'Vorschau ohne Datenverbindung' : 'Keine Datenverbindung';
  var body = isPreview
    ? 'Diese Vorschau hat bewusst keinen Zugriff auf die Datenbank. Sichtbar sind Oberflaeche, Navigation und Design \\u2014 alles, was Daten braucht, bleibt leer. Funktionale Tests laufen auf der Staging-Umgebung.'
    : 'Die Laufzeit-Konfiguration fehlt. Der Build hat keine Supabase-Zugangsdaten erhalten \\u2014 in Netlify pruefen, ob SUPABASE_URL und SUPABASE_ANON_KEY fuer diesen Kontext gesetzt sind.';
  var detail = [config.site, config.context, config.branch].filter(Boolean).join(' \\u00b7 ');

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
`;
}

/**
 * Schreibt die Konfigurationsdatei in `siteDir`.
 * Gibt zurück, ob Zugangsdaten gefunden wurden — der Aufrufer protokolliert das.
 */
export function buildRuntimeConfig({ siteDir, site }) {
  const supabaseUrl = readEnv('SUPABASE_URL');
  const supabaseAnonKey = readEnv('SUPABASE_ANON_KEY');

  const contents = renderRuntimeConfig({
    supabaseUrl,
    supabaseAnonKey,
    context: readEnv('CONTEXT'),
    branch: readEnv('BRANCH'),
    site
  });

  const target = join(siteDir, OUTPUT_FILENAME);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, 'utf8');

  const configured = Boolean(supabaseUrl && supabaseAnonKey);
  const context = readEnv('CONTEXT') || 'lokal';
  if (configured) {
    console.log(`[runtime-config] ${site}: Zugangsdaten gesetzt (Kontext: ${context}) -> ${target}`);
  } else {
    const missing = [
      supabaseUrl ? null : 'SUPABASE_URL',
      supabaseAnonKey ? null : 'SUPABASE_ANON_KEY'
    ].filter(Boolean).join(', ');
    console.warn(
      `[runtime-config] ${site}: keine Zugangsdaten (Kontext: ${context}, fehlt: ${missing}). ` +
      'Die Anwendung startet ohne Datenverbindung. Im Preview-Kontext ist das der gewuenschte Zustand.'
    );
  }

  return configured;
}

export { OUTPUT_FILENAME };
