#!/usr/bin/env node
// verify-runtime-config-isolation.mjs
//
// Haelt fest, dass die Supabase-Zugangsdaten nicht wieder in den Quelltext
// zurueckwandern. Vorher waren sie in fuenf HTML-Dateien einkompiliert, wodurch
// jede Deploy-Preview zwangslaeufig auf Produktion zeigte.
// Siehe STAGING_PRODUKTION_TRENNUNG_KONZEPT_2026-08-08.md.
//
// Der Check liest ausschliesslich Repo-Dateien und oeffnet keine Verbindung.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { renderRuntimeConfig } from './runtime-config.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
const checks = [];

function ok(label) {
  checks.push(label);
}
function fail(label, detail) {
  failures.push(`${label}\n    ${detail}`);
}
function read(relPath) {
  return readFileSync(resolve(repoRoot, relPath), 'utf8');
}

// ── 1. Keine hartkodierten Zugangsdaten mehr ────────────────────────────────
// Der Projekt-Ref taucht im JWT wie in der URL auf, deshalb reicht ein Muster
// fuer beides. Zusaetzlich jedes Supabase-Anon-JWT, egal welches Projekt.
const HARDCODED_PATTERNS = [
  { name: 'Supabase-Projekt-URL', re: /https:\/\/[a-z0-9]{20}\.supabase\.co/ },
  { name: 'Supabase-JWT (anon/service_role)', re: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}/ }
];

const SOURCE_FILES = [
  'customer-dashboard/index.html',
  'customer-dashboard/activate.html',
  'admin-panel/index.html',
  'admin-panel/login.html',
  'contract-signed.html'
];

for (const relPath of SOURCE_FILES) {
  const contents = read(relPath);
  let clean = true;
  for (const { name, re } of HARDCODED_PATTERNS) {
    const hit = contents.match(re);
    if (hit) {
      clean = false;
      const line = contents.slice(0, hit.index).split('\n').length;
      fail(
        `${relPath}: ${name} wieder hartkodiert (Zeile ${line})`,
        'Zugangsdaten gehoeren in die Netlify-Env-Variablen, nicht in den Quelltext. ' +
        'Siehe scripts/runtime-config.mjs.'
      );
    }
  }
  if (clean) ok(`${relPath}: keine hartkodierten Zugangsdaten`);
}

// ── 2. Anwendungs-Dateien beziehen die Konfiguration zur Laufzeit ───────────
// contract-signed.html fehlt hier bewusst: die Seite laedt ausschliesslich ueber
// /.netlify/functions/contract-public-get und liegt ausserhalb beider
// Publish-Verzeichnisse — ein /vx-runtime-config.js waere dort ein 404.
const APP_FILES = [
  { path: 'customer-dashboard/index.html', guard: /supabaseUrlValue\s*&&\s*supabaseAnonKeyValue/ },
  { path: 'customer-dashboard/activate.html', guard: /SUPABASE_URL\s*&&\s*SUPABASE_ANON_KEY/ },
  { path: 'admin-panel/index.html', guard: /SUPABASE_URL\s*&&\s*SUPABASE_ANON_KEY/ },
  { path: 'admin-panel/login.html', guard: /SUPABASE_URL\s*&&\s*SUPABASE_ANON_KEY/ }
];

for (const { path: relPath, guard } of APP_FILES) {
  const contents = read(relPath);

  const scriptIdx = contents.indexOf('src="/vx-runtime-config.js"');
  if (scriptIdx === -1) {
    fail(`${relPath}: laedt /vx-runtime-config.js nicht`, 'Ohne die Datei bleibt window.__VX_RUNTIME_CONFIG__ undefiniert.');
    continue;
  }

  const usageIdx = contents.indexOf('__VX_RUNTIME_CONFIG__');
  if (usageIdx === -1) {
    fail(`${relPath}: liest window.__VX_RUNTIME_CONFIG__ nicht`, 'Die Zugangsdaten muessen von dort kommen.');
    continue;
  }

  // Reihenfolge zaehlt: ein spaeter geladenes Skript kaeme zu spaet.
  if (scriptIdx > usageIdx) {
    fail(
      `${relPath}: /vx-runtime-config.js wird nach der ersten Verwendung geladen`,
      `script-Tag bei Position ${scriptIdx}, erste Verwendung bei ${usageIdx}.`
    );
    continue;
  }

  if (!guard.test(contents)) {
    fail(
      `${relPath}: kein Guard vor createClient`,
      `Erwartet wurde ein Muster wie ${guard}. Ohne Guard wird der Client mit leeren Werten gebaut.`
    );
    continue;
  }

  ok(`${relPath}: laedt und prueft die Laufzeit-Konfiguration`);
}

// ── 3. Die eingecheckten Konfigurationsdateien tragen keine Zugangsdaten ────
// Sie sind reine Platzhalter; der Netlify-Build ueberschreibt sie. Ein
// versehentlich eingecheckter echter Wert wuerde die Trennung still aushebeln.
for (const relPath of ['customer-dashboard/vx-runtime-config.js', 'admin-panel/vx-runtime-config.js']) {
  const contents = read(relPath);
  if (!/"configured":\s*false/.test(contents)) {
    fail(`${relPath}: enthaelt Zugangsdaten`, 'Die eingecheckte Fassung muss configured:false sein.');
    continue;
  }
  if (!/"supabaseUrl":\s*null/.test(contents) || !/"supabaseAnonKey":\s*null/.test(contents)) {
    fail(`${relPath}: supabaseUrl/supabaseAnonKey sind nicht null`, 'Die eingecheckte Fassung darf keine Werte tragen.');
    continue;
  }
  ok(`${relPath}: Platzhalter ohne Zugangsdaten`);
}

// ── 4. Beide Sites erzeugen die Datei im Build ─────────────────────────────
for (const relPath of ['customer-dashboard/netlify.toml', 'admin-panel/netlify.toml']) {
  const contents = read(relPath);
  if (!/command\s*=\s*"node tools\/build-runtime-config\.mjs"/.test(contents)) {
    fail(`${relPath}: kein Build-Schritt fuer die Laufzeit-Konfiguration`, 'Ohne ihn deployt der Platzhalter ohne Zugangsdaten.');
    continue;
  }
  ok(`${relPath}: Build-Schritt vorhanden`);
}

// ── 5. Der Generator liefert in beiden Zustaenden gueltiges JavaScript ─────
// Ein Syntaxfehler hier faellt sonst erst im Browser auf, und zwar als komplett
// tote Seite: das Skript blockiert die Inline-Initialisierung darunter.
for (const [label, args] of [
  ['ohne Zugangsdaten', { supabaseUrl: null, supabaseAnonKey: null, context: 'deploy-preview', branch: 'x', site: 's' }],
  ['mit Zugangsdaten', { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', context: 'production', branch: 'main', site: 's' }]
]) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(renderRuntimeConfig(args));
    ok(`Generator erzeugt gueltiges JavaScript (${label})`);
  } catch (err) {
    fail(`Generator erzeugt ungueltiges JavaScript (${label})`, String(err && err.message));
  }
}

// ── 6. Der Hinweis blockiert die Oberflaeche nicht ─────────────────────────
// Entstanden aus einem Fund am 09.08.: Der Hinweis war ein deckendes Vollbild
// (position:fixed, inset:0, background:#0d1b2a, kein Schliessen). Von der
// Oberflaeche war nichts zu sehen — waehrend sein eigener Text und die Doku
// versprachen, sie bleibe sichtbar. Damit war der einzige verbliebene Zweck
// einer Preview ohne Zugangsdaten (Layout und Design beurteilen) unmoeglich.
//
// Geprueft wird das erzeugte File, nicht der Generator-Quelltext: nur was im
// Browser landet, kann etwas verdecken. Kommentare im Generator duerfen die
// alten Werte deshalb weiterhin nennen.
// Es sind zwei Zustaende, und der Waechter muss beide halten. Ohne die zweite
// Haelfte waere der Fix eine Verschlechterung fuer Produktion: dort bleibt der
// Supabase-Client null, und admin-panel/login.html ruft in doLogin()
// ungeprueft sb.auth auf — ein wegklickbarer Hinweis liesse ein totes
// Formular zurueck. (Befund aus dem Codex-Review zu PR #865.)
//
// Der Kontext entscheidet zur Build-Zeit, welche Fassung ueberhaupt erzeugt
// wird. Deshalb genuegen Zeichenketten-Pruefungen: die Merkmale der einen
// Fassung duerfen im File der anderen gar nicht vorkommen.
const BLOCKING_MARKERS = [
  { name: 'inset:0 (Vollbild-Flaeche)', re: /inset\s*:\s*0/ },
  { name: 'deckender Vollbild-Hintergrund', re: /background\s*:\s*#0d1b2a/i }
];
const NOTICE_MARKERS = [
  { name: 'Schliessen-Knopf', re: /Hinweis schliessen/ },
  { name: "role='status'", re: /setAttribute\('role', 'status'\)/ },
  { name: 'Abstand ueber der mobilen Tab-Leiste', re: /@media \(max-width:768px\)/ }
];

function generatedFor(context) {
  return renderRuntimeConfig({
    supabaseUrl: null, supabaseAnonKey: null,
    context, branch: 'x', site: 'customer-dashboard'
  });
}

// ── 6a. Preview: der Hinweis liegt neben der Oberflaeche ───────────────────
for (const context of ['deploy-preview', 'branch-deploy']) {
  const generated = generatedFor(context);
  let clean = true;

  for (const { name, re } of BLOCKING_MARKERS) {
    if (re.test(generated)) {
      clean = false;
      fail(
        `${context}: der Hinweis verdeckt die Oberflaeche wieder (${name})`,
        'Er soll neben der Oberflaeche liegen, nicht darueber — sonst laesst sich auf einer ' +
        'Preview ohne Zugangsdaten weder Layout noch Design beurteilen. Siehe scripts/runtime-config.mjs.'
      );
    }
  }
  for (const { name, re } of NOTICE_MARKERS) {
    if (!re.test(generated)) {
      clean = false;
      fail(`${context}: ${name} fehlt`, 'Ohne ihn ist der Hinweis wieder im Weg statt daneben.');
    }
  }
  if (clean) ok(`${context}: Hinweis liegt neben der Oberflaeche, schliessbar, mit Abstand zur Tab-Leiste`);
}

// ── 6b. Alles andere: fehlende Zugangsdaten bleiben ein Blocker ────────────
for (const context of ['production', null]) {
  const generated = generatedFor(context);
  const label = context || 'ohne Kontext';
  let clean = true;

  for (const { name, re } of BLOCKING_MARKERS) {
    if (!re.test(generated)) {
      clean = false;
      fail(
        `${label}: der Blocker fehlt (${name})`,
        'Ausserhalb einer Preview sind fehlende Zugangsdaten ein Defekt, kein erklaerter Zustand. ' +
        'Der Supabase-Client bleibt null; admin-panel/login.html ruft in doLogin() ungeprueft sb.auth auf.'
      );
    }
  }
  for (const { name, re } of NOTICE_MARKERS) {
    if (re.test(generated)) {
      clean = false;
      fail(
        `${label}: der Hinweis ist wegklickbar (${name})`,
        'Wer ihn wegklickt, steht vor einer Oberflaeche, die beim ersten Klick stirbt.'
      );
    }
  }
  if (clean) ok(`${label}: fehlende Zugangsdaten bleiben ein Blocker`);
}

// ── Bericht ────────────────────────────────────────────────────────────────
console.log(`\nLaufzeit-Konfiguration — Isolation der Zugangsdaten\n`);
for (const label of checks) console.log(`  PASS  ${label}`);
if (failures.length) {
  console.error(`\n  ${failures.length} Pruefung(en) fehlgeschlagen:\n`);
  for (const detail of failures) console.error(`  FAIL  ${detail}\n`);
  process.exit(1);
}
console.log(`\n  ${checks.length} Pruefungen bestanden, 0 verletzt.\n`);
