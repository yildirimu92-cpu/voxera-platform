#!/usr/bin/env node
/**
 * Ermittelt, welche `!important` im Admin-Portal wirklich tragen.
 *
 * Warum kumulativ gemessen wird
 * -----------------------------
 * Der naheliegende Test — jeder Deklaration einzeln die Priorität nehmen und
 * schauen, ob sich etwas ändert — ist falsch, und zwar auf eine Art, die erst
 * am Ende auffällt. Zwei `!important`, die dasselbe Element betreffen,
 * verdecken sich gegenseitig: nimmt man einer die Priorität, gewinnt die
 * andere und nichts ändert sich; nimmt man beiden die Priorität, gewinnt eine
 * dritte Regel. Einzeln geprüft sehen beide entbehrlich aus, gemeinsam
 * entfernt brechen sie die Darstellung. Genau das ist in diesem Umbau
 * passiert: 694 einzeln unauffällige Deklarationen ergaben zusammen 1434
 * geänderte Werte.
 *
 * Dieses Skript entfernt deshalb kumulativ und misst gegen den
 * Ausgangszustand, nicht gegen den jeweils vorherigen Schritt. Nach jedem
 * angenommenen Wegfall gilt weiterhin: kein berechneter Wert weicht vom
 * Ausgangszustand ab. Was am Ende übrig bleibt, trägt nachweislich.
 *
 * Eine Deklaration muss in JEDEM Zusammenhang unauffällig sein — acht
 * Bildschirme mal drei Fenstergrössen. Ein einziger Treffer genügt, um sie zu
 * behalten.
 *
 * Aufruf:  node scripts/browser-important-audit-admin.mjs [ausgabe.json]
 */

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { starte, ROUTEN, FENSTER } from './lib/admin-browser-harness.mjs';

const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PW_PATH || 'playwright');
const ZIEL = process.argv[2] || null;

/**
 * Läuft im Browser. `behalten` ist die Menge der Schlüssel, die ihre Priorität
 * behalten müssen (aus früheren Zusammenhängen). Rückgabe: die Schlüssel, die
 * in DIESEM Zusammenhang zusätzlich behalten werden müssen.
 */
const PRUEFE = (behaltenListe) => {
  const behalten = new Set(behaltenListe);
  const quelle = (blatt) => {
    if (blatt.href) return new URL(blatt.href).pathname.split('/').pop().split('?')[0];
    const k = blatt.ownerNode;
    return k && k.id ? `<style#${k.id}>` : '<style>';
  };

  /* Alle Deklarationen mit Priorität einsammeln. */
  const posten = [];
  const sammle = (blatt, name, medium) => {
    let liste;
    try { liste = blatt.cssRules; } catch { return; }
    for (const regel of liste) {
      if (regel.media) { sammle(regel, name, regel.conditionText || String(regel.media.mediaText)); continue; }
      if (regel.cssRules && !regel.selectorText) { sammle(regel, name, medium); continue; }
      if (!regel.selectorText || !regel.style) continue;
      for (let i = 0; i < regel.style.length; i += 1) {
        const p = regel.style[i];
        if (regel.style.getPropertyPriority(p) !== 'important') continue;
        let treffer;
        try { treffer = [...document.querySelectorAll(regel.selectorText)]; } catch { continue; }
        posten.push({
          schluessel: `${name}|${medium}|${regel.selectorText}|${p}`,
          regel, p, wert: regel.style.getPropertyValue(p), treffer
        });
      }
    }
  };
  for (const blatt of document.styleSheets) sammle(blatt, quelle(blatt), '');

  /* Ausgangszustand: alle Prioritäten intakt. */
  const grund = posten.map((e) => e.treffer.map((el) => getComputedStyle(el).getPropertyValue(e.p)));
  const weichtAb = () => posten.some((e, i) =>
    e.treffer.some((el, j) => getComputedStyle(el).getPropertyValue(e.p) !== grund[i][j]));

  const neuBehalten = [];
  for (const e of posten) {
    if (behalten.has(e.schluessel)) continue;          // schon anderswo als tragend erkannt
    e.regel.style.setProperty(e.p, e.wert, '');        // Priorität weg — und weg lassen
    if (weichtAb()) {
      e.regel.style.setProperty(e.p, e.wert, 'important');   // doch nicht
      neuBehalten.push(e.schluessel);
    }
  }
  return { neuBehalten, gesamt: posten.length, abweichungAmEnde: weichtAb() };
};

/* ── Ablauf ───────────────────────────────────────────────────────────────── */

const browser = await chromium.launch(
  process.env.VOXERA_CHROMIUM ? { executablePath: process.env.VOXERA_CHROMIUM } : {}
);

let behalten = [];
let gesamt = 0;
let runde = 0;
let stabil = false;

// Mehrere Runden, weil eine spaeter erkannte Notwendigkeit die Bewertung in
// einem frueher geprueften Zusammenhang aendern kann.
while (!stabil && runde < 4) {
  runde += 1;
  const vorRunde = behalten.length;
  for (const [fname, masse] of Object.entries(FENSTER)) {
    const { ctx, page } = await starte(browser, null, masse);
    for (const route of ROUTEN) {
      await page.evaluate((r) => window.setRoute(r), route);
      await page.waitForTimeout(250);
      const { neuBehalten, gesamt: n, abweichungAmEnde } = await page.evaluate(PRUEFE, behalten);
      gesamt = Math.max(gesamt, n);
      behalten = [...new Set([...behalten, ...neuBehalten])];
      if (abweichungAmEnde) console.error(`  ! ${fname}/${route}: Abweichung trotz Ruecknahme — bitte pruefen`);
    }
    await ctx.close();
  }
  stabil = behalten.length === vorRunde;
  console.log(`  Runde ${runde}: ${behalten.length} tragende Deklarationen${stabil ? ' (stabil)' : ''}`);
}
await browser.close();

console.log(`\n${gesamt} Deklarationen mit Prioritaet gefunden`);
console.log(`  ${gesamt - behalten.length} sind kumulativ entbehrlich`);
console.log(`  ${behalten.length} tragen nachweislich\n`);

const nachQuelle = new Map();
for (const s of behalten) {
  const q = s.split('|')[0];
  nachQuelle.set(q, (nachQuelle.get(q) || 0) + 1);
}
for (const [q, n] of [...nachQuelle.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${q}`);
}

if (ZIEL) {
  writeFileSync(ZIEL, JSON.stringify({ behalten, gesamt }, null, 1));
  console.log(`\nListe geschrieben: ${ZIEL}`);
}
