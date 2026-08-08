#!/usr/bin/env node
/**
 * Verifiziert die Wiederherstellung der mandantengebundenen RLS auf
 * public.ai_change_requests.
 *
 * Besonderheit gegenüber den anderen RLS-Verifiern: der Policy-Satz ist kein
 * Neuentwurf, sondern steht bereits in
 * 2026-07-28_p0_security_foundation.sql. Dieses Skript prüft deshalb nicht
 * nur, dass die neue Migration das Richtige tut, sondern auch, dass sie
 * denselben Satz setzt wie P0 — driften die beiden auseinander, hat man
 * wieder zwei konkurrierende Definitionen derselben Sache, und genau daraus
 * ist der Ausgangszustand entstanden.
 *
 * Statisch, ohne DB-Zugriff. Die Laufzeitprüfung macht
 * supabase/verification/ai_change_requests_tenant_isolation_post_migration.sql.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const MIGRATION = 'supabase/migrations/2026-08-08_ai_change_requests_tenant_isolation_reassert.sql';
const P0 = 'supabase/migrations/2026-07-28_p0_security_foundation.sql';
const PREFLIGHT = 'supabase/verification/ai_change_requests_tenant_isolation_preflight.sql';
const POSTFLIGHT = 'supabase/verification/ai_change_requests_tenant_isolation_post_migration.sql';

const migration = fs.readFileSync(MIGRATION, 'utf8');
const p0 = fs.readFileSync(P0, 'utf8');
const preflight = fs.readFileSync(PREFLIGHT, 'utf8');
const postflight = fs.readFileSync(POSTFLIGHT, 'utf8');

const executable = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const flat = (sql) => executable(sql).replace(/\s+/g, ' ');

const migrationSql = flat(migration);

// ── 1. Transaktion + Vorbedingungen ────────────────────────────────────────
assert.match(migration, /begin;[\s\S]*commit;/, 'Migration ist nicht in eine Transaktion geklammert');
for (const guard of ['current_customer_id() is required', 'is_admin(uuid) is required']) {
  assert.ok(migration.includes(guard),
    'Migration bricht nicht ab, wenn ein DEFINER-Helfer fehlt — sie würde sonst Policies ' +
    'anlegen, die Admin wie Kunde aussperren: ' + guard);
}

// ── 2. Der Policy-Satz stimmt mit P0 überein ───────────────────────────────
const POLICIES = [
  'ai_change_requests_admin_all',
  'ai_change_requests_customer_select_own',
  'ai_change_requests_customer_insert_own',
  'ai_change_requests_customer_update_own',
  'ai_change_requests_customer_delete_own'
];
for (const pol of POLICIES) {
  assert.ok(migrationSql.includes('create policy ' + pol),
    'Policy fehlt in der Migration: ' + pol);
  assert.ok(flat(p0).includes('create policy ' + pol),
    'Policy steht nicht (mehr) in P0 — die beiden Migrationen sind auseinandergelaufen: ' + pol);
}
{
  const created = migrationSql.match(/create policy ai_change_requests_\w+/g) || [];
  assert.equal(created.length, POLICIES.length,
    `Migration legt ${created.length} Policies an, P0 definiert ${POLICIES.length} — ` +
    'jede zusätzliche ist eine zweite, konkurrierende Definition');
}

// ── 3. Die Lücke selbst: keine Autorisierung über auth.role(), kein PUBLIC ──
assert.ok(!/auth\.role\(\)/.test(executable(migration)),
  'die Migration autorisiert wieder über auth.role() statt über die Mandanten-ID — das war die Lücke');
{
  const withoutRevokes = executable(migration).replace(/revoke all privileges on table[^;]*from public/gi, '');
  assert.ok(!/to public/i.test(withoutRevokes),
    'eine Policy zielt wieder auf PUBLIC');
}
for (const scoped of ['for all to authenticated', 'for select to authenticated', 'for insert to authenticated']) {
  assert.ok(migrationSql.includes(scoped), 'Policy ist nicht auf eine konkrete Rolle eingeschränkt: ' + scoped);
}

// Admin-Zweig über is_admin(), Kundenzweige über current_customer_id().
assert.ok(/create policy ai_change_requests_admin_all[^;]*using \(public\.is_admin\(auth\.uid\(\)\)\)/.test(migrationSql),
  'der Admin-Zweig hängt nicht an is_admin() — das Admin-Panel liest über eine authentifizierte Session');
for (const pol of POLICIES.filter((p) => p !== 'ai_change_requests_admin_all')) {
  const re = new RegExp('create policy ' + pol + '[^;]*current_customer_id\\(\\)');
  assert.ok(re.test(migrationSql), 'Kundenzweig ist nicht mandantengebunden: ' + pol);
}
// with check muss dieselbe Bedingung tragen wie using, sonst kann eine Zeile
// einem fremden Mandanten übergeben werden.
assert.ok(/create policy ai_change_requests_customer_update_own[^;]*using \(customer_id = public\.current_customer_id\(\)\)[^;]*with check \(customer_id = public\.current_customer_id\(\)\)/.test(migrationSql),
  'der Update-Zweig hat keinen mandantengebundenen with-check');

// ── 4. Altbestand wird entfernt, nicht ergänzt ─────────────────────────────
assert.ok(/for policy_row in[\s\S]*drop policy if exists %I on public\.ai_change_requests/.test(migration),
  'die Migration entfernt die vorhandenen Policies nicht — der Ist-Zustand weicht nachweislich ' +
  'von den Migrationsdateien ab, es darf nichts Unerwartetes stehen bleiben');

// ── 5. Grants ──────────────────────────────────────────────────────────────
for (const revoke of [
  'revoke all privileges on table public.ai_change_requests from public',
  'revoke all privileges on table public.ai_change_requests from anon',
  'revoke all privileges on table public.ai_change_requests from authenticated'
]) assert.ok(migration.includes(revoke), 'fehlender Revoke: ' + revoke);
assert.ok(!/grant[^;]*to anon/i.test(executable(migration)), 'anon bekommt wieder Rechte auf der Tabelle');
for (const grant of [
  'grant select, insert, update, delete on table public.ai_change_requests to authenticated',
  'grant select, insert, update, delete on table public.ai_change_requests to service_role'
]) assert.ok(migration.includes(grant), 'fehlender Grant: ' + grant);

// ── 6. Verifikations-SQL ───────────────────────────────────────────────────
for (const [name, sql] of [[PREFLIGHT, preflight], [POSTFLIGHT, postflight]]) {
  const body = executable(sql).replace(/'[^']*'/g, "''")
    .replace(/privilege|column_privileges|has_table_privilege|_update\w*|_insert\w*|_delete\w*|_select\w*|updated_at/gi, '');
  assert.ok(!/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\s+(into|table|policy|from|on|all)\b/i.test(body),
    name + ' ist nicht mehr read only');
}
assert.ok(postflight.includes("case when passed then 'PASS' else 'FAIL' end"),
  'die Post-Migration-Prüfung meldet kein PASS/FAIL');
for (const check of [
  'stale policy authenticated_read_all removed',
  'no policy authorises by auth.role() alone',
  'no ai_change_requests policy applies to PUBLIC',
  'admin policy present and scoped to is_admin()',
  'anon has no access to ai_change_requests',
  'at least one admin still satisfies is_admin()'
]) assert.ok(postflight.includes(check), 'Post-Migration-Prüfung fehlt: ' + check);

// Der Preflight muss den Admin-Pfad zeigen, bevor angewendet wird — ohne ihn
// merkt man einen fehlenden Admin erst, wenn das Panel schon leer ist.
assert.ok(preflight.includes('would_pass_is_admin'),
  'der Preflight prüft den Admin-Pfad nicht — ein Fehlschlag würde erst nach dem Anwenden auffallen');
assert.ok(preflight.includes('p0_drift'),
  'der Preflight zeigt den Umfang der Abweichung zu P0 nicht');

console.log('ai_change_requests tenant isolation verification passed.');
