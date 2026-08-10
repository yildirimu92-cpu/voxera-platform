#!/usr/bin/env node
/**
 * Wächter für die Mehrwertsteuer-Konvention beim Rechnungsanlegen.
 *
 * Warum es das braucht
 * --------------------
 * Voxera fakturiert derzeit ohne ausgewiesene Mehrwertsteuer: jede Stelle, die
 * eine Rechnung oder Gutschrift anlegt, setzt `tax_amount` auf 0. Das ist eine
 * Konvention, keine Regel der Datenbank — und sie stand bis zum 10.08.2026 nur
 * als Kommentar in einem Migrationskopf.
 *
 * Ein Kommentar schützt nichts. Wird eines Tages auf MwSt umgestellt, muss das
 * an ALLEN Stellen zugleich passieren; bleibt eine zurück, entstehen stillschweigend
 * zwei Rechnungsarten nebeneinander — genau das Muster, das dieses Portal ohnehin
 * schon dreimal hat.
 *
 * Wie es prüft
 * ------------
 * Nach dem Vorbild von checkLedger(): NICHT gegen eine gepflegte Liste, sondern
 * gegen die Wirklichkeit. Das Skript sucht selbst alle Stellen, die in
 * `invoices` schreiben, und vergleicht die gefundene Menge mit der bekannten.
 * Eine neue Stelle taucht als Waise auf und muss eingetragen werden — sie kann
 * sich nicht unbemerkt danebenstellen.
 *
 * Aufruf:  node scripts/verify-invoice-tax-convention.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Die bekannten Schreibstellen und wie sie die Mehrwertsteuer behandeln.
 *
 * `steuer` beschreibt, was das Skript im Quelltext erwartet:
 *   'null'        — setzt tax_amount hart auf 0
 *   'durchgereicht' — nimmt den Wert vom Aufrufer entgegen (dann muss der Aufrufer geprüft sein)
 *   'abgeleitet'  — rechnet ihn aus einer Bezugsrechnung herunter
 */
const BEKANNTE_STELLEN = [
  {
    datei: 'admin-panel/netlify/functions/admin-overage-invoice.js',
    zweck: 'Überzugsrechnung',
    steuer: 'null',
    muster: /tax_amount:\s*0\b/
  },
  {
    datei: 'admin-panel/netlify/functions/_lib/invoice-service.js',
    zweck: 'zentraler Rechnungsbau (Setup-Gebühr, Abo)',
    steuer: 'durchgereicht',
    muster: /tax_amount:\s*taxAmount\b/
  },
  {
    datei: 'supabase/migrations/2026-08-10_standalone_credit_notes.sql',
    zweck: 'freistehende Kulanzgutschrift',
    steuer: 'null',
    // In der Spaltenliste steht tax_amount an dritter Stelle der Betragsgruppe,
    // im VALUES-Block entsprechend die 0 zwischen den beiden negativen Beträgen.
    muster: /-v_amount,0,-v_amount/
  },
  {
    datei: 'supabase/sql/2026-07-31_invoice_adjustments_credit_notes.sql',
    zweck: 'Gutschrift auf eine bestehende Rechnung',
    steuer: 'abgeleitet',
    muster: /v_credit_tax\s*:=/
  },
  {
    datei: 'admin-panel/netlify/functions/customer-billing-update.js',
    zweck: 'Billing-Aktionen (4 Schreibstellen)',
    steuer: 'null',
    // Vier Inserts, jeder mit tax_amount: 0. Alle vier muessen es setzen --
    // deshalb wird gezaehlt statt nur gesucht.
    muster: /(tax_amount:\s*0\b[\s\S]*?){4}/
  },
  {
    datei: 'admin-panel/netlify/functions/daily-billing-runner.js',
    zweck: 'naechtlicher Abrechnungslauf',
    steuer: 'null',
    muster: /tax_amount:\s*0\b/
  }
];

/**
 * Dateien, die zwar wie eine Schreibstelle aussehen, aber keine sind.
 * Jede Ausnahme braucht einen Grund -- sonst waere die Liste eine Hintertuer.
 */
const KEINE_SCHREIBSTELLEN = [
  {
    datei: 'supabase/sql/2026-08-06_invoice_items_title_tax_rate_drift_fix_verification_queries.sql',
    grund: 'Pruefabfragen zum Drift-Fix. Legt Testzeilen an und rollt sie zurueck, erzeugt keine echte Rechnung.'
  }
];

/** Alle Dateien, die überhaupt in `invoices` schreiben — selbst gesucht. */
function findeSchreibstellen() {
  const treffer = [];
  const durchsuche = (verzeichnis, filter) => {
    for (const eintrag of readdirSync(verzeichnis)) {
      const pfad = join(verzeichnis, eintrag);
      if (statSync(pfad).isDirectory()) {
        if (['node_modules', '.git'].includes(eintrag)) continue;
        durchsuche(pfad, filter);
        continue;
      }
      if (!filter.test(eintrag)) continue;
      const inhalt = readFileSync(pfad, 'utf8');
      const schreibtJs = /from\(['"]invoices['"]\)[\s\S]{0,80}?\.insert\(/.test(inhalt)
        || /invoiceRow\s*=\s*\{[\s\S]{0,400}?tax_amount/.test(inhalt);
      const schreibtSql = /insert into public\.invoices\s*\(/i.test(inhalt);
      if (schreibtJs || schreibtSql) treffer.push(relative(ROOT, pfad));
    }
  };
  durchsuche(join(ROOT, 'admin-panel', 'netlify', 'functions'), /\.js$/);
  durchsuche(join(ROOT, 'supabase'), /\.sql$/);
  return treffer;
}

const gefunden = findeSchreibstellen();
const bekannt = BEKANNTE_STELLEN.map((s) => s.datei);

let fehler = 0;
console.log('Mehrwertsteuer-Konvention beim Rechnungsanlegen\n');

/* ── 1 · Jede bekannte Stelle hält sich an ihre Zusage ──────────────────────── */
console.log('  Bekannte Schreibstellen');
console.log('  ' + '─'.repeat(76));
for (const stelle of BEKANNTE_STELLEN) {
  let inhalt;
  try {
    inhalt = readFileSync(join(ROOT, stelle.datei), 'utf8');
  } catch {
    fehler += 1;
    console.log(`  ✗ ${stelle.datei}`);
    console.log('      Datei fehlt. Wurde sie verschoben, gehoert der neue Pfad in dieses Skript.');
    continue;
  }
  const ok = stelle.muster.test(inhalt);
  if (!ok) fehler += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${stelle.zweck.padEnd(42)} ${stelle.steuer}`);
  console.log(`      ${stelle.datei}`);
  if (!ok) {
    console.log('      Die erwartete Behandlung ist im Quelltext nicht mehr zu finden.');
    console.log('      Entweder wurde die Konvention hier geaendert -- dann muessen ALLE Stellen');
    console.log('      zugleich umgestellt werden -- oder das Muster in diesem Skript ist veraltet.');
  }
}

/* ── 2 · Keine unbekannte Stelle daneben ───────────────────────────────────── */
const ausgenommen = KEINE_SCHREIBSTELLEN.map((a) => a.datei);
const waisen = gefunden.filter((datei) => !bekannt.includes(datei) && !ausgenommen.includes(datei));
console.log('\n  Selbst gefundene Schreibstellen');
console.log('  ' + '─'.repeat(76));
console.log(`  ${gefunden.length} Stelle(n) schreiben in invoices, ${bekannt.length} davon sind eingetragen.`);
if (waisen.length) {
  fehler += 1;
  console.log('  ✗ Nicht eingetragen:');
  waisen.forEach((datei) => console.log(`      ${datei}`));
  console.log('      Eine neue Stelle, die Rechnungen anlegt, muss ihre MwSt-Behandlung hier');
  console.log('      benennen. Sonst faellt eine spaetere Umstellung genau hier durch.');
} else {
  console.log('  ✓ Keine unbekannte Schreibstelle.');
}
if (ausgenommen.length) {
  console.log(`  · ${ausgenommen.length} Datei(en) bewusst ausgenommen:`);
  KEINE_SCHREIBSTELLEN.forEach((a) => console.log(`      ${a.datei}\n        ${a.grund}`));
}

/* ── 3 · Der durchgereichte Fall braucht geprüfte Aufrufer ──────────────────── */
const service = readFileSync(join(ROOT, 'admin-panel/netlify/functions/_lib/invoice-service.js'), 'utf8');
const reichtDurch = /taxAmount\s*=\s*money\(payload\.taxAmount\)/.test(service);
console.log('\n  Durchgereichte Mehrwertsteuer');
console.log('  ' + '─'.repeat(76));
if (reichtDurch) {
  console.log('  · invoice-service.js nimmt taxAmount vom Aufrufer entgegen.');
  console.log('    Faellt der Wert weg, wird daraus 0 -- die Konvention gilt also auch ohne');
  console.log('    ausdrueckliche Angabe. Das ist beabsichtigt und hier festgehalten.');
} else {
  fehler += 1;
  console.log('  ✗ invoice-service.js reicht taxAmount nicht mehr wie erwartet durch.');
}

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
