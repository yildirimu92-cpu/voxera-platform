// Waechter: schreibt der Browser Spalten, auf die er kein Recht hat?
//
// ─── Die Fehlerklasse ──────────────────────────────────────────────────────
//
// Eine spaltenweise Allowlist wird korrekt aus dem Code abgeleitet -- und
// veraltet mit dem naechsten Feature. Der Entzug war richtig, die Zeile ist
// richtig, und trotzdem ist es kaputt, weil niemand die beiden gegeneinander
// prueft.
//
// Belegter Fall (2026-08-11): 2026-08-06_p0_rls_tenant_isolation_hardening.sql
// entzog UPDATE auf public.calls und vergab es spaltenweise neu -- die Liste
// stammte aus jeder damals vorhandenen Aufrufstelle. Zwei Tage spaeter kam mit
// PR #847 `.update({ callback_requested: false })` dazu. Seither scheitert der
// Aufruf mit 403; der Code loggt console.warn, die Oberflaeche zeigt nichts.
// Die Rueckrufliste leert sich nicht -- in einem bezahlten Merkmal.
//
// Keine der beiden Ebenen war falsch. Sie sind auseinandergedriftet.
//
// ─── Was dieser Waechter prueft ────────────────────────────────────────────
//
// Er liest jede `.from('tabelle').update({ spalte: ... })`-Stelle im
// Browser-Code und haelt die Spalten gegen information_schema.column_privileges
// fuer die Rolle `authenticated`. Fehlt ein Recht, ist der Lauf rot.
//
// ─── Drei Eigenschaften, ohne die er nichts wert waere ─────────────────────
//
// 1. DREIWERTIG, KEIN VAKUUM-PASS. Findet die Extraktion keine einzige
//    Schreibstelle, ist das SKIP mit Begruendung -- nicht PASS. Ein Regex, der
//    nichts findet, ist verdaechtig, nicht beruhigend: Er kann genauso gut an
//    einer geaenderten Schreibweise vorbeigelaufen sein.
// 2. Eigener Workflow OHNE Pfadfilter. Ein Grant kann sich aendern, ohne dass
//    eine der hier gelesenen Dateien angefasst wird -- ein Pfadfilter wuerde
//    den Lauf genau dann ueberspringen, wenn er gebraucht wird. Siehe #941 und
//    AGENTS.md, "A verify script without a workflow is a script that never runs".
// 3. Gegenprobe im Test: --selbsttest fuehrt die Extraktion gegen einen
//    fingierten Codeschnipsel und gegen den echten Repo-Stand aus. Ein
//    Waechter, der den Fall nicht faengt, fuer den er gebaut wurde, misst am
//    Gegenstand vorbei.
//
// Aufruf:
//   node scripts/verify-browser-column-grants.mjs              (gegen die DB)
//   node scripts/verify-browser-column-grants.mjs --selbsttest (ohne DB)
//
// Die DB-Verbindung kommt aus SUPABASE_DB_URL, wie bei
// verify-db-security-invariants.mjs.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Dateien, die den Supabase-Client IM BROWSER benutzen. Netlify-Functions sind
// bewusst nicht dabei: die laufen mit service_role und unterliegen weder RLS
// noch diesen Spaltenrechten.
const BROWSER_DATEIEN = [
  'customer-dashboard/index.html',
  'admin-panel/index.html',
];
const BROWSER_GLOBS = ['customer-dashboard/shared/*.js', 'admin-panel/shared/*.js'];

const ROLLE = 'authenticated';

/**
 * Findet `.from('x') ... .update({ a: ..., b: ... })` und liefert je Fund
 * Tabelle, Spalten und Fundstelle.
 *
 * Bewusst konservativ: Nur Objektliterale werden gelesen. Ein `.update(payload)`
 * mit einer Variablen ist NICHT auswertbar -- solche Stellen werden getrennt
 * gemeldet, statt sie stillschweigend als "keine Spalten" zu zaehlen. Eine
 * unauswertbare Stelle ist ein Loch im Waechter und gehoert sichtbar gemacht.
 */
export function extrahiereSchreibstellen(quelle, dateiname = '<inline>') {
  const treffer = [];
  const unklar = [];
  const re = /\.from\(\s*['"]([a-z_]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(quelle)) !== null) {
    const tabelle = m[1];
    const fenster = quelle.slice(m.index, m.index + 400);
    const upd = fenster.match(/\.update\(\s*(\{[^}]*\}|[A-Za-z_$][\w$]*)/);
    if (!upd) continue;
    const zeile = quelle.slice(0, m.index).split('\n').length;
    if (!upd[1].startsWith('{')) {
      unklar.push({ tabelle, datei: dateiname, zeile, ausdruck: upd[1] });
      continue;
    }
    const spalten = [...upd[1].matchAll(/([A-Za-z_][\w]*)\s*:/g)].map((s) => s[1]);
    if (spalten.length) treffer.push({ tabelle, spalten, datei: dateiname, zeile });
  }
  return { treffer, unklar };
}

function sammleAusRepo() {
  const dateien = [...BROWSER_DATEIEN];
  for (const g of BROWSER_GLOBS) {
    try { dateien.push(...globSync(g)); } catch { /* Node < 22 */ }
  }
  const alle = [];
  const alleUnklar = [];
  let gelesen = 0;
  for (const f of dateien) {
    if (!existsSync(f)) continue;
    gelesen += 1;
    const { treffer, unklar } = extrahiereSchreibstellen(readFileSync(f, 'utf8'), f);
    alle.push(...treffer);
    alleUnklar.push(...unklar);
  }
  return { alle, alleUnklar, gelesen };
}

function holeSpaltenrechte() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) return null;
  const sql = `select table_name || '.' || column_name
               from information_schema.column_privileges
               where table_schema='public' and grantee='${ROLLE}' and privilege_type='UPDATE';`;
  const roh = execFileSync('psql', [url, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8' });
  return new Set(roh.split('\n').map((z) => z.trim()).filter(Boolean));
}

// Nur ausfuehren, wenn direkt aufgerufen. Ohne diesen Waechter wuerde ein
// blosser `import` der exportierten Extraktion den ganzen Lauf ausloesen --
// samt process.exit --, und die Funktion waere nirgends wiederverwendbar.
const direktAufgerufen = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

// ─── Selbsttest ────────────────────────────────────────────────────────────
if (direktAufgerufen && process.argv.includes('--selbsttest')) {
  let fehler = 0;
  const pruefe = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) fehler += 1;
  };

  const fingiert = `
    sb.from('calls').update({ callback_requested: false }).eq('id', x)
    sb.from('calls').update({ read_at: iso, updated_at: n }).eq('id', y)
    sb.from('kunden').update(payload).eq('id', z)
  `;
  const { treffer, unklar } = extrahiereSchreibstellen(fingiert, '<fingiert>');
  pruefe('Objektliteral wird gelesen',
    treffer.some((t) => t.tabelle === 'calls' && t.spalten.includes('callback_requested')));
  pruefe('mehrere Spalten in einem Aufruf',
    treffer.some((t) => t.spalten.includes('read_at') && t.spalten.includes('updated_at')));
  pruefe('Variable statt Literal wird als unklar gemeldet, nicht verschluckt',
    unklar.length === 1 && unklar[0].ausdruck === 'payload');

  // Die eigentliche Gegenprobe: der echte Repo-Stand muss den bekannten Fall
  // enthalten. Findet die Extraktion ihn nicht, misst der Waechter am
  // Gegenstand vorbei -- unabhaengig davon, was die DB sagt.
  const { alle, gelesen } = sammleAusRepo();
  pruefe('Browser-Dateien gefunden', gelesen > 0, `${gelesen} Dateien`);
  pruefe('bekannter Fall callback_requested wird im echten Code gefunden',
    alle.some((t) => t.tabelle === 'calls' && t.spalten.includes('callback_requested')),
    'customer-dashboard/index.html:19634');
  pruefe('Extraktion liefert ueberhaupt Schreibstellen', alle.length > 0, `${alle.length} Stellen`);

  console.log(fehler ? `\n${fehler} Selbsttest(s) fehlgeschlagen.` : '\nSelbsttest ok.');
  process.exit(fehler ? 1 : 0);
}

// ─── Regullauf ─────────────────────────────────────────────────────────────
if (!direktAufgerufen) { /* als Modul importiert: nur die Extraktion anbieten */ }
else {
const { alle, alleUnklar, gelesen } = sammleAusRepo();

console.log(`Browser-Spaltenrechte: ${gelesen} Dateien gelesen, ${alle.length} Schreibstellen, Rolle ${ROLLE}\n`);

// Eigenschaft 1: kein Vakuum-Pass.
if (gelesen === 0 || alle.length === 0) {
  console.log('SKIP — keine Schreibstellen gefunden.');
  console.log('');
  console.log('Das ist KEIN Freibrief. Entweder wurden die Browser-Dateien verschoben,');
  console.log('oder die Schreibweise hat sich geaendert und die Extraktion laeuft daran');
  console.log('vorbei. Ein Waechter, der nichts findet, hat nichts geprueft.');
  console.log(`Erwartet werden Treffer in: ${BROWSER_DATEIEN.join(', ')}`);
  process.exit(1);
}

const rechte = holeSpaltenrechte();
if (rechte === null) {
  console.log('SKIP — SUPABASE_DB_URL nicht gesetzt, Spaltenrechte nicht abfragbar.');
  console.log('Die Extraktion hat funktioniert (siehe Zahl oben), nur der Abgleich fehlt.');
  process.exit(1);
}

const fehlend = [];
for (const t of alle) {
  for (const sp of t.spalten) {
    if (!rechte.has(`${t.tabelle}.${sp}`)) fehlend.push({ ...t, spalte: sp });
  }
}

if (alleUnklar.length) {
  console.log(`HINWEIS — ${alleUnklar.length} Schreibstelle(n) mit variablem Payload, nicht auswertbar:`);
  for (const u of alleUnklar) console.log(`  ${u.datei}:${u.zeile}  ${u.tabelle}.update(${u.ausdruck})`);
  console.log('  Diese Stellen deckt der Waechter NICHT ab.\n');
}

if (!fehlend.length) {
  console.log(`PASS — alle ${alle.length} Schreibstellen haben ein passendes Spaltenrecht.`);
  process.exit(0);
}

console.log(`FAIL — ${fehlend.length} Spalte(n) ohne UPDATE-Recht fuer ${ROLLE}:\n`);
for (const f of fehlend) {
  console.log(`  ${f.tabelle}.${f.spalte}`);
  console.log(`      geschrieben in ${f.datei}:${f.zeile}`);
}
console.log('');
console.log('Der Aufruf scheitert zur Laufzeit mit 403. Je nach Aufrufstelle bemerkt');
console.log('der Kunde davon nichts -- pruefe, ob der Fehlschlag sichtbar wird.');
console.log('');
console.log('Behebung: entweder die Spalte in die Allowlist aufnehmen');
console.log('  grant update (<spalte>) on table public.<tabelle> to authenticated;');
console.log('oder den Schreibzugriff entfernen, wenn er nicht mehr gebraucht wird.');
process.exit(1);
}
