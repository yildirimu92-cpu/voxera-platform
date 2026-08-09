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
  //
  // Der Hinweis liegt NEBEN der Oberflaeche, nicht darueber (2026-08-09).
  // Bis dahin war er ein deckendes Vollbild — position:fixed, inset:0,
  // background #0d1b2a, kein Schliessen. Von der Oberflaeche war damit nichts
  // zu sehen, waehrend der Hinweistext selbst das Gegenteil versprach
  // ("Sichtbar sind Oberflaeche, Navigation und Design"). Text und Umsetzung
  // standen im selben File und widersprachen sich; die Doku
  // (RUNTIME_CONFIG_UND_PREVIEW_ISOLATION.md) beschrieb die Textfassung.
  //
  // Aufgeloest zugunsten des Textes, weil er den Zweck trifft: Previews sind
  // dafuer da, Layout und Design zu beurteilen. Ein Blocker macht genau das
  // unmoeglich und nimmt der Preview ihren einzigen verbliebenen Nutzen.
  //
  // Die Regeln stehen im erzeugten File in einem <style>-Block statt inline,
  // weil der Hinweis auf Mobile ueber der Tab-Leiste bleiben muss (rund 64px,
  // fix am unteren Rand) — das braucht eine Media Query, die ein
  // style-Attribut nicht kann. scripts/verify-runtime-config-isolation.mjs
  // haelt fest, dass das Vollbild nicht zurueckkommt.
  return `/* Automatisch erzeugt von scripts/runtime-config.mjs. Nicht von Hand bearbeiten. */
(function () {
  'use strict';

  var config = ${JSON.stringify(payload, null, 2).replace(/\n/g, '\n  ')};
  window.__VX_RUNTIME_CONFIG__ = config;

  if (config.configured) return;

  var isPreview = config.context === 'deploy-preview' || config.context === 'branch-deploy';
  var title = isPreview ? 'Vorschau ohne Datenverbindung' : 'Keine Datenverbindung';
  var body = isPreview
    ? 'Diese Vorschau hat bewusst keinen Zugriff auf die Datenbank. Sichtbar sind Oberfl\\u00e4che, Navigation und Design \\u2014 alles, was Daten braucht, bleibt leer. Funktionale Tests laufen auf der Staging-Umgebung.'
    : 'Die Laufzeit-Konfiguration fehlt. Der Build hat keine Supabase-Zugangsdaten erhalten \\u2014 in Netlify pr\\u00fcfen, ob SUPABASE_URL und SUPABASE_ANON_KEY f\\u00fcr diesen Kontext gesetzt sind.';
  var detail = [config.site, config.context, config.branch].filter(Boolean).join(' \\u00b7 ');

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
    close.textContent = '\\u00d7';
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
