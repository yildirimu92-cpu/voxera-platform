#!/usr/bin/env node
//
// Haelt die Schreibzugriffe des Customer Dashboards gegen die tatsaechlichen
// Spaltenrechte der Rolle `authenticated` auf der Produktions-DB.
//
// Warum es diesen Waechter gibt -- zwei Vorfaelle, beide dieselbe Luecke:
//
//   2026-08-08, PR #847: `saveFollowUpV2()` bekam
//   `.update({ callback_requested: false })`, die Spalten-Allowlist wurde nicht
//   nachgezogen. Drei Tage lang 403. Die Oberflaeche meldete "Nachfassen
//   gespeichert", der Anruf blieb in Rueckrufliste und KPI stehen.
//
//   2026-08-11, 21:15 UTC: derselbe Grant wurde als vermeintlich tot
//   zurueckgenommen -- 88 Minuten nachdem er die Reparatur oben war. 27 Minuten
//   lang derselbe Fehler.
//
// Beide Male war die Frage dieselbe: schreibt der Browser eine Spalte, auf die
// er kein Recht hat? Beide Male hat sie niemand gestellt. Dieses Skript stellt
// sie bei jedem Lauf.
//
// Ausgabekontrakt, eine Zeile je Befund:
//     STATUS <tab> NAME <tab> DETAIL
// STATUS aus PASS | FAIL | SKIP.
//
// Dreiwertig, und das ist der Punkt: Findet der Parser fuer eine Tabelle keine
// Schreibstelle, ist das KEIN PASS. Ein Waechter, der gruen wird, weil er nichts
// mehr versteht, ist schlimmer als keiner -- er behauptet Sicherheit, wo er nur
// blind ist. Solche Faelle sind SKIP mit Begruendung, und wenn ueberhaupt keine
// Schreibstelle mehr gefunden wird, endet der Lauf als unverifizierbar (Exit 2).
//
// Exit: 0 = kein FAIL, 1 = mindestens ein FAIL, 2 = nicht verifizierbar.

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_UNVERIFIABLE = 2;

const SOURCE = new URL('../customer-dashboard/index.html', import.meta.url);

// ─────────────────────────────────────────────────────────────────────────────
// Teil 1: Was schreibt der Browser?
// ─────────────────────────────────────────────────────────────────────────────

// `.from(CALLS_TABLE)` ist genauso haeufig wie `.from('calls')`. Ohne diese
// Aufloesung waere vxBestEffortPatchCallLifecycle() unsichtbar -- und das ist
// eine der Stellen, die wirklich schreiben.
function collectTableConstants(source) {
  const map = new Map();
  const re = /(?:const|var|let)\s+([A-Z][A-Z0-9_]*)\s*=\s*'([a-z_][a-z0-9_]*)'/g;
  let m;
  while ((m = re.exec(source)) !== null) map.set(m[1], m[2]);
  return map;
}

// Klammernzaehlend statt regulaerer Ausdruck: Objektliterale enthalten
// verschachtelte Objekte, Strings mit Klammern und Template-Literale. Ein
// `\{([^}]*)\}` bricht an der ersten davon ab und liefert eine halbe Spaltenliste
// -- also stillschweigend zu wenig Spalten, und damit falsches Gruen.
function readBalanced(source, start) {
  const open = source[start];
  const close = open === '{' ? '}' : open === '[' ? ']' : open === '(' ? ')' : null;
  if (!close) return null;
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    const prev = source[i - 1];
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return { body: source.slice(start + 1, i), end: i };
    }
  }
  return null;
}

// Nur Schluessel der obersten Ebene. `{ a: { b: 1 } }` schreibt die Spalte a,
// nicht b.
function topLevelKeys(objectBody) {
  const keys = [];
  let depth = 0;
  let quote = null;
  let token = '';
  for (let i = 0; i < objectBody.length; i += 1) {
    const ch = objectBody[i];
    const prev = objectBody[i - 1];
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      else token += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; token = ''; continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth += 1; token = ''; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth -= 1; token = ''; continue; }
    if (ch === ',' && depth === 0) { token = ''; continue; }
    if (ch === ':' && depth === 0) {
      const key = token.trim();
      if (/^[a-z_][a-z0-9_]*$/i.test(key)) keys.push(key);
      token = '';
      continue;
    }
    token += ch;
  }
  return keys;
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

/**
 * Findet die Schreibzugriffe. Rueckgabe je Stelle:
 *   { table, operation, columns | null, line }
 * `columns === null` heisst: die Stelle schreibt, aber welche Spalten steht
 * nicht im Quelltext (`.update(fields)` mit einer Variablen). Das ist kein
 * Fehler und kein Freibrief -- es wird als SKIP gemeldet.
 */
export function extractBrowserWrites(source) {
  const constants = collectTableConstants(source);
  const writes = [];
  const fromRe = /\.from\(\s*(?:'([a-z_][a-z0-9_]*)'|([A-Za-z_$][\w$]*))\s*\)/g;
  let m;
  while ((m = fromRe.exec(source)) !== null) {
    const table = m[1] || constants.get(m[2]);
    if (!table) continue;

    // Die Kette darf umbrochen und eingerueckt sein; 600 Zeichen decken die
    // laengste Formatierung im Bestand ab, ohne in den naechsten Aufruf zu
    // laufen.
    const window = source.slice(m.index, m.index + 600);
    const op = window.match(/\.(update|insert|upsert)\(/);
    if (!op) continue;

    const argStart = m.index + op.index + op[0].length;
    let columns = null;
    const firstChar = source.slice(argStart).match(/^\s*(.)/);
    if (firstChar && (firstChar[1] === '{' || firstChar[1] === '[')) {
      const outer = readBalanced(source, argStart + firstChar[0].length - 1);
      if (outer) {
        const body = firstChar[1] === '['
          ? (() => {
              const inner = outer.body.indexOf('{');
              if (inner < 0) return null;
              const obj = readBalanced(outer.body, inner);
              return obj ? obj.body : null;
            })()
          : outer.body;
        if (body !== null) columns = topLevelKeys(body);
      }
    }

    writes.push({ table, operation: op[1].toUpperCase(), columns, line: lineOf(source, m.index) });
  }
  return writes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Teil 2: Was darf `authenticated` tatsaechlich?
// ─────────────────────────────────────────────────────────────────────────────

// BEWUSST ueber pg_catalog, nicht ueber information_schema.column_privileges.
// Deren Sichten filtern auf `enabled_roles`; die CI-Rolle ist NOINHERIT, also
// sind `anon` und `authenticated` dort nicht enthalten und jede Abfrage liefert
// null Zeilen -- "keine Rechte gefunden", und damit waere jeder Check gruen.
// Dieselbe Falle steht schon im Invariantenkatalog beschrieben; sie hier
// zweitesmal zu bauen waere vermeidbar.
function buildGrantQuery(tables) {
  const list = tables.map(t => `'${t}'`).join(', ');
  return `
    select cl.relname, a.attname,
           has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE'),
           has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT')
    from pg_catalog.pg_attribute as a
    join pg_catalog.pg_class as cl on cl.oid = a.attrelid
    join pg_catalog.pg_namespace as n on n.oid = cl.relnamespace
    where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
      and cl.relname in (${list})
    order by cl.relname, a.attname;`;
}

function psqlArgs() {
  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';
  const base = ['-X', '-q', '-A', '-t', '-F', '\t', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1'];
  if (process.env.SUPABASE_DB_HOST && process.env.SUPABASE_DB_USER) {
    return {
      args: [
        '-h', process.env.SUPABASE_DB_HOST,
        '-p', process.env.SUPABASE_DB_PORT || '5432',
        '-U', process.env.SUPABASE_DB_USER,
        '-d', process.env.SUPABASE_DB_NAME || 'postgres',
        ...base
      ],
      env: {
        ...process.env,
        PGPASSWORD: process.env.SUPABASE_DB_PASSWORD || '',
        PGSSLMODE: process.env.PGSSLMODE || 'require'
      },
      secret: process.env.SUPABASE_DB_PASSWORD || ''
    };
  }
  if (url) return { args: [url, ...base], env: process.env, secret: url };
  return null;
}

export function parseGrantRows(stdout) {
  const grants = new Map();
  for (const line of stdout.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [table, column, upd, ins] = parts.map(s => s.trim());
    if (!table || !column) continue;
    grants.set(`${table}.${column}`, { UPDATE: upd === 't', INSERT: ins === 't' });
  }
  return grants;
}

function fetchGrants(tables) {
  const conn = psqlArgs();
  if (!conn) {
    return { error: 'Keine Zugangsdaten. Erwartet SUPABASE_DB_URL oder SUPABASE_DB_HOST/_USER/_PASSWORD.' };
  }
  const proc = spawnSync('psql', [...conn.args, '-c', buildGrantQuery(tables)], {
    env: conn.env, encoding: 'utf8', timeout: 120_000
  });
  if (proc.error && proc.error.code === 'ENOENT') {
    return { error: 'psql ist nicht installiert. Der Workflow installiert postgresql-client.' };
  }
  if (proc.status !== 0) {
    let stderr = (proc.stderr || '').trim();
    // Der Connection-String enthaelt das Passwort. Er darf nicht ins Log.
    if (conn.secret) stderr = stderr.split(conn.secret).join('<redacted>');
    return { error: `psql endete mit Status ${proc.status}: ${stderr}` };
  }
  return { grants: parseGrantRows(proc.stdout || '') };
}

// ─────────────────────────────────────────────────────────────────────────────
// Teil 3: Der Abgleich
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prueft in EINE Richtung: jede Spalte, die der Browser schreibt, braucht das
 * Recht. Die Gegenrichtung -- ein Recht ohne Schreibstelle -- wird berichtet,
 * aber nicht rot gefaerbt. Genau diese Umkehrung hat am 2026-08-11 zum falschen
 * Rechte-Entzug gefuehrt: dass der Parser keine Stelle sieht, beweist nicht,
 * dass es keine gibt. Ein Waechter, der zum Loeschen von Rechten auffordert,
 * muesste dafuer sicherer sein als dieser hier sein kann.
 */
export function compare(writes, grants) {
  const results = [];
  const seen = new Set();

  for (const w of writes) {
    if (w.columns === null) {
      results.push({
        status: 'SKIP',
        name: `${w.table}:${w.line}`,
        detail: `${w.operation} mit variablem Objekt — Spalten stehen nicht im Quelltext, nicht pruefbar`
      });
      continue;
    }
    if (w.columns.length === 0) {
      results.push({
        status: 'SKIP',
        name: `${w.table}:${w.line}`,
        detail: `${w.operation} ohne erkennbare Spalten — Parser pruefen`
      });
      continue;
    }
    for (const col of w.columns) {
      const key = `${w.table}.${col}`;
      const grant = grants.get(key);
      const dedupe = `${key}:${w.operation}`;
      if (!grant) {
        results.push({
          status: 'SKIP',
          name: key,
          detail: `Spalte in der Datenbank nicht gefunden (Zeile ${w.line}) — Tippfehler oder umbenannt?`
        });
        continue;
      }
      if (!grant[w.operation]) {
        results.push({
          status: 'FAIL',
          name: key,
          detail: `Browser schreibt (Zeile ${w.line}), aber authenticated hat kein ${w.operation}-Recht — 403, stiller Datenverlust`
        });
        continue;
      }
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      results.push({
        status: 'PASS',
        name: key,
        detail: `${w.operation} erlaubt (Zeile ${w.line})`
      });
    }
  }

  // Gegenrichtung, aber eng gefasst: gemeldet werden nur Rechte fuer die
  // Tabelle/Operation-Paare, die der Browser ueberhaupt benutzt. `customers`
  // traegt ~140 INSERT-Rechte, die der Browser nie anfasst -- die hier
  // aufzulisten hiesse, den einen echten Befund in Rauschen zu begraben.
  const usedPairs = new Set(writes.map(w => `${w.table}:${w.operation}`));
  const written = new Set(
    writes.filter(w => Array.isArray(w.columns)).flatMap(w => w.columns.map(c => `${w.table}.${c}`))
  );
  // Eine Stelle mit unbekannten Spalten kann jede Spalte ihrer Tabelle
  // schreiben. Fuer diese Tabellen ist die Gegenrichtung nicht aussagekraeftig.
  const opaqueTables = new Set(writes.filter(w => w.columns === null).map(w => w.table));

  for (const [key, g] of grants) {
    const [table] = key.split('.');
    if (written.has(key) || opaqueTables.has(table)) continue;
    for (const op of ['UPDATE', 'INSERT']) {
      if (!g[op] || !usedPairs.has(`${table}:${op}`)) continue;
      results.push({
        status: 'SKIP',
        name: key,
        detail: `${op}-Recht vergeben, keine Schreibstelle im Browser-Code gefunden — vor einem Entzug das Ledger der Datenbank lesen, nicht nur diesen Befund`
      });
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const source = await readFile(SOURCE, 'utf8');
  const writes = extractBrowserWrites(source);

  if (writes.length === 0) {
    console.log('SKIP\tparser\tKeine einzige Schreibstelle in customer-dashboard/index.html erkannt.');
    console.error('\nNicht verifizierbar: Ohne Fundstellen prueft dieses Skript nichts. Das ist kein '
      + 'Erfolg, sondern ein kaputter Parser oder eine umgebaute Datei.');
    process.exit(EXIT_UNVERIFIABLE);
  }

  const tables = [...new Set(writes.map(w => w.table))].sort();
  const { grants, error } = fetchGrants(tables);
  if (error) {
    console.log(`SKIP\tdatenbank\t${error}`);
    console.error(`\nNicht verifizierbar: ${error}`);
    process.exit(EXIT_UNVERIFIABLE);
  }
  if (grants.size === 0) {
    console.log('SKIP\tdatenbank\tKeine Spaltenrechte gelesen.');
    console.error('\nNicht verifizierbar: Die Abfrage lieferte null Zeilen. Rolle und Sichtbarkeit pruefen.');
    process.exit(EXIT_UNVERIFIABLE);
  }

  const results = compare(writes, grants);
  for (const r of results) console.log(`${r.status}\t${r.name}\t${r.detail}`);

  const failed = results.filter(r => r.status === 'FAIL');
  const skipped = results.filter(r => r.status === 'SKIP');
  const passed = results.filter(r => r.status === 'PASS');

  console.error(`\n${passed.length} PASS, ${failed.length} FAIL, ${skipped.length} SKIP `
    + `aus ${writes.length} Schreibstellen in ${tables.length} Tabellen.`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = ['## Browser-Spaltenrechte', '', '| Status | Spalte | Detail |', '| --- | --- | --- |'];
    for (const r of results) md.push(`| ${r.status} | \`${r.name}\` | ${r.detail} |`);
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md.join('\n')}\n`);
  }

  process.exit(failed.length === 0 ? EXIT_OK : EXIT_FAIL);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
