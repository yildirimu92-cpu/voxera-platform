#!/usr/bin/env node
// Erzeugt die PNG-Varianten der App-Ikone aus der einen SVG-Quelle
// (brand/05-app-icon-512px.svg). Laeuft NICHT im Netlify-Build -- die PNGs
// sind committet, weil der Build keinen Browser hat. Dieses Skript ist der
// Weg, sie nach einer Aenderung der Quelle neu zu erzeugen:
//
//   node tools/build-brand-icons.mjs
//
// Gerastert wird mit dem lokalen Chromium (Playwright-Installation oder
// System-Chrome). Ohne Browser bricht das Skript mit einer Meldung ab,
// statt stillschweigend nichts zu tun.
//
// Zur Eckenrundung, der einzigen inhaltlichen Entscheidung hier:
// Die Quelle traegt `rx="120"`, also abgerundete Ecken. Fuer favicon-16 und
// favicon-32 bleibt das so -- sie werden unveraendert dargestellt.
// apple-touch-icon-180 und die beiden maskable-Ikonen bekommen dagegen
// `rx="0"`, also eine randlos gefuellte Flaeche. Grund: iOS und Android
// legen ihre EIGENE Maske darueber. Eine bereits gerundete Vorlage ergibt
// dort doppelt gerundete Ecken, und die transparenten Restecken rendert iOS
// schwarz. Der Bildinhalt selbst liegt mit ~32 % Abstand vom Mittelpunkt
// bequem in der 40-%-Sicherheitszone, die maskable verlangt -- er muss dafuer
// nicht skaliert werden.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const quelle = join(wurzel, 'brand', '05-app-icon-512px.svg');

// rund: die Quelle unveraendert. randlos: `rx` auf 0, siehe Kopfkommentar.
const ZIELE = [
  { datei: 'favicon-16.png',           groesse: 16,  randlos: false },
  { datei: 'favicon-32.png',           groesse: 32,  randlos: false },
  { datei: 'apple-touch-icon-180.png', groesse: 180, randlos: true  },
  { datei: 'icon-192.png',             groesse: 192, randlos: true  },
  { datei: 'icon-512.png',             groesse: 512, randlos: true  },
];

// headless_shell zuerst, und das ist kein Geschmack: beim vollen Chromium
// setzt --window-size die FENSTER-Groesse, der Viewport faellt rund 84 px
// niedriger aus. Das PNG hat dann zwar die richtigen Masse im Kopf, ist
// unten aber leer -- beim ersten Versuch war die 180er-Ikone auf halber
// Hoehe abgeschnitten, waehrend eine Pruefung auf Breite/Hoehe gruen meldete.
// Im headless_shell entspricht --window-size dem Viewport.
function browserFinden() {
  const fest = [
    process.env.CHROME_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);

  // Playwright traegt die Version im Ordnernamen -- ein fester Pfad veraltet
  // mit dem naechsten Update, deshalb der Durchlauf.
  const basis = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const ausPlaywright = [];
  if (existsSync(basis)) {
    for (const name of readdirSync(basis)) {
      for (const bin of ['headless_shell', 'chrome']) {
        const pfad = join(basis, name, 'chrome-linux', bin);
        if (existsSync(pfad)) ausPlaywright.push({ pfad, shell: bin === 'headless_shell' });
      }
    }
    ausPlaywright.sort((a, b) => Number(b.shell) - Number(a.shell));
  }

  for (const eintrag of ausPlaywright) return eintrag;
  for (const pfad of fest) if (existsSync(pfad)) return { pfad, shell: false };
  return null;
}

const browser = browserFinden();
if (!browser) {
  console.error('Kein Chromium gefunden. Pfad ueber CHROME_PATH setzen oder');
  console.error('Playwright-Browser installieren. Es wurde nichts geschrieben.');
  process.exit(1);
}
if (!browser.shell) {
  console.warn(`Warnung: ${browser.pfad} ist kein headless_shell. Dort ist`);
  console.warn('--window-size die Fenster- und nicht die Viewport-Groesse; die');
  console.warn('Pixelpruefung unten faengt ein abgeschnittenes Bild ab.');
}

// Minimaler PNG-Leser. Grund fuer den Aufwand: die Masse im IHDR-Kopf sagen
// nichts darueber, ob das Bild auch gemalt wurde -- genau daran ist der erste
// Anlauf vorbeigelaufen. Geprueft werden muss der Inhalt.
function pngPixel(bytes) {
  const breite = bytes.readUInt32BE(16);
  const hoehe = bytes.readUInt32BE(20);
  const tiefe = bytes[24];
  const farbtyp = bytes[25];
  if (tiefe !== 8 || (farbtyp !== 6 && farbtyp !== 2)) {
    throw new Error(`unerwartetes PNG-Format: Tiefe ${tiefe}, Farbtyp ${farbtyp}`);
  }
  const kanaele = farbtyp === 6 ? 4 : 3;

  const teile = [];
  for (let pos = 8; pos + 8 <= bytes.length;) {
    const laenge = bytes.readUInt32BE(pos);
    const typ = bytes.subarray(pos + 4, pos + 8).toString('latin1');
    if (typ === 'IDAT') teile.push(bytes.subarray(pos + 8, pos + 8 + laenge));
    if (typ === 'IEND') break;
    pos += 12 + laenge;
  }
  const roh = inflateSync(Buffer.concat(teile));

  // PNG-Zeilenfilter zuruecknehmen (Filtertypen 0..4, siehe RFC 2083).
  const zeile = breite * kanaele;
  const bild = Buffer.alloc(hoehe * zeile);
  for (let y = 0; y < hoehe; y++) {
    const filter = roh[y * (zeile + 1)];
    const quelle = roh.subarray(y * (zeile + 1) + 1, y * (zeile + 1) + 1 + zeile);
    for (let x = 0; x < zeile; x++) {
      const a = x >= kanaele ? bild[y * zeile + x - kanaele] : 0;
      const b = y > 0 ? bild[(y - 1) * zeile + x] : 0;
      const c = x >= kanaele && y > 0 ? bild[(y - 1) * zeile + x - kanaele] : 0;
      let wert = quelle[x];
      if (filter === 1) wert += a;
      else if (filter === 2) wert += b;
      else if (filter === 3) wert += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        wert += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      bild[y * zeile + x] = wert & 0xff;
    }
  }
  return {
    breite, hoehe, kanaele,
    at(x, y) {
      const i = y * zeile + x * kanaele;
      return { r: bild[i], g: bild[i + 1], b: bild[i + 2], a: kanaele === 4 ? bild[i + 3] : 255 };
    },
    farbenAnzahl() {
      const gesehen = new Set();
      for (let i = 0; i < bild.length; i += kanaele) {
        gesehen.add(`${bild[i]},${bild[i + 1]},${bild[i + 2]}`);
        if (gesehen.size > 8) break;
      }
      return gesehen.size;
    },
  };
}

const svgQuelle = readFileSync(quelle, 'utf8');
const arbeit = join(tmpdir(), `voxera-brand-icons-${process.pid}`);
mkdirSync(arbeit, { recursive: true });

try {
  for (const ziel of ZIELE) {
    // Die Quelle wird nur in Kopfmassen und Eckenradius angepasst, nie im
    // Bildinhalt -- damit bleibt die SVG die einzige Wahrheit.
    let svg = svgQuelle
      .replace(/width="512"/, `width="${ziel.groesse}"`)
      .replace(/height="512"/, `height="${ziel.groesse}"`);
    if (ziel.randlos) svg = svg.replace(/ rx="120"/, ' rx="0"');

    const seite = join(arbeit, `${ziel.datei}.html`);
    writeFileSync(seite, `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>\n${svg}\n`);

    const ausgabe = join(wurzel, 'brand', ziel.datei);
    execFileSync(browser.pfad, [
      ...(browser.shell ? [] : ['--headless=new']),
      '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--window-size=${ziel.groesse},${ziel.groesse}`,
      `--screenshot=${ausgabe}`,
      seite,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    const bytes = readFileSync(ausgabe);
    if (bytes.length < 25 || bytes.subarray(1, 4).toString() !== 'PNG') {
      throw new Error(`${ziel.datei}: keine PNG-Datei geschrieben`);
    }
    const bild = pngPixel(bytes);
    if (bild.breite !== ziel.groesse || bild.hoehe !== ziel.groesse) {
      throw new Error(`${ziel.datei}: erwartet ${ziel.groesse}x${ziel.groesse}, erhalten ${bild.breite}x${bild.hoehe}`);
    }

    // Die eigentliche Pruefung: der Inhalt, nicht der Kopf.
    // 1. Die letzte Zeile muss gemalt sein. Genau daran ist der Anlauf mit
    //    dem vollen Chromium gescheitert -- unten leer, Masse korrekt.
    const unten = bild.at(Math.floor(ziel.groesse / 2), ziel.groesse - 1);
    if (unten.a === 0) throw new Error(`${ziel.datei}: untere Bildkante ist leer -- Viewport kleiner als das Fenster?`);
    // 2. Bei den randlosen Varianten muss die Ecke die Markenfarbe tragen.
    //    Eine transparente Ecke rendert iOS schwarz und Android maskiert
    //    ein zweites Mal -- das ist der Grund fuer rx="0".
    if (ziel.randlos) {
      const ecke = bild.at(0, ziel.groesse - 1);
      if (ecke.a !== 255 || ecke.r !== 0x0d || ecke.g !== 0x1f || ecke.b !== 0x3c) {
        throw new Error(`${ziel.datei}: Ecke ist nicht #0D1F3C/deckend, sondern rgba(${ecke.r},${ecke.g},${ecke.b},${ecke.a})`);
      }
    }
    // 3. Mehr als eine Farbe -- sonst ist nur der Hintergrund da und die
    //    Bildmarke fehlt.
    if (bild.farbenAnzahl() < 3) throw new Error(`${ziel.datei}: einfarbig, die Bildmarke fehlt`);

    console.log(`${ziel.datei.padEnd(24)} ${bild.breite}x${bild.hoehe}  ${bytes.length} Bytes${ziel.randlos ? '  (randlos)' : ''}`);
  }
} finally {
  rmSync(arbeit, { recursive: true, force: true });
}
