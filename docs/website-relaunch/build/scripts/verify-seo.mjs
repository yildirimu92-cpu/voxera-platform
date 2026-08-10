#!/usr/bin/env node
/**
 * Build-Waechter. Laeuft nach `astro build` gegen die erzeugten HTML-Dateien.
 *
 * Warum es das gibt: Auf der alten Seite ist ein Aktionspreis mit Ablaufdatum
 * „31. Mai 2026" ueber zwei Monate lang als aktuell stehen geblieben, weil
 * nichts geprueft hat, ob er noch gilt. Und die Rechtstexte hatten weder
 * Description noch Canonical, weil es niemandem aufgefallen ist.
 *
 * Beides sind Fehler, die still passieren. Deshalb brechen sie hier den Build.
 *
 * Aufruf: node scripts/verify-seo.mjs  (Teil von `npm run build`)
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const DIST = 'dist';
const MAX_TITEL = 60;
const MAX_BESCHREIBUNG = 155;
const JS_BUDGET_KB = 30;

const fehler = [];
const warnungen = [];

async function htmlDateien(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await htmlDateien(p)));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const einmal = (s, re) => (s.match(re) || []).length;
const inhalt = (s, re) => (s.match(re)?.[1] ?? '').trim();

const dateien = await htmlDateien(DIST);
if (dateien.length === 0) fehler.push('Keine HTML-Dateien in dist/ gefunden.');

const titelGesehen = new Map();
const beschreibungGesehen = new Map();

for (const datei of dateien) {
  const s = await readFile(datei, 'utf8');
  const seite = '/' + relative(DIST, datei).replace(/index\.html$/, '');
  const noindex = /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(s);

  const titel = inhalt(s, /<title>([\s\S]*?)<\/title>/i);
  const beschreibung = inhalt(s, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);

  if (!titel) fehler.push(`${seite}: <title> fehlt`);
  else if (titel.length > MAX_TITEL) warnungen.push(`${seite}: Titel ${titel.length} Zeichen (> ${MAX_TITEL})`);

  if (!beschreibung) fehler.push(`${seite}: meta description fehlt`);
  else if (beschreibung.length > MAX_BESCHREIBUNG) warnungen.push(`${seite}: Description ${beschreibung.length} Zeichen (> ${MAX_BESCHREIBUNG})`);

  // Doppelte Titel/Descriptions: zwei Seiten, die um dasselbe Keyword
  // konkurrieren, entwerten sich gegenseitig. Nur fuer indexierte Seiten.
  if (!noindex) {
    if (titel) {
      if (titelGesehen.has(titel)) fehler.push(`Titel doppelt: "${titel}" auf ${titelGesehen.get(titel)} und ${seite}`);
      else titelGesehen.set(titel, seite);
    }
    if (beschreibung) {
      if (beschreibungGesehen.has(beschreibung)) fehler.push(`Description doppelt: ${beschreibungGesehen.get(beschreibung)} und ${seite}`);
      else beschreibungGesehen.set(beschreibung, seite);
    }
  }

  if (einmal(s, /<link[^>]+rel=["']canonical["']/gi) !== 1) fehler.push(`${seite}: genau ein Canonical erwartet`);

  // Layout-Shift: jedes Bild braucht width und height (Zielbild B.5, CLS < 0.05).
  for (const tag of s.match(/<img\b[^>]*>/gi) ?? []) {
    if (!/\bwidth=/.test(tag) || !/\bheight=/.test(tag)) {
      fehler.push(`${seite}: <img> ohne width/height — ${tag.slice(0, 90)}`);
    }
  }

  // Abgelaufene Angebote. Das ist der Befund C1, technisch abgesichert.
  for (const m of s.matchAll(/"priceValidUntil"\s*:\s*"(\d{4}-\d{2}-\d{2})"/g)) {
    if (new Date(m[1]) < new Date()) {
      fehler.push(`${seite}: priceValidUntil ${m[1]} liegt in der Vergangenheit — abgelaufene Aktion wird als gueltig ausgeliefert`);
    }
  }

  // Kein Google-Fonts-CDN (Content-Audit C12).
  if (/fonts\.(googleapis|gstatic)\.com/.test(s)) {
    fehler.push(`${seite}: laedt Schriften vom Google-CDN — Schriften werden selbst ausgeliefert`);
  }
}

// noindex und Sitemap muessen zusammenpassen. Eine Seite, die man Google per
// Sitemap anbietet und gleichzeitig per noindex verbietet, ist ein
// Widerspruch — und er entsteht leise, sobald jemand eine Seite sperrt und den
// Sitemap-Filter vergisst.
{
  let sitemapXml = '';
  for (const name of ['sitemap-0.xml', 'sitemap-index.xml']) {
    try { sitemapXml += await readFile(join(DIST, name), 'utf8'); } catch { /* nicht vorhanden */ }
  }
  if (sitemapXml) {
    for (const datei of dateien) {
      const s = await readFile(datei, 'utf8');
      if (!/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(s)) continue;
      const pfad = '/' + relative(DIST, datei).replace(/index\.html$/, '');
      if (sitemapXml.includes(pfad === '/' ? `${DIST}/` : pfad)) {
        fehler.push(`${pfad}: steht auf noindex, ist aber in der Sitemap — Filter in astro.config.mjs ergaenzen`);
      }
    }
  }
}

// JS-Budget ueber die ganze Seite.
let jsBytes = 0;
async function jsDateien(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await jsDateien(p)));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
for (const j of await jsDateien(DIST)) jsBytes += (await readFile(j)).length;
const jsKb = jsBytes / 1024;
if (jsKb > JS_BUDGET_KB * 3) {
  // roher Vergleich; das Budget gilt gzipped, ungezippt als grobe Schranke
  warnungen.push(`JavaScript ungezippt ${jsKb.toFixed(1)} KB — Budget ist ${JS_BUDGET_KB} KB gzipped, bitte pruefen`);
}

for (const w of warnungen) console.warn(`WARNUNG  ${w}`);
for (const f of fehler) console.error(`FEHLER   ${f}`);

console.log(`\n${dateien.length} Seiten geprueft — ${fehler.length} Fehler, ${warnungen.length} Warnungen.`);
if (fehler.length) process.exit(1);
