#!/usr/bin/env node
/**
 * Struktur-Ratsche für das Admin-Portal.
 *
 * Warum es dieses Skript gibt
 * ---------------------------
 * Das Admin-Portal ist über Wochen so gewachsen, dass jede Korrektur als
 * weiterer Laufzeit-Patch über den vorigen gelegt wurde: 29 Skripte, 16 zur
 * Laufzeit eingefügte Stylesheets, 868 `!important`, acht Wrapper um denselben
 * Server-Aufruf. Kein einzelner Schritt war falsch — die Summe war das Problem.
 *
 * Dieses Skript misst genau diese Summen und lässt sie nur noch fallen. Es
 * verhindert nicht, dass jemand einen Patch schreibt; es verhindert, dass die
 * Zahl unbemerkt wieder steigt.
 *
 * Bewusst ohne Abhängigkeiten, damit es wie die übrigen `verify-*`-Skripte
 * direkt in CI läuft. Was nur am gerenderten DOM messbar ist — Kontrast,
 * Startfähigkeit, Wirkung einzelner Patches — steht in
 * `scripts/browser-check-admin-portal.mjs` und wird von Hand ausgeführt.
 *
 * Aufruf:  node scripts/verify-admin-portal-structure.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = join(ROOT, 'admin-panel');

const lies = (relativerPfad) => readFileSync(join(ADMIN, relativerPfad), 'utf8');
const zaehle = (text, muster) => (text.match(muster) || []).length;

const indexHtml = lies('index.html');
const offerBrand = lies('shared/offer-brand.js');

const patchDateien = readdirSync(join(ADMIN, 'shared'))
  .filter((name) => /^admin-runtime-.*\.js$/.test(name));

const geladenePatches = [...offerBrand.matchAll(/'\/shared\/(admin-runtime-[a-z0-9-]*\.js)/g)].map((m) => m[1]);
const patchQuelltext = geladenePatches.map((name) => lies(`shared/${name}`)).join('\n');
const allePatchQuelltexte = patchDateien.map((name) => lies(`shared/${name}`)).join('\n');

/**
 * Obergrenzen. Jede darf sinken, keine darf steigen.
 *
 * `stand` ist der Wert nach Welle 1 des Zielbilds
 * (docs/ADMIN_PORTAL_ZIELBILD_2026-08-10.md). `ziel` ist der Endwert nach
 * Welle 7 — er steht hier als Erinnerung, nicht als Prüfung.
 */
const RATSCHEN = [
  {
    name: 'Laufzeit-Patches, die nachgeladen werden',
    ist: geladenePatches.length,
    max: 24,
    ziel: 0,
    hinweis: 'Regel R1: eine Quelle pro Bildschirm.'
  },
  {
    name: 'Neuzuweisungen von callAdminFunction ausserhalb von core/',
    ist: zaehle(patchQuelltext, /(?:w|root|window)\.callAdminFunction\s*=\s*[^=]/g),
    max: 0,
    ziel: 0,
    hinweis: 'Regel R2: der Weg zum Server liegt in shared/core/admin-api.js. '
      + 'Neue Umleitungen gehoeren dort in die Endpunkttabelle, nicht in einen Wrapper.'
  },
  {
    name: 'Native Browser-Dialoge (alert/confirm) in index.html',
    ist: zaehle(indexHtml, /(?:^|[^.\w$])(?:alert|confirm)\s*\(/gm),
    max: 0,
    ziel: 0,
    hinweis: 'Regel R4: voxAlert / voxConfirm aus shared/core/admin-feedback.js benutzen.'
  },
  {
    name: 'Zur Laufzeit per JavaScript eingefuegte Stylesheets',
    ist: patchDateien.filter((name) => /createElement\(['"]style['"]\)/.test(lies(`shared/${name}`))).length,
    max: 15,
    ziel: 0,
    hinweis: 'Regel R3: CSS gehoert in eine Datei. → Welle 2 laeuft.'
  },
  {
    name: 'Dauer-Timer (setInterval) in geladenen Patches',
    ist: zaehle(patchQuelltext, /setInterval\s*\(/g),
    max: 5,
    ziel: 0,
    hinweis: 'Regel R6: wer auf Aenderungen reagieren muss, wird gerufen.'
  },
  {
    name: 'MutationObserver in geladenen Patches',
    ist: zaehle(patchQuelltext, /new MutationObserver/g),
    max: 11,
    ziel: 0,
    hinweis: 'Regel R6.'
  },
  {
    name: '!important in index.html und allen Laufzeit-Dateien',
    ist: zaehle(indexHtml, /!important/g) + zaehle(allePatchQuelltexte, /!important/g),
    max: 718,
    ziel: 50,
    hinweis: 'Regel R3. → Welle 2 loest den grossen Teil davon auf.'
  }
];

/** Zusaetzliche Struktur-Zusicherungen, die keine Zahl sind. */
const ZUSICHERUNGEN = [
  {
    name: 'Die Kernmodule stehen als Skript-Tags im Kopf von index.html',
    erfuellt: ['admin-format.js', 'admin-feedback.js', 'admin-lifecycle.js', 'admin-api.js']
      .every((datei) => indexHtml.includes(`/shared/core/${datei}`)),
    hinweis: 'Nur so stehen sie garantiert vor dem Inline-Skript bereit. '
      + 'Ueber die Nachladeliste in offer-brand.js waere die Reihenfolge wieder ein Rennen.'
  },
  {
    name: 'callAdminFunction delegiert an VoxeraAdminApi',
    erfuellt: /async function callAdminFunction[^]{0,200}VoxeraAdminApi\.call/.test(indexHtml),
    hinweis: 'index.html besitzt nur noch den Zugang zur Admin-Session.'
  },
  {
    name: 'Kein Patch definiert showToast, voxAlert, voxConfirm oder voxPrompt neu',
    erfuellt: !/(?:w|root|window)\.(?:showToast|voxAlert|voxConfirm|voxPrompt)\s*=\s*[^=]/.test(allePatchQuelltexte),
    hinweis: 'Regel R4: eine Tonalitaet.'
  },
  {
    name: 'Die Kopfzeile hat genau einen Eigentuemer',
    erfuellt: !/\.card-head\s*\{[^}]*background\s*:/.test(indexHtml)
      && !/vox-dark-head/.test(allePatchQuelltexte.replace(/\/\*[\s\S]*?\*\//g, ''))
      && /\.card-head,/.test(readFileSync(join(ADMIN, 'shared/admin-components.css'), 'utf8')),
    hinweis: 'Kopfzeilen-Regeln gehoeren ausschliesslich in shared/admin-components.css. '
      + 'Die Kontrastmessung applyDarkHeaderContrast() darf nicht zurueckkehren -- sie war die '
      + 'Alleinursache der 30 unlesbaren Ueberschriften.'
  },
  {
    name: 'Die Farbwerte stehen in der Token-Datei, nicht in JavaScript',
    erfuellt: existsSync(join(ADMIN, 'shared/admin-design-tokens.css'))
      && indexHtml.includes('/shared/admin-design-tokens.css')
      && indexHtml.includes('/shared/admin-components.css'),
    hinweis: 'Beide Dateien muessen NACH den <style>-Bloecken eingebunden sein, sonst braucht es wieder !important.'
  },
  {
    name: 'Jede Datei in shared/ ohne admin-runtime-Praefix wird auch geladen',
    erfuellt: patchDateien.every((name) => geladenePatches.includes(name))
      || patchDateien.filter((name) => !geladenePatches.includes(name)).join(',') === 'admin-runtime-qr-invoice-controls.js',
    hinweis: 'admin-runtime-qr-invoice-controls.js ist bekannter toter Code und '
      + 'steht in docs/ADMIN_PORTAL_TOTER_CODE_LISTE_2026-08-10.md. '
      + 'Kommt eine weitere ungeladene Datei dazu, ist das ein Versehen.'
  }
];

let fehler = 0;

console.log('Struktur-Ratsche Admin-Portal\n');
console.log('  Kennzahl                                                     ist    max    ziel');
console.log('  ' + '─'.repeat(78));
for (const ratsche of RATSCHEN) {
  const ok = ratsche.ist <= ratsche.max;
  if (!ok) fehler += 1;
  const zeile = '  ' + (ok ? '✓' : '✗') + ' ' + ratsche.name.padEnd(58)
    + String(ratsche.ist).padStart(5) + String(ratsche.max).padStart(7) + String(ratsche.ziel).padStart(8);
  console.log(zeile);
  if (!ok) {
    console.log(`      ${ratsche.hinweis}`);
    console.log(`      Der Wert ist von ${ratsche.max} auf ${ratsche.ist} gestiegen. Steigen ist nicht vorgesehen —`);
    console.log('      entweder die Aenderung anders loesen, oder die Obergrenze hier bewusst anheben');
    console.log('      und im PR begruenden.');
  }
}

console.log('\n  Zusicherungen');
console.log('  ' + '─'.repeat(78));
for (const zusicherung of ZUSICHERUNGEN) {
  if (!zusicherung.erfuellt) fehler += 1;
  console.log('  ' + (zusicherung.erfuellt ? '✓' : '✗') + ' ' + zusicherung.name);
  if (!zusicherung.erfuellt) console.log(`      ${zusicherung.hinweis}`);
}

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
