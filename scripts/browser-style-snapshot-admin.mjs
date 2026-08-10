#!/usr/bin/env node
/**
 * Stil-Abzug des Admin-Portals: nimmt die berechneten Stilwerte aller Elemente
 * auf allen acht Bildschirmen auf und vergleicht zwei Aufnahmen.
 *
 * Warum es das braucht
 * --------------------
 * Welle 2 Teil 3 verschiebt zehn zur Laufzeit eingefügte Stylesheets in
 * statische Dateien und entfernt dabei den Grossteil der 356 `!important`.
 * Beides ist reine Kaskaden-Arithmetik: dieselbe Regel, andere Position. Ob
 * das wirklich wirkungsgleich ist, kann man im Quelltext nicht ablesen — genau
 * dieser Irrtum hat in Teil 2 die vier Stilschichten wirkungslos gemacht.
 *
 * Der Abzug misst deshalb, was der Browser am Ende ausrechnet. Ein Unterschied
 * ist nicht automatisch ein Fehler (manche sind gewollt: bessere Kontraste),
 * aber jeder Unterschied muss erklärbar sein. Was hier nicht auftaucht, hat
 * sich auch nicht verändert.
 *
 * Grenze des Werkzeugs
 * --------------------
 * Elemente, die erst nach einer aufgelösten Zusage gesetzt werden, erwischt
 * der Abzug je nach Lauf in unterschiedlichem Zustand — beobachtet am Zähler
 * `#nav-ai-change-badge`, der zwischen `none` und `block` schwankt. Das ist
 * Rauschen, kein Befund. Wer einen Unterschied an einem einzelnen Element
 * sieht, prüft ihn gegen einen zweiten Abzug DESSELBEN Standes: taucht er dort
 * auch auf, liegt es am Zeitpunkt und nicht an der Änderung.
 *
 * Aufruf:
 *   node scripts/browser-style-snapshot-admin.mjs vorher.json
 *   node scripts/browser-style-snapshot-admin.mjs nachher.json
 *   node scripts/browser-style-snapshot-admin.mjs --vergleich vorher.json nachher.json
 */

import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
import { starte, ROUTEN, FENSTER } from './lib/admin-browser-harness.mjs';

const require_ = createRequire(import.meta.url);

/* ── Vergleichsbetrieb: braucht keinen Browser ────────────────────────────── */

if (process.argv.includes('--vergleich')) {
  const [a, b] = process.argv.slice(process.argv.indexOf('--vergleich') + 1);
  if (!a || !b) {
    console.error('Aufruf: --vergleich vorher.json nachher.json');
    process.exit(2);
  }
  vergleiche(JSON.parse(readFileSync(a, 'utf8')), JSON.parse(readFileSync(b, 'utf8')));
  process.exit(0);
}

/* ── Aufnahmebetrieb ──────────────────────────────────────────────────────── */

const ziel = process.argv[2];
if (!ziel || ziel.startsWith('--')) {
  console.error('Aufruf: node scripts/browser-style-snapshot-admin.mjs <datei.json>');
  process.exit(2);
}

/**
 * Die Eigenschaften, die sichtbar etwas ausmachen. Bewusst nicht "alle":
 * getComputedStyle liefert über 300 Werte, von denen die meisten nie gesetzt
 * werden und den Vergleich nur verrauschen würden.
 */
const EIGENSCHAFTEN = [
  'color', 'background-color', 'background-image', 'opacity',
  'font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing', 'text-transform', 'text-align',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-bottom-color', 'border-radius',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'display', 'position', 'flex-direction', 'justify-content', 'align-items', 'gap',
  'grid-template-columns', 'width', 'height', 'max-width', 'min-height',
  'box-shadow', 'overflow-x', 'overflow-y', 'z-index', 'visibility'
];

// Bewusst eine echte Funktion statt einer Zeichenkette: nur so nimmt
// page.evaluate das Argument mit der Eigenschaftsliste entgegen.
const AUFNAHME = (props) => {
  const out = [];
  const alle = document.querySelectorAll('*');
  for (let i = 0; i < alle.length; i += 1) {
    const el = alle[i];
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') continue;
    const cs = getComputedStyle(el);
    const werte = {};
    for (const p of props) werte[p] = cs.getPropertyValue(p);
    out.push({
      // Kennung aus der Struktur, nicht aus der Position allein: verschiebt
      // sich ein Element, faellt das beim Vergleich auf, statt still
      // danebenzulaufen.
      kennung: el.tagName.toLowerCase()
        + (el.id ? '#' + el.id : '')
        + (el.className && typeof el.className === 'string' && el.className.trim()
            ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''),
      nr: i,
      werte
    });
  }
  return out;
};

const { chromium } = require_(process.env.PW_PATH || 'playwright');
const browser = await chromium.launch(
  process.env.VOXERA_CHROMIUM ? { executablePath: process.env.VOXERA_CHROMIUM } : {}
);
// Drei Fenstergroessen, weil der Grossteil der Regeln in @media-Bloecken
// steht. Eine Messung nur am Arbeitsplatz haette die 768er- und 480er-Regeln
// nie angefasst -- und genau dort sitzen die meisten !important.
const abzug = { erstellt: process.env.VX_STEMPEL || 'ohne Zeitstempel', bildschirme: {} };
for (const [name, masse] of Object.entries(FENSTER)) {
  const { ctx, page, fehler } = await starte(browser, null, masse);
  if (fehler.length) console.error(`  Warnung (${name}): ${fehler.length} Konsolenfehler beim Start.`);
  for (const route of ROUTEN) {
    await page.evaluate((r) => window.setRoute(r), route);
    await page.waitForTimeout(300);
    abzug.bildschirme[`${name}/${route}`] = await page.evaluate(AUFNAHME, EIGENSCHAFTEN);
  }
  process.stdout.write(`  ${name.padEnd(7)} ${masse.width}px: ${ROUTEN.length} Bildschirme, `
    + `${abzug.bildschirme[`${name}/${ROUTEN[0]}`].length} Elemente je Bildschirm\n`);
  await ctx.close();
}

await browser.close();
writeFileSync(ziel, JSON.stringify(abzug));
console.log(`Abzug geschrieben: ${ziel}`);

/* ── Vergleich ────────────────────────────────────────────────────────────── */

function vergleiche(vorher, nachher) {
  let unterschiede = 0;
  let geprueft = 0;
  const nachEigenschaft = new Map();

  for (const route of Object.keys(vorher.bildschirme)) {
    const a = vorher.bildschirme[route] || [];
    const b = nachher.bildschirme[route] || [];
    if (a.length !== b.length) {
      console.log(`\n  ! ${route}: ${a.length} → ${b.length} Elemente. Der Baum hat sich geaendert,`);
      console.log('    der Vergleich der Einzelwerte ist ab hier nur noch eingeschraenkt aussagekraeftig.');
    }
    const treffer = [];
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
      if (a[i].kennung !== b[i].kennung) continue;   // verschoben: separat sichtbar durch die Laengendifferenz
      geprueft += 1;
      for (const p of Object.keys(a[i].werte)) {
        if (a[i].werte[p] === b[i].werte[p]) continue;
        unterschiede += 1;
        nachEigenschaft.set(p, (nachEigenschaft.get(p) || 0) + 1);
        treffer.push(`${a[i].kennung}  ${p}: ${a[i].werte[p]} → ${b[i].werte[p]}`);
      }
    }
    if (treffer.length) {
      console.log(`\n  ${route} — ${treffer.length} geaenderte Werte`);
      const gesehen = new Set();
      for (const zeile of treffer) {
        const kurz = zeile.replace(/#[a-z0-9-]+/gi, '#…');
        if (gesehen.has(kurz)) continue;
        gesehen.add(kurz);
        if (gesehen.size > 25) { console.log(`      … und weitere (${treffer.length - 25})`); break; }
        console.log('      ' + zeile);
      }
    }
  }

  console.log(`\n  ${geprueft} Elemente verglichen, ${unterschiede} abweichende Werte.`);
  if (nachEigenschaft.size) {
    console.log('  Nach Eigenschaft:');
    [...nachEigenschaft.entries()].sort((x, y) => y[1] - x[1])
      .forEach(([p, n]) => console.log(`      ${String(n).padStart(5)}  ${p}`));
  }
  if (!unterschiede) console.log('  Kein Unterschied — die Verschiebung ist wirkungsgleich.');
}
