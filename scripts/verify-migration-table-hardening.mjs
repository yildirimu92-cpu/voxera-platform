// Guard: jede neue Tabelle in public wird in derselben Migration gehaertet.
//
// Anlass (2026-08-09): 2026-08-09_notification_mode_gating.sql legte per
// CREATE TABLE AS eine Sicherungskopie von public.customers an -- und nur die
// Kopie, nicht die Haertung. CREATE TABLE AS erzeugt eine Tabelle mit RLS=off,
// und die Default-Privileges des Projekts geben anon und authenticated in
// public ALL. Die Kopie mit echten Kundendaten war damit ueber die
// oeffentliche API les- und schreibbar, bis sie nachtraeglich geschlossen
// wurde.
//
// Warum ein Skript und nicht "beim naechsten Mal daran denken": in derselben
// Nacht begruendet 2026-08-09_admin_notification_settings.sql genau diese
// Haertung ausdruecklich, mit Verweis auf den notifications-Vorfall vom
// 08.08. Die Regel war also bekannt und trotzdem zwei Dateien weiter nicht
// angewandt -- weil eine Sicherungstabelle nicht wie ein Feature aussieht und
// die Aufmerksamkeit am Zweck der Migration hing, nicht an ihrem Nebenprodukt.
// Gegen genau solche Luecken hilft nur eine Pruefung, die nicht muede wird.
//
// Geprueft wird supabase/migrations/ -- das aktive Register. Der historische
// Ordner supabase/sql/ bleibt aussen vor: dessen Tabellen sind nachtraeglich
// durch 2026-08-06_p0_rls_tenant_isolation_hardening.sql und die
// P0-Foundation gehaertet worden, eine Rueckdatierung wuerde nur Rauschen
// erzeugen.
//
// Bewusst oeffentliche Tabellen sind moeglich, muessen es aber sagen:
//   -- HARDENING-AUSNAHME: <Begruendung>
// in derselben Datei. Eine Ausnahme, die niemand begruendet, ist ein Fehler.

import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = 'supabase/migrations';
const EXEMPTION_MARKER = 'HARDENING-AUSNAHME';

let failed = 0;
const check = (name, passed, detail) => {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${!passed && detail ? ` — ${detail}` : ''}`);
  if (!passed) failed += 1;
};

// Kommentare entfernen, damit ein "create table" in einer Erklaerung nicht als
// DDL zaehlt -- und damit ein revoke, das nur im Kommentar steht, nicht als
// Haertung durchgeht.
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const files = fs.readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

check(`${MIGRATIONS_DIR} enthaelt Migrationen`, files.length > 0);

let createdTables = 0;

for (const file of files) {
  const fullPath = path.join(MIGRATIONS_DIR, file);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const sql = stripComments(raw);
  const exempt = raw.includes(EXEMPTION_MARKER);

  // Beide Formen: "create table public.x (...)" und "create table public.x as select".
  const tables = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi)]
    .map((match) => match[1].toLowerCase());

  for (const table of [...new Set(tables)]) {
    createdTables += 1;
    const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasRls = new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?public\\.${escaped}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(sql);
    // Alle im Repo vorkommenden Schreibweisen zaehlen:
    //   revoke all on public.x from anon;
    //   revoke all on public.x from anon, authenticated;      (Sammelform)
    //   revoke all privileges on table public.x from anon;    (mit "table")
    //
    // Die ersten beiden Fassungen dieser Pruefung kannten je nur eine davon
    // und meldeten deshalb acht bzw. eine Migration faelschlich als
    // ungehaertet. Das ist dieselbe Fehlerklasse, die dieses Skript ueberhaupt
    // erst noetig gemacht hat -- ein Waechter, der falsch Alarm schlaegt, wird
    // genauso ignoriert wie einer, der schweigt.
    const revokeTargets = [...sql.matchAll(
      new RegExp(`revoke\\s+[\\s\\S]{0,80}?on\\s+(?:table\\s+)?public\\.${escaped}\\s+from\\s+([a-z0-9_,\\s]+)`, 'gi')
    )].map((match) => match[1].toLowerCase());
    const revokedAnon = revokeTargets.some((target) => /\banon\b/.test(target));
    const revokedAuthed = revokeTargets.some((target) => /\bauthenticated\b/.test(target));
    // Eine Policy ersetzt das Revoke: dann ist der Zugriff bewusst geregelt
    // statt gesperrt. Ohne RLS hilft eine Policy allerdings nicht.
    const hasPolicy = new RegExp(`create\\s+policy[\\s\\S]{0,200}?on\\s+(?:table\\s+)?public\\.${escaped}`, 'i').test(sql);

    if (exempt) {
      console.log(`SKIP ${file}: ${table} — als Ausnahme begruendet`);
      continue;
    }

    check(
      `${file}: public.${table} schaltet RLS ein`,
      hasRls,
      'neue Tabellen in public starten mit RLS=off'
    );
    check(
      `${file}: public.${table} regelt den Browser-Zugriff`,
      (revokedAnon && revokedAuthed) || hasPolicy,
      'die Default-Privileges geben anon und authenticated in public ALL — '
        + 'entweder revoke fuer beide oder eine ausdrueckliche Policy'
    );
  }
}

check('Es wurden ueberhaupt Tabellen-DDL gefunden', createdTables > 0, 'sonst prueft dieses Skript nichts');
console.log(`\n${createdTables} Tabellen-Definition(en) in ${files.length} Migrationen geprueft.`);
console.log(failed === 0 ? 'Tabellen-Haertung verifiziert.' : `${failed} Pruefung(en) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
