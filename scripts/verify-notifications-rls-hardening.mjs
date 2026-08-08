#!/usr/bin/env node
/**
 * Verifiziert die Notifications-Härtung:
 *   1. RLS-Migration löst den Mandanten über public.current_customer_id() auf
 *      statt über einen rohen customers-Subquery (der ohne Grant auf
 *      customers in 401 endet), analog zu
 *      2026-08-06_p0_rls_tenant_isolation_hardening.sql.
 *   2. Der anonyme INSERT-Pfad auf public.notifications ist auf Policy- UND
 *      auf Grant-Ebene geschlossen — beide Ebenen waren nötig, damit das Loch
 *      überhaupt offen stand, also müssen auch beide geprüft werden.
 *   3. Der Browser startet den Notifications-Lesepfad erst mit echter Session
 *      und nicht mehr an einem blinden Timer.
 *
 * Statisch, ohne DB-Zugriff: die laufzeitseitige Prüfung macht
 * supabase/verification/notifications_rls_post_migration.sql.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const MIGRATION = 'supabase/migrations/2026-08-08_notifications_rls_current_customer_id.sql';
const PREFLIGHT = 'supabase/verification/notifications_rls_preflight.sql';
const POSTFLIGHT = 'supabase/verification/notifications_rls_post_migration.sql';
const INDEX = 'customer-dashboard/index.html';

const migration = fs.readFileSync(MIGRATION, 'utf8');
const preflight = fs.readFileSync(PREFLIGHT, 'utf8');
const postflight = fs.readFileSync(POSTFLIGHT, 'utf8');
const dashboard = fs.readFileSync(INDEX, 'utf8');

// ── 1. Migration: Mandantenauflösung über den DEFINER-Helper ────────────────
assert.match(migration, /begin;[\s\S]*commit;/,
  'Migration ist nicht in eine Transaktion geklammert');
assert.ok(migration.includes('current_customer_id()'),
  'Migration nutzt public.current_customer_id() nicht');
assert.ok(/raise exception[\s\S]{0,200}current_customer_id\(\) is required/.test(migration),
  'Migration bricht nicht ab, wenn der DEFINER-Helper fehlt — sie würde stattdessen ' +
  'Policies anlegen, die jeden Kunden aus seinen eigenen Benachrichtigungen aussperren');

{
  // Die neuen Policies dürfen customers nicht mehr direkt lesen. Die
  // create-policy-Statements sind über Zeilen verkettet, daher auf dem
  // zusammengezogenen Text prüfen.
  const flat = migration.replace(/\s+/g, ' ');
  const selectPolicy = /create policy notifications_select[^']*(?:'\s*\|\|\s*')?[^;]*/i.exec(flat);
  assert.ok(selectPolicy, 'notifications_select wird nicht neu angelegt');
  assert.ok(!/create policy notifications_select[\s\S]{0,400}from customers/i.test(flat),
    'notifications_select liest wieder direkt aus customers');
}

// ── 2. Policies rollengebunden, nicht TO PUBLIC ────────────────────────────
for (const scoped of [
  'for select to authenticated',
  'for update to authenticated',
  'for insert to service_role'
]) assert.ok(migration.replace(/\s+/g, ' ').includes(scoped),
  'Policy ist nicht auf eine konkrete Rolle eingeschränkt: ' + scoped);

{
  // Nur ausführbares SQL prüfen: die Kopfkommentare benennen den alten
  // TO-PUBLIC-Zustand absichtlich und dürfen die Prüfung nicht auslösen.
  const executable = migration
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/revoke all on table[^;]*from public/gi, '');
  assert.ok(!/to public/i.test(executable),
    'eine Policy zielt wieder auf PUBLIC — genau das machte den INSERT-Pfad für anon erreichbar');
}

// with check (true) erlaubte das Umhängen einer eigenen Zeile auf einen
// fremden Mandanten; der Check muss dieselbe Bedingung tragen wie using.
{
  const flat = migration.replace(/\s+/g, ' ');
  assert.ok(/notifications_update[\s\S]{0,400}with check \(customer_id = public\.current_customer_id\(\)\)/.test(flat),
    'notifications_update hat keinen mandantengebundenen with-check');
}

// ── 3. Grants: anon/authenticated verlieren den Schreibpfad ────────────────
for (const revoke of [
  'revoke all on table public.notifications from public',
  'revoke all on table public.notifications from anon',
  'revoke all on table public.notifications from authenticated'
]) assert.ok(migration.includes(revoke), 'fehlender Revoke: ' + revoke);

assert.ok(migration.includes('grant select on table public.notifications to authenticated'),
  'der Browser verliert den Lesepfad auf die eigenen Benachrichtigungen');
assert.ok(migration.includes('grant update (read_at) on table public.notifications to authenticated'),
  'die Spalten-Allowlist für den Browser fehlt (nur read_at wird tatsächlich geschrieben)');
assert.ok(!/grant update on table public\.notifications to authenticated/.test(migration),
  'tabellenweites UPDATE für authenticated wieder vergeben — die Allowlist ist damit wirkungslos');
assert.ok(!/grant[^;]*insert[^;]*to (anon|authenticated)/i.test(migration),
  'INSERT wird wieder an anon/authenticated vergeben');
assert.ok(/grant select, insert, update, delete on table public\.notifications to service_role/.test(migration),
  'der Server-Insert-Pfad (elevenlabs-post-call.js) verliert seine Rechte');

// ── 4. Verifikations-SQL bleibt read only ──────────────────────────────────
for (const [name, sql] of [[PREFLIGHT, preflight], [POSTFLIGHT, postflight]]) {
  assert.ok(!/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/i.test(
    sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
      // Spaltennamen/Prädikatstexte dürfen die Wörter enthalten
      .replace(/'[^']*'/g, "''")
      .replace(/privilege_type|column_privileges|has_table_privilege|has_column_privilege|insert_policy|_update\b|updated_at|notifications_update|notifications_service_insert/gi, '')
  ), name + ' ist nicht mehr read only');
}
assert.ok(postflight.includes("case when passed then 'PASS' else 'FAIL' end"),
  'die Post-Migration-Prüfung meldet kein PASS/FAIL');

// Die Prüfungen, die den gemeldeten Bug bzw. das Injection-Loch abdecken,
// müssen namentlich vorhanden sein — sonst kann die Datei grün sein, ohne den
// eigentlichen Fall zu prüfen.
for (const check of [
  'notifications_select resolves tenant via current_customer_id()',
  'notifications_select no longer reads public.customers directly',
  'no notifications policy applies to PUBLIC',
  'anon INSERT on notifications denied',
  'authenticated INSERT on notifications denied',
  'notifications authenticated column UPDATE allowlist is read_at only',
  'service_role INSERT on notifications still allowed'
]) assert.ok(postflight.includes(check), 'Post-Migration-Prüfung fehlt: ' + check);

// ── 5. Dashboard: Start am Auth-Zustand, nicht am Timer ────────────────────
assert.ok(!/setTimeout\(function\(\) \{\s*vxNotifInit\(\)[\s\S]{0,120}\}, 2000\)/.test(dashboard),
  'vxNotifInit hängt wieder an einem blinden 2-Sekunden-Timer');
assert.ok(dashboard.includes('async function vxNotifInit()'), 'vxNotifInit fehlt');
{
  const start = dashboard.indexOf('async function vxNotifInit()');
  const body = dashboard.slice(start, start + 900);
  assert.ok(/auth\.getSession\(\)/.test(body),
    'vxNotifInit prüft die Session nicht, bevor es die Notifications lädt');
  assert.ok(/if \(!session\) return;/.test(body),
    'vxNotifInit lädt auch ohne Session weiter — genau das erzeugte den 401');
}
assert.ok(dashboard.includes('sb.auth.onAuthStateChange(function(event, session){'),
  'der Notifications-Start ist nicht an den Auth-Zustand gekoppelt — ein späterer Login ' +
  'würde die Glocke bis zum Reload leer lassen');
assert.ok(dashboard.includes('function vxNotifReset()'),
  'kein Reset beim Abmelden — Benachrichtigungen des Vorgängers blieben im Cache');
assert.ok(dashboard.includes('function vxNotifAuthClient()'),
  'seiteneffektfreier Auth-Client-Zugriff fehlt (getSupabaseAuthClient blendet sonst ' +
  'den System-nicht-verfuegbar-Zustand ein)');

// Inline-Scripts müssen parsebar bleiben.
{
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(dashboard))) {
    n++;
    const line = dashboard.slice(0, m.index).split('\n').length;
    new vm.Script(m[1], { filename: `${INDEX} inline#${n}@L${line}` });
  }
  assert.ok(n > 0, 'keine Inline-Scripts gefunden');
}

console.log('Notifications RLS hardening verification passed.');
