#!/usr/bin/env node
/**
 * Findet die echten Regelkonflikte im Admin-Portal.
 *
 * Warum es das braucht
 * --------------------
 * `!important` ist kein Stilmittel, sondern eine Wette darauf, dass irgendwo
 * eine andere Regel dasselbe anders sagt. In diesem Portal stehen 356 davon.
 * Sie pauschal zu entfernen ist unmöglich — der Versuch änderte 2288 berechnete
 * Werte. Sie stehen zu lassen ist aber auch keine Lösung, denn genau diese
 * Wetten machen jede weitere Änderung unvorhersehbar.
 *
 * Zwischen beidem liegt die Frage, die dieses Skript beantwortet: welche
 * `!important` haben überhaupt einen Gegenspieler? Ein `!important`, dessen
 * Eigenschaft von keiner anderen Regel auf denselben Elementen gesetzt wird,
 * gewinnt auch ohne. Es kann ersatzlos weg — nachweisbar, nicht vermutet.
 *
 * Wie es prüft
 * ------------
 * Am gebauten Dokument, nicht am Text: für jede Regel wird die Elementmenge
 * per querySelectorAll bestimmt. Zwei Regeln kollidieren, wenn sie dieselbe
 * Eigenschaft auf mindestens einem gemeinsamen Element setzen. Selektoren zu
 * vergleichen, ohne sie anzuwenden, wäre wieder eine Textsuche — und die hat
 * in diesem Umbau schon zweimal danebengelegen.
 *
 * Aufruf:  node scripts/browser-css-collisions-admin.mjs [--alle]
 */

import { createRequire } from 'node:module';
import { starte, ROUTEN, FENSTER } from './lib/admin-browser-harness.mjs';

const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PW_PATH || 'playwright');
const ALLE = process.argv.includes('--alle');

/**
 * Läuft im Browser: sammelt alle Regeln aus allen Stylesheets, bestimmt je
 * Regel die getroffenen Elemente und meldet für jede `!important`-Deklaration,
 * ob eine andere Regel dieselbe Eigenschaft auf einem gemeinsamen Element setzt.
 */
const ANALYSE = () => {
  const regeln = [];
  const quelle = (blatt) => {
    if (blatt.href) return new URL(blatt.href).pathname.split('/').pop().split('?')[0];
    const knoten = blatt.ownerNode;
    return knoten && knoten.id ? `<style#${knoten.id}>` : '<style>';
  };

  const sammle = (blatt, name, medium) => {
    let liste;
    try { liste = blatt.cssRules; } catch { return; }        // fremde Herkunft
    for (const regel of liste) {
      if (regel.media) { sammle(regel, name, regel.conditionText || String(regel.media.mediaText)); continue; }
      if (regel.cssRules && !regel.selectorText) { sammle(regel, name, medium); continue; }
      if (!regel.selectorText || !regel.style) continue;
      let treffer;
      try { treffer = document.querySelectorAll(regel.selectorText); } catch { continue; }
      if (!treffer.length) continue;
      const menge = new Set();
      treffer.forEach((el) => menge.add(el.__vxNr));
      const eigenschaften = [];
      for (let i = 0; i < regel.style.length; i += 1) {
        const p = regel.style[i];
        eigenschaften.push({ p, wichtig: regel.style.getPropertyPriority(p) === 'important' });
      }
      regeln.push({ quelle: name, medium, selektor: regel.selectorText, menge, eigenschaften });
    }
  };

  document.querySelectorAll('*').forEach((el, i) => { el.__vxNr = i; });
  for (const blatt of document.styleSheets) sammle(blatt, quelle(blatt), '');

  // Fuer jede !important-Deklaration: gibt es eine andere Regel, die dieselbe
  // Eigenschaft auf einem gemeinsamen Element setzt?
  const befunde = [];
  for (const regel of regeln) {
    for (const { p, wichtig } of regel.eigenschaften) {
      if (!wichtig) continue;
      const gegner = [];
      for (const anderer of regeln) {
        if (anderer === regel) continue;
        if (!anderer.eigenschaften.some((e) => e.p === p)) continue;
        let gemeinsam = false;
        for (const nr of anderer.menge) if (regel.menge.has(nr)) { gemeinsam = true; break; }
        if (gemeinsam) gegner.push(`${anderer.quelle}${anderer.medium ? ' @' + anderer.medium : ''}: ${anderer.selektor}`);
      }
      befunde.push({
        quelle: regel.quelle, medium: regel.medium, selektor: regel.selektor, eigenschaft: p,
        elemente: regel.menge.size, gegner
      });
    }
  }
  return befunde;
};

/**
 * Die schärfere Frage: trägt das `!important` wirklich?
 *
 * Ein Gegenspieler allein sagt nichts — die Regel könnte auch ohne Priorität
 * gewinnen, weil sie später steht oder spezifischer ist. Deshalb wird die
 * Priorität im gebauten Dokument weggenommen und nachgemessen. Ändert sich
 * kein berechneter Wert auf keinem getroffenen Element, war sie überflüssig.
 * Danach wird sie sofort zurückgesetzt, damit die nächste Messung auf dem
 * unveränderten Stand aufsetzt.
 */
const TRAGEND = () => {
  const ergebnis = [];
  const quelle = (blatt) => {
    if (blatt.href) return new URL(blatt.href).pathname.split('/').pop().split('?')[0];
    const knoten = blatt.ownerNode;
    return knoten && knoten.id ? `<style#${knoten.id}>` : '<style>';
  };

  const regeln = [];
  const sammle = (blatt, name, medium) => {
    let liste;
    try { liste = blatt.cssRules; } catch { return; }
    for (const regel of liste) {
      if (regel.media) { sammle(regel, name, regel.conditionText || String(regel.media.mediaText)); continue; }
      if (regel.cssRules && !regel.selectorText) { sammle(regel, name, medium); continue; }
      if (regel.selectorText && regel.style) regeln.push({ regel, name, medium });
    }
  };
  for (const blatt of document.styleSheets) sammle(blatt, quelle(blatt), '');

  for (const { regel, name, medium } of regeln) {
    const wichtige = [];
    for (let i = 0; i < regel.style.length; i += 1) {
      const p = regel.style[i];
      if (regel.style.getPropertyPriority(p) === 'important') wichtige.push(p);
    }
    if (!wichtige.length) continue;
    let treffer;
    try { treffer = [...document.querySelectorAll(regel.selectorText)]; } catch { continue; }
    if (!treffer.length) continue;

    for (const p of wichtige) {
      const wert = regel.style.getPropertyValue(p);
      const vorher = treffer.map((el) => getComputedStyle(el).getPropertyValue(p));
      regel.style.setProperty(p, wert, '');                     // Priorität weg
      const nachher = treffer.map((el) => getComputedStyle(el).getPropertyValue(p));
      regel.style.setProperty(p, wert, 'important');            // sofort zurück
      const traegt = vorher.some((v, i) => v !== nachher[i]);
      ergebnis.push({ quelle: name, medium, selektor: regel.selectorText, eigenschaft: p, elemente: treffer.length, traegt });
    }
  }
  return ergebnis;
};

if (process.argv.includes('--tragend')) {
  const browser2 = await chromium.launch(
    process.env.VOXERA_CHROMIUM ? { executablePath: process.env.VOXERA_CHROMIUM } : {}
  );
  const gesamt2 = new Map();
  for (const [fname, masse] of Object.entries(FENSTER)) {
    const { ctx, page } = await starte(browser2, null, masse);
    for (const route of ROUTEN) {
      await page.evaluate((r) => window.setRoute(r), route);
      await page.waitForTimeout(250);
      for (const b of await page.evaluate(TRAGEND)) {
        const s = `${b.quelle}|${b.medium}|${b.selektor}|${b.eigenschaft}`;
        // Traegt es auf IRGENDEINEM Bildschirm oder in IRGENDEINER
        // Fenstergroesse, dann traegt es. Ein einziger Treffer genuegt.
        const alt = gesamt2.get(s);
        if (alt) alt.traegt = alt.traegt || b.traegt;
        else gesamt2.set(s, { ...b });
      }
    }
    await ctx.close();
    process.stdout.write(`  ${fname} (${masse.width}px) vermessen\n`);
  }
  await browser2.close();

  const alle2 = [...gesamt2.values()];
  const entbehrlich = alle2.filter((b) => !b.traegt);
  console.log(`\n${alle2.length} !important-Deklarationen im gebauten Dokument getestet`);
  console.log(`  ${entbehrlich.length} aendern nichts, wenn man ihnen die Prioritaet nimmt — entbehrlich`);
  console.log(`  ${alle2.length - entbehrlich.length} tragen wirklich\n`);
  const nach = new Map();
  for (const b of alle2) {
    const e = nach.get(b.quelle) || { weg: 0, bleibt: 0 };
    b.traegt ? (e.bleibt += 1) : (e.weg += 1);
    nach.set(b.quelle, e);
  }
  console.log('  Quelle                              entbehrlich    tragend');
  console.log('  ' + '─'.repeat(64));
  for (const [q, e] of nach) console.log(`  ${q.padEnd(36)} ${String(e.weg).padStart(9)}   ${String(e.bleibt).padStart(10)}`);
  console.log('\n  Tragende Deklarationen:');
  for (const b of alle2.filter((x) => x.traegt)) {
    console.log(`    ${b.quelle}${b.medium ? ' @' + b.medium : ''}  ${b.selektor} {${b.eigenschaft}}`);
  }
  process.exit(0);
}

const browser = await chromium.launch(
  process.env.VOXERA_CHROMIUM ? { executablePath: process.env.VOXERA_CHROMIUM } : {}
);

const gesamt = new Map();   // Schluessel: quelle|selektor|eigenschaft
for (const [fname, masse] of Object.entries(FENSTER)) {
  const { ctx, page } = await starte(browser, null, masse);
  for (const route of ROUTEN) {
    await page.evaluate((r) => window.setRoute(r), route);
    await page.waitForTimeout(250);
    for (const b of await page.evaluate(ANALYSE)) {
      const schluessel = `${b.quelle}|${b.medium}|${b.selektor}|${b.eigenschaft}`;
      const bestand = gesamt.get(schluessel);
      if (bestand) b.gegner.forEach((g) => bestand.gegner.add(g));
      else gesamt.set(schluessel, { ...b, gegner: new Set(b.gegner) });
    }
  }
  await ctx.close();
  process.stdout.write(`  ${fname} (${masse.width}px) vermessen\n`);
}
await browser.close();

const alle = [...gesamt.values()];
const ohne = alle.filter((b) => b.gegner.size === 0);
const mit = alle.filter((b) => b.gegner.size > 0);

console.log(`\n${alle.length} !important-Deklarationen auf sichtbaren Elementen gemessen`);
console.log(`  ${ohne.length} ohne jeden Gegenspieler — koennen ersatzlos weg`);
console.log(`  ${mit.length} mit Gegenspieler — brauchen eine Entscheidung, welche Regel gilt\n`);

const nachQuelle = new Map();
for (const b of alle) {
  const e = nachQuelle.get(b.quelle) || { ohne: 0, mit: 0 };
  b.gegner.size ? (e.mit += 1) : (e.ohne += 1);
  nachQuelle.set(b.quelle, e);
}
console.log('  Quelle                              ohne Gegner   mit Gegner');
console.log('  ' + '─'.repeat(64));
for (const [q, e] of [...nachQuelle.entries()].sort((a, b) => (b[1].mit + b[1].ohne) - (a[1].mit + a[1].ohne))) {
  console.log(`  ${q.padEnd(36)} ${String(e.ohne).padStart(9)}   ${String(e.mit).padStart(10)}`);
}

if (ALLE) {
  console.log('\n  Deklarationen mit Gegenspieler:');
  for (const b of mit.sort((a, z) => z.gegner.size - a.gegner.size)) {
    console.log(`\n    ${b.quelle}${b.medium ? ' @' + b.medium : ''}`);
    console.log(`      ${b.selektor}  {${b.eigenschaft}}   (${b.elemente} Elemente)`);
    [...b.gegner].slice(0, 4).forEach((g) => console.log(`        gegen  ${g}`));
    if (b.gegner.size > 4) console.log(`        … und ${b.gegner.size - 4} weitere`);
  }
}
