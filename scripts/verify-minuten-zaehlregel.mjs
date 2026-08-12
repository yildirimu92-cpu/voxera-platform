#!/usr/bin/env node
/**
 * Wächter für die Zählregel der Gesprächsminuten.
 *
 * Warum es das braucht
 * --------------------
 * Bis zum 12.08.2026 berechneten vier Stellen den Minutenverbrauch getrennt
 * und kamen auf verschiedene Ergebnisse. An echten Produktionsdaten lagen
 * die beiden Abrechnungspfade 66 % auseinander (35 gegen 58 Minuten beim
 * selben Kunden im selben Zeitraum). Welcher Betrag fakturiert worden waere,
 * haette davon abgehangen, welcher Codepfad zuerst laeuft.
 *
 * Seither gilt eine Regel an genau einer Stelle -- der Datenbankfunktion
 * customer_usage_for_period:
 *
 *   1. nur durchgestellte Gespraeche (live_status = 'completed')
 *   2. Mindestdauer 10 Sekunden
 *   3. Sekunden summieren, die Summe EINMAL aufrunden -- nicht je Anruf
 *
 * Diese Regel ist in den AGB zugesagt und im Preisdokument veroeffentlicht.
 * Sie ist damit keine Implementierungsfrage mehr, sondern eine Zusage an den
 * Kunden: wer sie im Code aendert, ohne AGB und Preisdokument mitzuziehen,
 * laesst Versprechen und Verhalten auseinanderlaufen.
 *
 * Wie es prueft
 * -------------
 * Dreiwertig, ohne Vakuum-Pass:
 *   PASS -- Zaehlfunktion vorhanden, traegt alle drei Regelbestandteile,
 *           und die Abrechnungspfade rechnen nicht mehr selbst.
 *   FAIL -- ein Regelbestandteil fehlt, oder ein Abrechnungspfad zaehlt
 *           wieder selbst.
 *   SKIP -- die Migrationsdatei ist nicht auffindbar. Zaehlt wie FAIL als
 *           rot: ein Wächter, der sein Pruefobjekt nicht findet, hat nichts
 *           geprueft.
 *
 * Aufruf:  node scripts/verify-minuten-zaehlregel.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IS_MAIN = process.argv[1] === fileURLToPath(import.meta.url);

const ZAEHLFUNKTION = 'supabase/migrations/20260812061000_zusatzminuten_zaehlfunktion.sql';

/** Die drei Bestandteile der Regel, jeder mit seinem Beleg im SQL. */
export const REGELBESTANDTEILE = [
  {
    name: 'nur durchgestellte Gespraeche',
    muster: /live_status\s*=\s*'completed'/,
    erklaerung: 'Ohne diese Bedingung zaehlen auch Anrufe, die den Assistenten nie erreicht haben.'
  },
  {
    name: 'Mindestdauer 10 Sekunden',
    muster: /duration_seconds\s*>=\s*10/,
    erklaerung: 'Die Schwelle ist in den AGB zugesagt ("Anrufe unter 10 Sekunden werden nicht angerechnet").'
  },
  {
    name: 'einmal runden auf der Summe',
    muster: /ceil\(\s*[a-z_.]*sek[a-z_.]*\s*\/\s*60\.0\s*\)/i,
    erklaerung: 'Aufrunden je Anruf statt auf der Monatssumme verteuert dieselbe Nutzung um zweistellige Prozentwerte.'
  }
];

/**
 * Stellen, die den Verbrauch NICHT mehr selbst berechnen duerfen, sondern
 * ueber die Zaehlfunktion gehen muessen.
 */
export const ABRECHNUNGSPFADE = [
  {
    datei: 'admin-panel/netlify/functions/daily-billing-runner.js',
    zweck: 'taeglicher Ueberzugslauf',
    mussEnthalten: /rpc\(\s*'customer_usage_for_period'/,
    darfNichtEnthalten: /usedMinutes\s*\+=\s*Math\.ceil/
  },
  {
    datei: 'admin-panel/netlify/functions/_lib/invoice-service.js',
    zweck: 'Ueberschreitungsposition der wiederkehrenden Rechnung',
    mussEnthalten: /rpc\(\s*'customer_usage_for_period'/,
    darfNichtEnthalten: /const\s+usedMinutes\s*=\s*Math\.ceil\(usedSeconds/
  }
];

/**
 * Der Minutenpreis muss vom Vertrag kommen, nicht aus einer globalen
 * Konstante -- sonst trifft ein Preiswechsel rueckwirkend Bestandsvertraege.
 * contracts.extra_per_minute existiert nicht; die Spalte heisst
 * overage_rate_per_minute.
 */
export const VERTRAGSQUELLE = [
  {
    datei: 'admin-panel/netlify/functions/_lib/invoice-service.js',
    muster: /contract\.overage_rate_per_minute/,
    erklaerung: 'Der Minutenpreis der wiederkehrenden Rechnung muss vom Vertrag kommen.'
  },
  {
    datei: 'customer-dashboard/netlify/functions/customer-contract-state.js',
    muster: /contract\.overage_rate_per_minute/,
    erklaerung: 'Die Anzeige im Kundendashboard muss denselben Preis zeigen wie die Rechnung.'
  },
  {
    datei: 'admin-panel/netlify/functions/admin-invoice-qr-pdf.js',
    muster: /contract\.overage_rate_per_minute/,
    erklaerung: 'Die QR-Rechnung muss den vereinbarten Preis ausweisen.'
  }
];

export function lies(datei) {
  const pfad = join(ROOT, datei);
  if (!existsSync(pfad)) return null;
  return readFileSync(pfad, 'utf8');
}

export function pruefeRegel(sql) {
  return REGELBESTANDTEILE.map((teil) => ({
    ...teil,
    ok: teil.muster.test(sql)
  }));
}

export function pruefePfad(inhalt, pfad) {
  return {
    nutztZaehlfunktion: pfad.mussEnthalten.test(inhalt),
    rechnetSelbst: pfad.darfNichtEnthalten.test(inhalt)
  };
}

function main() {
  let fehler = 0;
  let vakuum = false;
  console.log('Zaehlregel fuer Gespraechsminuten\n');

  /* ── 1 · Die Regel steht in der Zaehlfunktion ────────────────────────── */
  console.log('  Regelbestandteile in der Zaehlfunktion');
  console.log('  ' + '─'.repeat(74));
  const sql = lies(ZAEHLFUNKTION);
  if (sql === null) {
    vakuum = true;
    console.log(`  ⚠ ${ZAEHLFUNKTION} nicht gefunden -- SKIP, nichts geprueft.`);
  } else {
    for (const teil of pruefeRegel(sql)) {
      if (!teil.ok) fehler += 1;
      console.log(`  ${teil.ok ? '✓' : '✗'} ${teil.name}`);
      if (!teil.ok) console.log(`      ${teil.erklaerung}`);
    }
  }

  /* ── 2 · Die Abrechnungspfade rechnen nicht mehr selbst ──────────────── */
  console.log('\n  Abrechnungspfade nutzen die Zaehlfunktion');
  console.log('  ' + '─'.repeat(74));
  for (const pfad of ABRECHNUNGSPFADE) {
    const inhalt = lies(pfad.datei);
    if (inhalt === null) {
      fehler += 1;
      console.log(`  ✗ ${pfad.zweck}: ${pfad.datei} nicht gefunden.`);
      continue;
    }
    const { nutztZaehlfunktion, rechnetSelbst } = pruefePfad(inhalt, pfad);
    const ok = nutztZaehlfunktion && !rechnetSelbst;
    if (!ok) fehler += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${pfad.zweck}`);
    if (!nutztZaehlfunktion) console.log('      ruft customer_usage_for_period nicht auf.');
    if (rechnetSelbst) console.log('      rechnet den Verbrauch wieder selbst -- die zweite Quelle ist zurueck.');
  }

  /* ── 3 · Der Minutenpreis kommt vom Vertrag ──────────────────────────── */
  console.log('\n  Minutenpreis kommt vom Vertrag (Bestandsschutz)');
  console.log('  ' + '─'.repeat(74));
  for (const quelle of VERTRAGSQUELLE) {
    const inhalt = lies(quelle.datei);
    if (inhalt === null) {
      fehler += 1;
      console.log(`  ✗ ${quelle.datei} nicht gefunden.`);
      continue;
    }
    const ok = quelle.muster.test(inhalt);
    if (!ok) fehler += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${quelle.datei}`);
    if (!ok) console.log(`      ${quelle.erklaerung}`);
  }

  /* ── Ergebnis ────────────────────────────────────────────────────────── */
  console.log('\n' + '─'.repeat(76));
  if (vakuum) {
    console.error(`SKIP: Pruefobjekt nicht gefunden. ${fehler} weitere Pruefung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  if (fehler > 0) {
    console.error(`FAIL: ${fehler} Pruefung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('PASS: die Zaehlregel steht an einer Stelle und alle Abrechnungspfade lesen sie.');
}

if (IS_MAIN) main();
