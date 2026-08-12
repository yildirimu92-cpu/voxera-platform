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

// Alternative zum Connection-String: Einzelfelder. Damit entfaellt die
// URL-Kodierung komplett -- ein Passwort aus `openssl rand -base64 32` enthaelt
// '/', '+' und '=', und je nachdem, welches davon wo landet, zerlegt libpq den
// String falsch oder die Anmeldung scheitert. Dieser Weg hat das Problem nicht,
// weil das Passwort ueber PGPASSWORD geht und nie geparst wird.
const rawParts = {
  host: process.env.SUPABASE_DB_HOST || '',
  port: process.env.SUPABASE_DB_PORT || '5432',
  user: process.env.SUPABASE_DB_USER || '',
  password: process.env.SUPABASE_DB_PASSWORD || '',
  dbname: process.env.SUPABASE_DB_NAME || 'postgres',
};

// Beim Kopieren in ein GitHub-Secret wandert leicht ein Zeilenumbruch oder ein
// Leerzeichen mit. Das ist von aussen unsichtbar und sieht exakt aus wie ein
// falsches Passwort. Deshalb wird getrimmt -- aber nicht stillschweigend: was
// entfernt wurde, steht im Log, sonst waere es beim naechsten Mal wieder da.
const trimmedFields = [];
const dbParts = Object.fromEntries(Object.entries(rawParts).map(([k, v]) => {
  const t = v.trim();
  if (t !== v) trimmedFields.push(k);
  return [k, t];
}));
const useParts = Boolean(dbParts.host && dbParts.user && dbParts.password);

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
  if (dbParts.password.length > 3) out = out.split(dbParts.password).join('<redacted>');
  return out;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runPsql(sqlFile) {
  const connectionArgs = useParts
    ? ['--host', dbParts.host, '--port', dbParts.port,
       '--username', dbParts.user, '--dbname', dbParts.dbname]
    : [dbUrl];

  const args = [
    ...connectionArgs,
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
    // Passwort ueber die Umgebung, nie als Argument: Argumente stehen in der
    // Prozessliste und landen in Fehlermeldungen.
    ...(useParts ? { PGPASSWORD: dbParts.password, PGSSLMODE: process.env.PGSSLMODE || 'require' } : {}),
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
  // Zwei Listen, dieselbe Kategorie: vor dem Ledger entstanden, Anwendung
  // nicht nachweisbar. Getrennt gefuehrt, weil migratedFromSqlDir zusaetzlich
  // die Haertungspruefung steuert und dort eine andere Begruendung traegt.
  const preLedger = new Set([
    ...(baseline.preLedgerMigrations?.files || []),
    ...(baseline.migratedFromSqlDir?.files || []),
  ]);
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  // Zwei Namensschemata nebeneinander, und das ist Absicht:
  //   20260809172215_admin_notification_settings.sql -- im Ledger nachgewiesen,
  //     traegt seine Version im Namen (Supabase-CLI-Schema).
  //   2026-04-08_core_tables_schema_sot.sql -- vor dem Ledger entstanden. Eine
  //     Version waere hier erfunden; der Dateiname sagt darum, dass es keine
  //     gibt.
  //
  // Das Datum wird auf BEIDEN Seiten abgestreift, in beiden Schreibweisen.
  // Grund: Die Repo-Datei heisst `2026-08-10_calls_admin_review.sql`, der
  // Ledger fuehrt sie als `2026_08_10_calls_admin_review` -- Supabase ersetzt
  // beim Anwenden die Bindestriche. Kannte `nameOf` nur die Bindestrichform,
  // stand auf der einen Seite `calls_admin_review` und auf der anderen
  // `2026_08_10_calls_admin_review`; sie trafen sich nie, und dieselbe
  // Migration wurde GLEICHZEITIG als "nicht angewandt" und als Waise gemeldet.
  // Drei der sechs Meldungen vom 12.08. hatten genau diese Ursache.
  //
  // Nur ein FUEHRENDES Datum wird entfernt, nicht irgendeine Ziffernfolge:
  // eine Migration, die legitim `2026_ausblick` heisst, bleibt unangetastet.
  const nameOf = (f) => f
    .replace(/\.sql$/, '')
    .replace(/^\d{14}_/, '')
    .replace(/^\d{4}[-_]\d{2}[-_]\d{2}_/, '');
  const versionOf = (f) => (f.match(/^(\d{14})_/) || [])[1] || null;

  // Die Version ist der belastbare Schluessel: Supabase selbst gleicht darueber
  // ab, und anders als der Name kann sie nicht auseinanderlaufen. Der Name
  // bleibt als zweiter Weg fuer Dateien ohne Version im Namen.
  const ledgerVersions = new Set(info.ledger.values());
  const repoVersions = new Set(files.map(versionOf).filter(Boolean));

  // Die Ledger-Namen werden mit DERSELBEN Normalisierung durchgereicht wie die
  // Dateinamen. Nur eine Seite zu normalisieren hilft nichts: die eine Seite
  // hiesse dann `calls_admin_review`, die andere `2026_08_10_calls_admin_review`.
  const ledgerNamenNormalisiert = new Set([...info.ledger.keys()].map(nameOf));

  const tracked = files.filter((f) => !preLedger.has(f));

  // Zuordnung fuer Migrationen, die unter einem anderen Namen -- oder in
  // mehreren Schritten -- angewandt wurden. Begruendung je Eintrag steht in
  // der Baseline. Ohne sie meldet der Check dieselbe Migration doppelt: einmal
  // als "nicht angewandt", einmal als "Out-of-Band".
  const aliasMap = baseline.ledgerAliases?.map || {};
  const aliasOwner = new Map();
  for (const [file, names] of Object.entries(aliasMap)) {
    for (const ledgerName of names) aliasOwner.set(ledgerName, file);
  }

  // Richtung 1 -- der P0-Fehlermodus: Migration liegt im Repo, wurde auf der DB
  // aber nie angewandt. Genau hier blieb der alte Check monatelang gruen.
  const isApplied = (f) => (versionOf(f) && ledgerVersions.has(versionOf(f)))
    || ledgerNamenNormalisiert.has(nameOf(f))
    || (aliasMap[f] || []).some((ledgerName) => info.ledger.has(ledgerName));
  const missing = tracked.filter((f) => !isApplied(f));
  add(missing.length === 0 ? 'PASS' : 'FAIL', 'G-ledger',
    'jede Repo-Migration ab 2026-08-08 ist auf der DB angewandt',
    missing.length
      ? `NICHT angewandt: ${missing.join(', ')} -- Migration auf der Produktions-DB ausfuehren`
      : `${tracked.length} Migrationen nachgewiesen`);

  // Richtung 2: auf der DB angewandt, aber keine Repo-Datei -- eine Aenderung,
  // die am Repo vorbei eingespielt wurde.
  //
  // Hier zaehlen ALLE Dateien mit, auch die vor dem Ledger entstandenen; in
  // Richtung 1 bewusst nicht. Die Frage dieser Richtung ist "gibt es eine
  // Repo-Datei", nicht "ist sie nachweislich angewandt". Bis 2026-08-10 stand
  // hier ein zweites Verzeichnis supabase/sql/, weil das Repo DDL ueberwiegend
  // dort ablegte; seit der Zusammenlegung ist die Unterscheidung gegenstandslos.
  //
  // Umgekehrt darf Richtung 1 die Altbestaende NICHT mitlesen: sie stammen aus
  // der Zeit vor dem Ledger (ab 2026-04) und wuerden reihenweise als "nicht
  // angewandt" gemeldet -- ein Check, der am ersten Tag rot ist, wird
  // abgeschaltet und schuetzt dann gar nichts mehr.
  const repoNames = new Map(files.map((f) => [nameOf(f), f]));

  const orphans = [...info.ledger.keys()].filter((n) => !repoVersions.has(info.ledger.get(n))
    && !repoNames.has(nameOf(n)) && !aliasOwner.has(n));
  add(orphans.length === 0 ? 'PASS' : 'FAIL', 'G-ledger',
    'keine DB-Migration ohne Repo-Datei',
    orphans.length
      ? `nur auf der DB: ${orphans.join(', ')} -- Out-of-Band-Aenderung, nachdokumentieren`
      : 'Repo und Ledger decken sich');

  // Die Zuordnung prueft sich selbst. Sonst waere sie eine Ausnahmeliste, in
  // der ein Befund dauerhaft ruhen kann: ein Eintrag auf eine geloeschte Datei
  // oder auf einen Ledger-Namen, den es nicht gibt, wuerde beide Richtungen
  // oben stillschweigend entschaerfen.
  const knownFiles = new Set(files);
  const staleAliases = [];
  for (const [file, names] of Object.entries(aliasMap)) {
    if (!knownFiles.has(file)) {
      staleAliases.push(`${file} (Repo-Datei fehlt)`);
      continue;
    }
    for (const ledgerName of names) {
      if (!info.ledger.has(ledgerName)) {
        staleAliases.push(`${file} -> ${ledgerName} (nicht im Ledger)`);
      }
    }
  }
  add(staleAliases.length === 0 ? 'PASS' : 'FAIL', 'G-ledger',
    'die Ledger-Zuordnung ist aktuell',
    staleAliases.length
      ? `veraltete Eintraege: ${staleAliases.join(', ')} -- ledgerAliases in der Baseline bereinigen`
      : `${Object.keys(aliasMap).length} Datei(en) mit abweichendem Ledger-Namen zugeordnet`);

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

if (!dbUrl && !useParts) {
  fail(EXIT_UNVERIFIABLE,
    'Keine Datenbank-Zugangsdaten gesetzt -- die Invarianten sind damit NICHT geprueft.\n'
    + 'Entweder SUPABASE_DB_URL (Connection-String) oder die Einzelfelder\n'
    + 'SUPABASE_DB_HOST / _USER / _PASSWORD (empfohlen, keine URL-Kodierung noetig).\n'
    + 'Einrichtung: docs/DB_SECURITY_CI_SETUP.md');
}
// Konfigurationsbefund vor dem ersten Verbindungsversuch.
//
// Warum abgeleitete Merkmale statt der Werte selbst: GitHub maskiert jeden
// Secret-Wert im Log zu ***, auch Host und Benutzername. Eine Zeile wie
// "Verbinde ueber ***@***:***" beantwortet keine einzige Frage. Diese Merkmale
// verraten nichts Vertrauliches, entscheiden aber genau die Fragen, an denen
// eine fehlgeschlagene Anmeldung typischerweise haengt.
{
  const cfg = [];
  if (useParts) {
    cfg.push('Zugang: Einzelfelder (SUPABASE_DB_HOST/_USER/_PASSWORD)');
    cfg.push(`  Benutzername mit Projekt-Referenz (<rolle>.<ref>): ${
      /^[^.]+\.[A-Za-z0-9]{16,}$/.test(dbParts.user) ? 'ja' : 'NEIN -- der Pooler braucht sie'}`);
    cfg.push(`  Host ist ein Pooler-Host: ${
      /pooler\.supabase\.com$/.test(dbParts.host) ? 'ja' : 'NEIN -- die Direktadresse ist IPv6-only'}`);
    cfg.push(`  Port: ${dbParts.port}${dbParts.port === '5432' ? ' (Session-Modus)'
      : ' -- erwartet 5432; die Proben brauchen SET LOCAL ROLE'}`);
    cfg.push(`  Passwortlaenge: ${dbParts.password.length} Zeichen`);
    if (trimmedFields.length) {
      cfg.push(`  ACHTUNG: Leerraum entfernt aus ${trimmedFields.join(', ')}`
        + ' -- beim Kopieren ins Secret ist ein Zeilenumbruch mitgewandert.'
        + ' Dieser Lauf laeuft trotzdem, aber das Secret sollte korrigiert werden.');
    }
  } else {
    cfg.push('Zugang: SUPABASE_DB_URL (Connection-String)');
    try {
      const u = new URL(dbUrl);
      const pw = decodeURIComponent(u.password || '');
      cfg.push(`  Benutzername mit Projekt-Referenz: ${
        /^[^.]+\.[A-Za-z0-9]{16,}$/.test(decodeURIComponent(u.username)) ? 'ja' : 'NEIN'}`);
      cfg.push(`  Host ist ein Pooler-Host: ${/pooler\.supabase\.com$/.test(u.hostname) ? 'ja' : 'NEIN'}`);
      cfg.push(`  Port: ${u.port || '(nicht gesetzt)'}`);
      cfg.push(`  Passwortlaenge: ${pw.length} Zeichen`);
      const risky = [...new Set([...pw].filter((c) => '/@%:#?[]'.includes(c)))];
      if (risky.length) {
        cfg.push(`  URL-kritische Zeichen im Passwort: ${risky.join(' ')}`
          + ' -- besser auf die Einzelfelder wechseln');
      }
    } catch {
      cfg.push('  Der String liess sich nicht als URL lesen -- Tippfehler oder fehlendes Schema?');
    }
  }
  process.stderr.write(`${cfg.join('\n')}\n`);
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
        + '  supabase/migrations/20260808114412_ci_security_verifier_role.sql\n'
        + 'ist noch nicht angewandt. Bis dahin sind die Invarianten NICHT geprueft.\n'
        + `\npsql:\n${stderr}`);
    }
    // Haeufigster Einrichtungsfehler, und die generische Meldung hilft dabei
    // nicht weiter. Die DB-Seite ist in diesem Fall meist in Ordnung -- es
    // liegt am Connection-String.
    if (/password authentication failed|28P01/i.test(stderr)) {
      fail(EXIT_UNVERIFIABLE,
        'Die Anmeldung an der Datenbank wurde abgelehnt -- die Invarianten sind NICHT geprueft.\n'
        + '\nDie drei haeufigsten Ursachen, in dieser Reihenfolge:\n'
        + '\n1. Sonderzeichen im Passwort. Ueber den Pooler laeuft ein URI, und "/", "@", "%"\n'
        + '   und ":" im Passwort zerlegen ihn falsch -- `openssl rand -base64 32` erzeugt\n'
        + '   genau solche Zeichen. Loesung: die Einzelfelder verwenden statt des URI\n'
        + '   (SUPABASE_DB_HOST / _PORT / _USER / _PASSWORD / _NAME). Dann wird das Passwort\n'
        + '   nirgends geparst.\n'
        + '\n2. Benutzername ohne Projekt-Referenz. Der Pooler braucht das Format\n'
        + '   <rolle>.<projekt-ref>, also z.B. voxera_ci_verifier.abcdefghijklmnop --\n'
        + '   der blosse Rollenname reicht nicht.\n'
        + '\n3. Das Passwort im Secret weicht von dem auf der Rolle gesetzten ab. Neu setzen:\n'
        + "   alter role voxera_ci_verifier password '...';\n"
        + '\nNachpruefen laesst sich das ausserhalb von CI mit:\n'
        + '   PGPASSWORD=... psql -h <pooler-host> -p 5432 -U <rolle>.<ref> -d postgres -c "select 1"\n'
        + '\nEinrichtung: docs/DB_SECURITY_CI_SETUP.md\n'
        + `\npsql:\n${stderr}`);
    }
    if (/Tenant or user not found/i.test(stderr)) {
      fail(EXIT_UNVERIFIABLE,
        'Der Pooler kennt den Benutzer nicht. Fast immer fehlt die Projekt-Referenz im\n'
        + 'Benutzernamen -- der Pooler erwartet <rolle>.<projekt-ref>, nicht nur <rolle>.\n'
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
