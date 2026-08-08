#!/usr/bin/env node
/**
 * Prueft die Security-Invarianten gegen die ECHTE Produktions-Datenbank.
 *
 * Warum es dieses Skript gibt: `verify-p0-security-foundation.mjs` und die
 * uebrigen verify-*.mjs lesen Repo-Dateien. Die P0-Migration vom 2026-07-28 lag
 * korrekt im Repo, war auf der Produktions-DB aber nie angewandt -- der CI-Check
 * blieb wochenlang gruen, waehrend keine einzige der Policies existierte. Kein
 * Check, der nur Dateien liest, kann das sehen. Dieses Skript oeffnet deshalb
 * eine echte Session, impersoniert `anon` und `authenticated` und misst nach,
 * was sie tatsaechlich duerfen.
 *
 * Exit-Codes -- die Unterscheidung ist wesentlich:
 *   0  alle Invarianten halten
 *   1  eine Invariante ist verletzt (Sicherheitsbefund)
 *   2  nicht pruefbar (kein Secret, DB nicht erreichbar, Migration fehlt)
 *
 * Exit 2 ist ebenfalls rot. Ein Check, der bei unerreichbarer DB gruen meldet,
 * waere exakt der Fehlermodus, den dieses Skript abstellen soll.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_SQL = path.join(REPO, 'supabase/verification/db_security_invariants_catalog.sql');
const BEHAVIOR_SQL = path.join(REPO, 'supabase/verification/db_security_invariants_behavior.sql');
const BASELINE = path.join(REPO, 'supabase/verification/db-security-baseline.json');
const MIGRATIONS_DIR = path.join(REPO, 'supabase/migrations');

const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_UNVERIFIABLE = 2;

const CONNECT_ATTEMPTS = 3;
const BACKOFF_MS = [2000, 4000, 8000];

/** Verbindungsfehler sind fluechtig und werden wiederholt; alles andere nicht. */
const TRANSIENT = /could not connect|could not translate host|connection refused|connection reset|server closed the connection|timeout expired|SSL SYSCALL|no route to host|temporary failure in name resolution|terminating connection due to administrator/i;

const results = [];
const info = {
  'anon-grants': new Map(),
  'authenticated-grants': new Map(),
  'rls-off': [],
  ledger: new Map(),
  census: new Map(),
};

const add = (status, group, name, detail = '') => results.push({ status, group, name, detail });

// ── Verbindung ──────────────────────────────────────────────────────────────

const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';

/** Das Passwort darf unter keinen Umstaenden im CI-Log landen. */
function redact(text) {
  if (!text) return '';
  let out = text;
  if (dbUrl) {
    out = out.split(dbUrl).join('<SUPABASE_DB_URL>');
    const pw = (() => {
      try { return decodeURIComponent(new URL(dbUrl).password || ''); } catch { return ''; }
    })();
    if (pw && pw.length > 3) out = out.split(pw).join('<redacted>');
  }
  return out;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runPsql(sqlFile) {
  const args = [
    dbUrl,
    '--no-psqlrc',
    '--quiet',
    '--no-align',
    '--tuples-only',
    '--field-separator', '\t',
    '--pset', 'pager=off',
    '--variable', 'ON_ERROR_STOP=1',
    '--file', sqlFile,
  ];
  const env = {
    ...process.env,
    PGCONNECT_TIMEOUT: '10',
    PGAPPNAME: 'voxera-ci-security-verifier',
    PGOPTIONS: '-c client_min_messages=warning',
  };

  let last = null;
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    const proc = spawnSync('psql', args, { env, encoding: 'utf8', timeout: 120_000 });

    if (proc.error && proc.error.code === 'ENOENT') {
      fail(EXIT_UNVERIFIABLE, 'psql ist nicht installiert. Der Workflow installiert postgresql-client;'
        + ' lokal: apt-get install postgresql-client bzw. brew install libpq.');
    }

    last = proc;
    const stderr = proc.stderr || '';
    const transient = proc.status === 2 || TRANSIENT.test(stderr);

    if (proc.status === 0 || !transient) break;

    if (attempt < CONNECT_ATTEMPTS) {
      const wait = BACKOFF_MS[attempt - 1];
      process.stderr.write(`  Verbindungsversuch ${attempt}/${CONNECT_ATTEMPTS} fehlgeschlagen,`
        + ` neuer Versuch in ${wait / 1000}s ...\n`);
      sleep(wait);
    }
  }

  return last;
}

function fail(code, message) {
  process.stderr.write(`\n${message}\n`);
  process.exit(code);
}

// ── Ausgabe parsen ──────────────────────────────────────────────────────────

function ingest(stdout) {
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [status, group, name] = parts;
    const detail = parts.slice(3).join(' ');
    if (status === 'INFO') {
      if (group === 'anon-grants' || group === 'authenticated-grants') {
        info[group].set(name, detail ? detail.split(',') : []);
      } else if (group === 'rls-off') info['rls-off'].push(name);
      else if (group === 'ledger') info.ledger.set(name, detail);
      else if (group === 'census') info.census.set(name, Number(detail) || 0);
    } else if (status === 'PASS' || status === 'FAIL' || status === 'SKIP') {
      add(status, group, name, detail);
    }
  }
}

// ── Baseline-Diff: Alt-Schuld eingefroren, Neuzugaenge rot ──────────────────

/**
 * Vergleicht die Grants einer Rolle gegen die eingefrorene Baseline.
 * Ausweitung = FAIL, Abbau = PASS mit Hinweis, die Baseline nachzuziehen.
 */
function diffGrants(role, expected, actual) {
  const improvements = [];
  let regressions = 0;

  // Wachhund gegen stille Degradation: wenn die Baseline Grants kennt, die
  // Abfrage aber gar nichts liefert, ist das kein Rechteabbau, sondern eine
  // kaputte Enumeration -- und wuerde als lauter "Verbesserungen" gruen
  // durchgehen, waehrend jede echte Ausweitung unentdeckt bliebe.
  //
  // Das ist kein hypothetischer Fall: die erste Fassung fragte ueber
  // information_schema ab. Dessen Sichten filtern auf `enabled_roles`, und
  // weil die CI-Rolle NOINHERIT ist, lieferten sie unter ihr null Zeilen --
  // aufgefallen ist es erst im Review. Der Wachhund bleibt, auch nachdem die
  // Abfragen auf pg_catalog umgestellt wurden.
  if (Object.keys(expected).length > 0 && actual.size === 0) {
    add('FAIL', 'H-baseline', `${role}-Grants konnten nicht ermittelt werden`,
      `Baseline kennt ${Object.keys(expected).length} Tabellen, die Abfrage lieferte keine einzige `
      + '-- das ist eine kaputte Enumeration, kein Rechteabbau');
    return;
  }

  for (const [table, privs] of actual) {
    const allowed = new Set(expected[table] || []);
    const added = privs.filter((p) => !allowed.has(p));
    if (added.length) {
      regressions += 1;
      add('FAIL', 'H-baseline', `${role} hat neue Rechte auf ${table}`,
        `neu hinzugekommen: ${added.join(',')} -- davor steht nur RLS`);
    }
  }
  for (const [table, privs] of Object.entries(expected)) {
    const now = actual.get(table);
    if (!now) improvements.push(`${table} (alle entfernt)`);
    else {
      const removed = privs.filter((p) => !now.includes(p));
      if (removed.length) improvements.push(`${table} (-${removed.join(',')})`);
    }
  }
  if (regressions === 0) {
    add('PASS', 'H-baseline', `${role} hat keine neuen Tabellenrechte bekommen`,
      `${actual.size} Tabellen gegen Baseline geprueft`);
  }
  if (improvements.length) {
    add('PASS', 'H-baseline', `${role}-Rechte wurden abgebaut (Baseline kann nachgezogen werden)`,
      improvements.join('; '));
  }
}

function checkBaseline(baseline) {
  diffGrants('anon', baseline.anonTableGrants || {}, info['anon-grants']);
  diffGrants('authenticated', baseline.authenticatedTableGrants || {}, info['authenticated-grants']);

  const allowedNoRls = new Set(baseline.tablesWithoutRls || []);
  const newNoRls = info['rls-off'].filter((t) => !allowedNoRls.has(t));
  add(newNoRls.length === 0 ? 'PASS' : 'FAIL', 'H-baseline',
    'keine neue Tabelle ohne RLS',
    newNoRls.length ? `ohne RLS: ${newNoRls.join(', ')}` : 'alle Tabellen in public haben RLS');
}

// ── Gruppe G: Ledger-Drift ──────────────────────────────────────────────────

function checkLedger(baseline) {
  const preLedger = new Set(baseline.preLedgerMigrations?.files || []);
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const nameOf = (f) => f.replace(/^\d{4}-\d{2}-\d{2}_/, '').replace(/\.sql$/, '');

  const tracked = files.filter((f) => !preLedger.has(f));
  const repoNames = new Map(tracked.map((f) => [nameOf(f), f]));

  // Richtung 1 -- der P0-Fehlermodus: Migration liegt im Repo, wurde auf der DB
  // aber nie angewandt. Genau hier blieb der alte Check monatelang gruen.
  const missing = tracked.filter((f) => !info.ledger.has(nameOf(f)));
  add(missing.length === 0 ? 'PASS' : 'FAIL', 'G-ledger',
    'jede Repo-Migration ab 2026-08-08 ist auf der DB angewandt',
    missing.length
      ? `NICHT angewandt: ${missing.join(', ')} -- Migration auf der Produktions-DB ausfuehren`
      : `${tracked.length} Migrationen nachgewiesen`);

  // Richtung 2: auf der DB angewandt, aber keine Repo-Datei -- eine Aenderung,
  // die am Repo vorbei eingespielt wurde.
  const orphans = [...info.ledger.keys()].filter((n) => !repoNames.has(n));
  add(orphans.length === 0 ? 'PASS' : 'FAIL', 'G-ledger',
    'keine DB-Migration ohne Repo-Datei',
    orphans.length
      ? `nur auf der DB: ${orphans.join(', ')} -- Out-of-Band-Aenderung, nachdokumentieren`
      : 'Repo und Ledger decken sich');

  const preTracked = files.filter((f) => preLedger.has(f));
  add('SKIP', 'G-ledger', 'Migrationen vor 2026-08-08 (kein Ledger vorhanden)',
    `${preTracked.length} Dateien nicht nachweisbar -- siehe preLedgerMigrations in der Baseline`);
}

// ── Report ──────────────────────────────────────────────────────────────────

function report() {
  const failed = results.filter((r) => r.status === 'FAIL');
  const skipped = results.filter((r) => r.status === 'SKIP');
  const passed = results.filter((r) => r.status === 'PASS');

  const lines = [];
  const groups = [...new Set(results.map((r) => r.group))].sort();
  for (const g of groups) {
    lines.push(`\n── ${g} ${'─'.repeat(Math.max(0, 66 - g.length))}`);
    for (const r of results.filter((x) => x.group === g)) {
      const mark = r.status === 'PASS' ? 'PASS' : r.status === 'FAIL' ? 'FAIL' : 'SKIP';
      lines.push(`  [${mark}] ${r.name}${r.detail ? `\n         ${r.detail}` : ''}`);
    }
  }
  lines.push(`\n${'═'.repeat(70)}`);
  lines.push(`  ${passed.length} bestanden, ${failed.length} verletzt, ${skipped.length} uebersprungen`);
  process.stdout.write(`${lines.join('\n')}\n`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      '## Security-Invarianten der Produktions-DB',
      '',
      failed.length
        ? `**${failed.length} Invariante(n) verletzt.**`
        : `Alle ${passed.length} geprueften Invarianten halten.`,
      '',
      `| | Anzahl |`,
      `| --- | --- |`,
      `| bestanden | ${passed.length} |`,
      `| verletzt | ${failed.length} |`,
      `| uebersprungen | ${skipped.length} |`,
      '',
    ];
    if (failed.length) {
      md.push('### Verletzte Invarianten', '', '| Gruppe | Invariante | Befund |', '| --- | --- | --- |');
      for (const r of failed) md.push(`| ${r.group} | ${r.name} | ${r.detail || ''} |`);
      md.push('');
    }
    if (skipped.length) {
      md.push('<details><summary>Uebersprungen (nicht nachweisbar)</summary>', '',
        '| Gruppe | Invariante | Grund |', '| --- | --- | --- |');
      for (const r of skipped) md.push(`| ${r.group} | ${r.name} | ${r.detail || ''} |`);
      md.push('', '</details>', '');
    }
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md.join('\n')}\n`);
  }

  return failed.length;
}

// ── Ablauf ──────────────────────────────────────────────────────────────────

if (!dbUrl) {
  fail(EXIT_UNVERIFIABLE,
    'SUPABASE_DB_URL ist nicht gesetzt -- die Invarianten sind damit NICHT geprueft.\n'
    + 'Einrichtung: docs/DB_SECURITY_CI_SETUP.md');
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

for (const [label, file] of [['Katalog', CATALOG_SQL], ['Laufzeitverhalten', BEHAVIOR_SQL]]) {
  process.stderr.write(`Pruefe ${label} gegen die Produktions-DB ...\n`);
  const proc = runPsql(file);
  const stderr = redact(proc.stderr || '');

  if (proc.status !== 0) {
    if (/ci_security_probe_(census|identity)/.test(stderr) && /does not exist/i.test(stderr)) {
      fail(EXIT_UNVERIFIABLE,
        'Die Proben-Helfer fehlen auf der Datenbank -- die Migration\n'
        + '  supabase/migrations/2026-08-08_ci_security_verifier_role.sql\n'
        + 'ist noch nicht angewandt. Bis dahin sind die Invarianten NICHT geprueft.\n'
        + `\npsql:\n${stderr}`);
    }
    if (/permission denied|must be member of role/i.test(stderr)) {
      fail(EXIT_UNVERIFIABLE,
        'Die CI-Rolle darf nicht, was sie muss (anon/authenticated impersonieren,\n'
        + 'Proben-Helfer aufrufen). Migration erneut anwenden -- siehe\n'
        + `docs/DB_SECURITY_CI_SETUP.md\n\npsql:\n${stderr}`);
    }
    fail(EXIT_UNVERIFIABLE,
      `psql beendete sich mit Status ${proc.status} -- die Invarianten sind NICHT geprueft.\n`
      + `Das ist kein Freibrief: bis die Ursache geklaert ist, gilt der Zustand der\n`
      + `Datenbank als unbekannt.\n\npsql:\n${stderr}`);
  }

  if (stderr.trim()) process.stderr.write(`${stderr}\n`);
  ingest(proc.stdout || '');
}

if (results.length === 0) {
  fail(EXIT_UNVERIFIABLE,
    'psql lief durch, hat aber keine einzige Pruefzeile geliefert. Das deutet auf ein\n'
    + 'kaputtes Ausgabeformat hin -- gewertet wird das als "nicht geprueft", nicht als "gruen".');
}

checkBaseline(baseline);
checkLedger(baseline);

const emptyTables = [...info.census.values()].filter((n) => n === 0).length;
if (emptyTables) {
  add('SKIP', 'A-deny-default', 'leere Tabellen ohne Beweiskraft',
    `${emptyTables} von ${info.census.size} Tabellen sind leer -- dort ist "0 sichtbare Zeilen" kein Beweis`);
}

const violations = report();
process.exit(violations > 0 ? EXIT_VIOLATION : EXIT_OK);
