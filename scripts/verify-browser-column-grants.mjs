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

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Dateien, die den Supabase-Client IM BROWSER benutzen. Netlify-Functions sind
// bewusst nicht dabei: die laufen mit service_role und unterliegen weder RLS
// noch diesen Spaltenrechten.
const BROWSER_DATEIEN = [
  'customer-dashboard/index.html',
  'admin-panel/index.html',
];
const BROWSER_VERZEICHNISSE = ['customer-dashboard/shared', 'admin-panel/shared'];

const ROLLE = 'authenticated';

/**
 * Verzeichnis nach *.js absuchen -- bewusst OHNE fs.globSync.
 *
 * globSync gibt es erst ab Node 22. Der `import` haette den Modulstart auf
 * Node 20 zerlegt, und zwar VOR jedem try/catch: ein fehlender Named Export
 * eines Builtins ist ein Link-Fehler, kein Laufzeitfehler. Der Waechter waere
 * damit in genau der Umgebung nie gelaufen, in der er laufen soll -- 38 der 43
 * Workflows dieses Repos stehen auf Node 20.
 *
 * Gefunden im Review von PR #948. Ein `catch { /* Node < 22 *\/ }` um den
 * Aufruf half nicht: der Fehler entsteht beim Laden, nicht beim Aufrufen.
 */
function jsDateien(verzeichnis) {
  if (!existsSync(verzeichnis)) return [];
  return readdirSync(verzeichnis)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(verzeichnis, f))
    .sort();
}

/**
 * Schreibstellen, deren Tabelle oder Payload sich statisch nicht aufloesen
 * laesst, die aber bekannt und von Hand nachgetragen sind.
 *
 * Warum eine gepflegte Liste und nicht "still ueberspringen": Eine Stelle, die
 * der Waechter nicht auswerten kann, ist ein Loch in ihm. Als blosser HINWEIS
 * gedruckt liest sie niemand; als Eintrag hier wird sie GEPRUEFT wie jede
 * andere, weil die Spalten danebenstehen.
 *
 * Die Liste prueft sich selbst in beide Richtungen: Ein Eintrag ohne
 * zugehoerige Fundstelle ist veraltet und faerbt den Lauf rot. Eine nicht
 * auswertbare Fundstelle ohne Eintrag ebenfalls. Sonst waere das hier eine
 * Ausnahmeliste, in der ein Befund dauerhaft ruhen kann.
 */
// Der Eintrag fuer vxBestEffortPatchCallLifecycle stand hier bis 2026-08-12.
// Er ist entfallen, weil die Stelle entfallen ist: die Lifecycle-Zeitstempel
// setzt jetzt call-update-status serverseitig, der Browser schreibt sie nicht
// mehr. Die Selbstpruefung der Liste hat das erzwungen -- ein Eintrag ohne
// Fundstelle faerbt den Lauf rot. Genau dafuer ist sie da.
const HANDGEPFLEGTE_STELLEN = [
  {
    datei: 'customer-dashboard/index.html',
    tabelle: 'customer_tasks',
    funktion: 'vxBestEffortPatchTaskLifecycle',
    spalten: ['updated_at', 'completed_at', 'archived_at'],
    grund: 'Gleiche Bauform: `taskLifecyclePatch` entsteht beim Aufrufer und wird '
      + 'als Parameter uebergeben. CASES_TABLE ist customer_tasks. Die drei Rechte '
      + 'bestehen hier (Tabellen-Grant, nachgemessen 12.08.) -- der Eintrag deckt die '
      + 'Stelle trotzdem ab, damit die Deckung nicht davon abhaengt, dass das Grant '
      + 'heute breit genug ist.',
  },
];

/**
 * Sammelt Konstanten der Form `const CALLS_TABLE = 'calls';`.
 *
 * Ohne sie war `sb.from(CALLS_TABLE)` fuer die Extraktion NICHT VORHANDEN --
 * der Tabellenname stand nicht in Anfuehrungszeichen, also griff das Muster
 * nicht, und die Stelle fiel weder als Treffer noch als unklar auf. Genau so
 * uebersah die erste Fassung dieses Waechters den zweiten Fall derselben
 * Fehlerklasse, den zu finden er gebaut wurde (Review PR #948).
 */
function sammleTabellenkonstanten(quelle) {
  const konst = new Map();
  const re = /\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([a-z_][a-z0-9_]*)['"]\s*;/g;
  let m;
  while ((m = re.exec(quelle)) !== null) konst.set(m[1], m[2]);
  return konst;
}

/**
 * Findet `.from(<tabelle>) ... .update({ a: ..., b: ... })` und liefert je Fund
 * Tabelle, Spalten und Fundstelle.
 *
 * `<tabelle>` ist entweder ein Stringliteral oder ein Bezeichner, der oben in
 * der Datei auf ein Literal gesetzt wurde.
 *
 * Drei Ausgaenge, und die Trennung ist der Punkt:
 *   treffer  -- Tabelle UND Spalten aufgeloest, wird gegen die Rechte geprueft.
 *   unklar   -- Stelle erkannt, aber nicht auswertbar (Payload in einer
 *               Variablen, Tabellenname aus einem Ausdruck). Diese Stellen
 *               MUESSEN in HANDGEPFLEGTE_STELLEN stehen, sonst ist der Lauf
 *               rot. Stillschweigend uebergehen hiesse: der Waechter meldet
 *               PASS fuer Code, den er nie angesehen hat.
 *   (nichts)  -- keine .update()-Stelle im Fenster.
 */
export function extrahiereSchreibstellen(quelle, dateiname = '<inline>') {
  const treffer = [];
  const unklar = [];
  const konst = sammleTabellenkonstanten(quelle);
  // Literal ODER Bezeichner -- der zweite Zweig ist die Lehre aus dem Review.
  const re = /\.from\(\s*(?:['"]([a-z_][a-z0-9_]*)['"]|([A-Za-z_$][\w$]*))\s*\)/g;
  let m;
  while ((m = re.exec(quelle)) !== null) {
    const literal = m[1];
    const bezeichner = m[2];
    const tabelle = literal || konst.get(bezeichner) || null;
    const fenster = quelle.slice(m.index, m.index + 400);
    const upd = fenster.match(/\.update\(\s*(\{[^}]*\}|[A-Za-z_$][\w$]*)/);
    if (!upd) continue;
    const zeile = quelle.slice(0, m.index).split('\n').length;

    if (!tabelle) {
      unklar.push({ tabelle: `<${bezeichner}?>`, datei: dateiname, zeile,
        ausdruck: `from(${bezeichner})`, grundfehlt: 'Tabellenname nicht aufloesbar' });
      continue;
    }
    if (!upd[1].startsWith('{')) {
      unklar.push({ tabelle, datei: dateiname, zeile, ausdruck: upd[1],
        grundfehlt: 'Payload in einer Variablen' });
      continue;
    }
    const spalten = [...upd[1].matchAll(/([A-Za-z_][\w]*)\s*:/g)].map((s) => s[1]);
    if (spalten.length) treffer.push({ tabelle, spalten, datei: dateiname, zeile });
  }
  return { treffer, unklar };
}

function sammleAusRepo() {
  const dateien = [...BROWSER_DATEIEN];
  for (const v of BROWSER_VERZEICHNISSE) dateien.push(...jsDateien(v));
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
    const CALLS_TABLE = 'calls';
    sb.from('calls').update({ callback_requested: false }).eq('id', x)
    sb.from('calls').update({ read_at: iso, updated_at: n }).eq('id', y)
    sb.from('kunden').update(payload).eq('id', z)
    sb.from(CALLS_TABLE).update(fields).eq('id', w)
    sb.from(unbekannteVariable).update({ irgendwas: 1 }).eq('id', v)
  `;
  const { treffer, unklar } = extrahiereSchreibstellen(fingiert, '<fingiert>');
  pruefe('Objektliteral wird gelesen',
    treffer.some((t) => t.tabelle === 'calls' && t.spalten.includes('callback_requested')));
  pruefe('mehrere Spalten in einem Aufruf',
    treffer.some((t) => t.spalten.includes('read_at') && t.spalten.includes('updated_at')));
  pruefe('Variable statt Literal wird als unklar gemeldet, nicht verschluckt',
    unklar.some((u) => u.tabelle === 'kunden' && u.ausdruck === 'payload'));

  // Die beiden Gegenproben zum Review von PR #948. Vorher war `.from(KONST)`
  // fuer die Extraktion schlicht nicht vorhanden -- kein Treffer, kein Hinweis.
  pruefe('.from(KONSTANTE) wird zur Tabelle aufgeloest',
    unklar.some((u) => u.tabelle === 'calls' && u.ausdruck === 'fields'),
    'sb.from(CALLS_TABLE).update(fields) -> calls, Payload unklar');
  pruefe('.from(unaufloesbar) faellt auf, statt unsichtbar zu bleiben',
    unklar.some((u) => u.grundfehlt === 'Tabellenname nicht aufloesbar'));

  // Gegenprobe zur Selbstpruefung der gepflegten Liste: ein Eintrag, der auf
  // keine Fundstelle passt, MUSS auffallen.
  {
    const schluessel = new Set(HANDGEPFLEGTE_STELLEN.map((s) => `${s.datei}|${s.tabelle}`));
    const erfunden = { datei: 'gibt-es-nicht.html', tabelle: 'nirgends' };
    pruefe('veralteter Eintrag waere erkennbar',
      !schluessel.has(`${erfunden.datei}|${erfunden.tabelle}`));
  }

  // Die eigentliche Gegenprobe: der echte Repo-Stand muss den bekannten Fall
  // enthalten. Findet die Extraktion ihn nicht, misst der Waechter am
  // Gegenstand vorbei -- unabhaengig davon, was die DB sagt.
  const { alle, alleUnklar, gelesen } = sammleAusRepo();
  pruefe('Browser-Dateien gefunden', gelesen > 0, `${gelesen} Dateien`);
  pruefe('bekannter Fall callback_requested wird im echten Code gefunden',
    alle.some((t) => t.tabelle === 'calls' && t.spalten.includes('callback_requested')),
    'customer-dashboard/index.html:19634');
  pruefe('Extraktion liefert ueberhaupt Schreibstellen', alle.length > 0, `${alle.length} Stellen`);

  // Konstantenaufloesung am ECHTEN Repo-Stand, nicht nur am fingierten
  // Schnipsel. Bis 2026-08-12 hing dieser Test an
  // vxBestEffortPatchCallLifecycle; die Stelle ist entfallen (Zeitstempel jetzt
  // serverseitig). Er haengt jetzt an vxBestEffortPatchTaskLifecycle --
  // dieselbe Bauform, `sb.from(CASES_TABLE).update(fields)`, CASES_TABLE ist
  // customer_tasks. Der Test darf nicht ersatzlos wegfallen: er ist die
  // Gegenprobe dafuer, dass die Aufloesung auf gewachsenem Code greift und
  // nicht nur auf dem, was der Test selbst schreibt.
  pruefe('.from(KONSTANTE) wird auch im echten Repo-Stand aufgeloest',
    alleUnklar.some((u) => u.tabelle === 'customer_tasks'
      && u.datei.endsWith('customer-dashboard/index.html')),
    'sb.from(CASES_TABLE).update(fields) -> customer_tasks');

  // Jede nicht auswertbare Fundstelle muss gedeckt sein, sonst ist der
  // Regullauf rot -- das hier sagt frueh, WELCHE fehlt.
  const gedeckt = new Set(HANDGEPFLEGTE_STELLEN.map((s) => `${s.datei}|${s.tabelle}`));
  const offen = alleUnklar.filter((u) => !gedeckt.has(`${u.datei}|${u.tabelle}`));
  pruefe('jede unauswertbare Stelle ist nachgetragen', offen.length === 0,
    offen.map((u) => `${u.datei}:${u.zeile} ${u.tabelle}`).join('; ') || 'keine offen');

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

// Nicht auswertbare Stellen gegen die gepflegte Liste halten -- in BEIDE
// Richtungen. Eine Ausnahmeliste, die sich nicht selbst prueft, ist der Ort,
// an dem ein Befund dauerhaft ruht.
const zuUnklar = (u) => `${u.datei}|${u.tabelle}`;
const gepflegt = new Map(HANDGEPFLEGTE_STELLEN.map((s) => [`${s.datei}|${s.tabelle}`, s]));
const benutzt = new Set();
const ungedeckt = [];
for (const u of alleUnklar) {
  const s = gepflegt.get(zuUnklar(u));
  if (!s) { ungedeckt.push(u); continue; }
  benutzt.add(zuUnklar(u));
  // Der Nachtrag wird geprueft wie jede andere Stelle -- das ist sein Zweck.
  alle.push({ tabelle: s.tabelle, spalten: s.spalten, datei: s.datei, zeile: u.zeile,
    nachgetragen: s.funktion });
}
const veraltet = HANDGEPFLEGTE_STELLEN.filter((s) => !benutzt.has(`${s.datei}|${s.tabelle}`));

const fehlend = [];
for (const t of alle) {
  for (const sp of t.spalten) {
    if (!rechte.has(`${t.tabelle}.${sp}`)) fehlend.push({ ...t, spalte: sp });
  }
}

if (!fehlend.length && !ungedeckt.length && !veraltet.length) {
  console.log(`PASS — alle ${alle.length} Schreibstellen haben ein passendes Spaltenrecht.`);
  process.exit(0);
}

if (ungedeckt.length) {
  console.log(`FAIL — ${ungedeckt.length} Schreibstelle(n) sind nicht auswertbar und nirgends nachgetragen:\n`);
  for (const u of ungedeckt) {
    console.log(`  ${u.datei}:${u.zeile}  ${u.tabelle}.update(${u.ausdruck})  [${u.grundfehlt}]`);
  }
  console.log('');
  console.log('Das ist bewusst rot und kein Hinweis: Der Waechter hat diese Stellen NICHT');
  console.log('geprueft. Als blosse Anmerkung gedruckt haette er PASS gemeldet fuer Code,');
  console.log('den er nie angesehen hat -- genau der Fehlermodus, gegen den er gebaut ist.');
  console.log('Behebung: Stelle in HANDGEPFLEGTE_STELLEN eintragen, mit den Spalten, die');
  console.log('sie tatsaechlich schreibt. Danach wird sie geprueft wie jede andere.\n');
}

if (veraltet.length) {
  console.log(`FAIL — ${veraltet.length} Eintrag/Eintraege in HANDGEPFLEGTE_STELLEN passen auf keine Fundstelle:\n`);
  for (const s of veraltet) console.log(`  ${s.datei}  ${s.tabelle}  (${s.funktion})`);
  console.log('  Der Code hat sich geaendert; der Eintrag entschaerft sonst still eine Pruefung.\n');
}

if (fehlend.length) {
  console.log(`FAIL — ${fehlend.length} Spalte(n) ohne UPDATE-Recht fuer ${ROLLE}:\n`);
  for (const f of fehlend) {
    console.log(`  ${f.tabelle}.${f.spalte}`);
    console.log(`      geschrieben in ${f.datei}:${f.zeile}`
      + (f.nachgetragen ? `  (${f.nachgetragen}, nachgetragen)` : ''));
  }
  console.log('');
}
console.log('Der Aufruf scheitert zur Laufzeit mit 403. Je nach Aufrufstelle bemerkt');
console.log('der Kunde davon nichts -- pruefe, ob der Fehlschlag sichtbar wird.');
console.log('');
console.log('Behebung: entweder die Spalte in die Allowlist aufnehmen');
console.log('  grant update (<spalte>) on table public.<tabelle> to authenticated;');
console.log('oder den Schreibzugriff entfernen, wenn er nicht mehr gebraucht wird.');
process.exit(1);
}
