// verify-mail-templates.mjs
//
// Waechter fuer die E-Mail-Vorlagen unter docs/email-templates/.
//
// Die Vorlagen leben im Repo, verschickt werden sie aus Make-Szenario 09.
// Diese Trennung kostet die Sicherheit, dass beide Seiten gleich sind — dagegen
// hilft nur die Regel "nie direkt in Make editieren". Was der Waechter dagegen
// leisten kann: verhindern, dass ein bekannter Fehler ein zweites Mal in eine
// Vorlage einwandert. Jede Regel hier steht fuer einen Fund aus der
// Inventarisierung vom 09.08.2026 (docs/EMAIL_VORLAGEN_NEUBAU_KONZEPT_2026-08-09.md).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'docs', 'email-templates');
const previewDir = path.join(dir, 'vorschau');

const errors = [];
const fail = (file, message) => errors.push(`${path.relative(root, file)}: ${message}`);

// Die vollstaendige Palette. Alle Werte stammen aus
// customer-dashboard/shared/customer-design-tokens.css; einzige Ausnahme ist
// #3D4A60 (Night bei 80 % ueber Weiss), weil E-Mail-Clients rgba() nicht
// durchgaengig tragen. Ein Hex-Wert ausserhalb dieser Liste ist die Drift,
// die den Bestand auf 61 verschiedene Farben gebracht hat.
const PALETTE = new Set([
  '#0d1f3c', '#e8c547', '#1a6fe8',                      // Night, Gold, Blau
  '#f7f8fa', '#f1f4f9', '#ffffff', '#e4e6ea', '#eef1f6', // Flaechen und Raender
  '#3d4a60', '#5b6472',                                  // Fliesstext, Beschriftung
  '#a9b6cc', '#34d399', '#fca5a5',                       // auf Night: gedaempft, Gruen, Rot
  '#eef4ff', '#bfdbfe', '#1558bf',                       // Hinweis
  '#ecfdf5', '#a7f3d0', '#047857', '#059669',            // Erfolg
  '#fffbeb', '#fde68a', '#b45309', '#d97706',            // Warnung
  '#fef2f2', '#fecaca', '#c0362c', '#dc2626',            // Gefahr
  '#fbf1d8', '#7a5c00', '#eef2f7'                        // Lead-Rampe (Heiss teilt Gold/Night)
]);

// Technik, die in E-Mail-Clients ausfaellt. Flexbox und Grid standen in drei
// Vorlagen des Bestands; die zweispaltigen Zeilen der Anruf-Mails fielen in
// Outlook dadurch zu einer Spalte zusammen.
const FORBIDDEN = [
  [/display\s*:\s*flex/i, 'display:flex — Outlook kennt Flexbox nicht, Tabellen-Layout verwenden'],
  [/display\s*:\s*grid/i, 'display:grid — Outlook kennt Grid nicht, Tabellen-Layout verwenden'],
  [/rgba\s*\(/i, 'rgba() — in Outlook unzuverlaessig, Hex-Wert der Mischfarbe verwenden'],
  [/linear-gradient|radial-gradient/i, 'Verlauf — Outlook rendert ihn nicht, einfarbige Flaeche verwenden'],
  [/box-shadow/i, 'box-shadow — faellt in Outlook aus, Rand statt Schatten'],
  [/::before|::after/i, 'Pseudoelement — faellt in Outlook aus'],
  [/white-space\s*:\s*pre-line/i, 'white-space:pre-line — die Word-Engine hinter Outlook wertet es nicht aus; '
    + 'Zeilenumbrueche serverseitig setzen, z. B. replace(1.email.body_text; newline; "<br>")'],
  [/@font-face|fonts\.googleapis|fonts\.gstatic/i, 'Web-Font — in E-Mail nicht ladbar, Systemstapel verwenden']
];

function checkTemplate(file, source, { isPreview, isCatalog = false }) {
  // Kommentare zuerst entfernen: die Dateikoepfe erklaeren genau die Regeln,
  // die hier geprueft werden, und wuerden sich sonst selbst ausloesen.
  const html = source.replace(/<!--[\s\S]*?-->/g, '');

  for (const [pattern, message] of FORBIDDEN) {
    if (pattern.test(html)) fail(file, message);
  }

  // Der <style>-Block darf nur mobile Polsterung tragen. Gmail entfernt
  // <head>-Styles in einem Teil der Ansichten — was dort steht, darf das
  // Layout nicht tragen.
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  if (styleBlocks.length > 1) fail(file, 'mehr als ein <style>-Block');
  for (const [, css] of styleBlocks) {
    const withoutMedia = css.replace(/@media[^{]*\{[\s\S]*?\}\s*\}/g, '').trim();
    if (withoutMedia) {
      fail(file, `<style> enthaelt Regeln ausserhalb einer @media-Abfrage: ${withoutMedia.slice(0, 60)}…`);
    }
  }

  if (!/width="600"/.test(html)) fail(file, 'width="600" fehlt — Outlook ignoriert max-width');
  if (!/max-width:600px/.test(html)) fail(file, 'max-width:600px fehlt');
  // Der Bausteinkatalog ist eine Musterseite, keine versendbare Mail.
  if (!isCatalog) {
    if (!/mso-hide:all/.test(html)) fail(file, 'Preheader-Zeile fehlt');
    if (!/name="supported-color-schemes"/.test(html)) fail(file, 'supported-color-schemes-Meta fehlt');
  }
  if (!/name="color-scheme"/.test(html)) fail(file, 'color-scheme-Meta fehlt');

  // Farben
  for (const hex of new Set((html.match(/#[0-9a-fA-F]{6}\b/g) || []).map(v => v.toLowerCase()))) {
    if (!PALETTE.has(hex)) fail(file, `Farbe ${hex} liegt ausserhalb der Palette`);
  }

  // Jede Tabelle ist Layout, keine Daten.
  const tables = html.match(/<table(?![^>]*role="presentation")[^>]*>/g) || [];
  if (tables.length) fail(file, `${tables.length}x <table> ohne role="presentation"`);

  // Bilder brauchen Masse und Alternativtext, sonst zerreisst der Kopf,
  // solange die Bilder blockiert sind.
  for (const img of html.match(/<img[^>]*>/g) || []) {
    for (const attr of ['width=', 'height=', 'alt=']) {
      if (!img.includes(attr)) fail(file, `<img> ohne ${attr.replace('=', '')}`);
    }
  }

  // Zu jedem Knopf gehoert der Klartext-Link darunter. Grundsatz 15: wer den
  // Knopf nicht als Knopf erkennt, muss trotzdem ans Ziel kommen.
  if (/display:inline-block;padding:15px 34px/.test(html)
      && !/Falls der Knopf nicht funktioniert/.test(html)) {
    fail(file, 'Knopf ohne Klartext-Link darunter');
  }

  // lead_quality steht in der Datenbank klein. Der Vergleich muss das
  // abbilden, sonst faellt das Abzeichen immer in den Standardzweig.
  for (const [, raw] of html.matchAll(/1\.lead_quality\s*=\s*"([^"]*)"/g)) {
    if (raw !== raw.toLowerCase()) {
      fail(file, `lead_quality wird gegen "${raw}" verglichen — die Datenbank schreibt klein`);
    }
  }
  if (/1\.lead_quality\s*=/.test(html) && !/lower\(\s*1\.lead_quality\s*\)/.test(html)) {
    fail(file, 'Vergleich auf lead_quality ohne lower()');
  }

  // Der frueher hier stehende zweite Test auf callback_requested konnte nur
  // danebengreifen: die Route waehlt bereits ueber mail_type aus.
  if (/1\.callback_requested/.test(html)) {
    fail(file, 'Bedingung auf callback_requested — die Route unterscheidet bereits ueber mail_type');
  }

  if (isPreview && /\{\{/.test(html)) {
    fail(file, 'Vorschaudatei enthaelt noch Make-Ausdruecke');
  }
  if (!isPreview && !/\{\{/.test(html) && !file.endsWith('bausteine.html')) {
    fail(file, 'Vorlage enthaelt keinen einzigen Make-Ausdruck — versehentlich die Vorschau eingecheckt?');
  }
}

if (!fs.existsSync(dir)) {
  console.error(`Verzeichnis fehlt: ${path.relative(root, dir)}`);
  process.exit(1);
}

const templates = fs.readdirSync(dir).filter(f => f.endsWith('.html')).sort();
if (!templates.length) {
  console.error('Keine Vorlagen gefunden.');
  process.exit(1);
}

for (const name of templates) {
  const file = path.join(dir, name);
  const isCatalog = name === 'bausteine.html';
  checkTemplate(file, fs.readFileSync(file, 'utf8'), { isPreview: false, isCatalog });

  if (isCatalog) continue;
  const preview = path.join(previewDir, name.replace(/\.html$/, '.vorschau.html'));
  if (!fs.existsSync(preview)) {
    fail(file, `Vorschaudatei fehlt: vorschau/${path.basename(preview)}`);
    continue;
  }
  checkTemplate(preview, fs.readFileSync(preview, 'utf8'), { isPreview: true });
}

if (errors.length) {
  console.error(`Mail-Vorlagen: ${errors.length} Befund(e)\n`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Mail-Vorlagen in Ordnung (${templates.length} Dateien geprueft).`);
