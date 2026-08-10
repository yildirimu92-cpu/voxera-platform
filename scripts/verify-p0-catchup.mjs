#!/usr/bin/env node
/**
 * Verifiziert den P0-Nachzug (2026-08-08_p0_security_foundation_catchup.sql).
 *
 * Der wichtigste Prüfpunkt ist nicht "die Migration tut etwas", sondern die
 * eine Stelle, an der sie bewusst von P0 abweicht: is_admin(uuid) darf KEINEN
 * DEFAULT bekommen. P0 deklariert `default auth.uid()`; zusammen mit dem
 * bestehenden argumentlosen is_admin() macht das jeden argumentlosen Aufruf
 * mehrdeutig ("function ... is not unique") -- und an dem hängen 62 aktive
 * RLS-Policies. Ein wörtlicher Nachzug hätte die alle auf einmal ausgehebelt.
 *
 * Statisch, ohne DB-Zugriff. Die Laufzeitprüfung macht
 * supabase/verification/p0_catchup_post_migration.sql.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const MIGRATION = 'supabase/migrations/20260808040253_p0_security_foundation_catchup.sql';
const P0 = 'supabase/migrations/2026-07-28_p0_security_foundation.sql';
const PREFLIGHT = 'supabase/verification/p0_catchup_preflight.sql';
const POSTFLIGHT = 'supabase/verification/p0_catchup_post_migration.sql';

const migration = fs.readFileSync(MIGRATION, 'utf8');
const p0 = fs.readFileSync(P0, 'utf8');
const preflight = fs.readFileSync(PREFLIGHT, 'utf8');
const postflight = fs.readFileSync(POSTFLIGHT, 'utf8');

const executable = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const flat = (sql) => executable(sql).replace(/\s+/g, ' ');
const mig = flat(migration);

// ── 1. Transaktion + Lockout-Schutz ────────────────────────────────────────
assert.match(migration, /begin;[\s\S]*commit;/, 'Migration ist nicht in eine Transaktion geklammert');
assert.ok(/raise exception[\s\S]{0,300}kein Admin wuerde die neue/.test(migration),
  'kein Lockout-Schutz: die Migration muss abbrechen, wenn nach der Verschaerfung kein Admin mehr durchkaeme');
assert.ok(/from public\.admins[\s\S]{0,400}join auth\.users/.test(migration),
  'der Lockout-Schutz prueft nicht gegen auth.users -- eine admins-Zeile ohne Auth-User zaehlt nicht');

// ── 2. DIE Abweichung: kein DEFAULT auf is_admin(uuid) ─────────────────────
assert.ok(mig.includes('create or replace function public.is_admin(p_user_id uuid) returns boolean'),
  'is_admin(uuid) wird nicht ohne DEFAULT deklariert');
assert.ok(!/is_admin\(p_user_id uuid default/i.test(mig),
  'is_admin(uuid) bekommt wieder ein DEFAULT — damit wird jeder argumentlose Aufruf mehrdeutig ' +
  'und die 62 davon abhaengigen RLS-Policies fallen aus');
// P0 hat das DEFAULT — die Abweichung muss dokumentiert sein, sonst wirkt sie wie ein Fehler.
assert.ok(/is_admin\(\s*p_user_id uuid default auth\.uid\(\)/i.test(flat(p0)),
  'P0 deklariert kein DEFAULT mehr — die Begruendung im Kopfkommentar stimmt dann nicht mehr');
assert.ok(/is not unique/.test(migration),
  'die Abweichung von P0 ist nicht mit dem konkreten Fehlerbild begruendet');

// ── 3. is_admin() bleibt erhalten und wird zum Weiterleiter ────────────────
assert.ok(mig.includes('create or replace function public.is_admin() returns boolean'),
  'is_admin() wird nicht per create or replace gesetzt — nur so bleibt die OID und damit die 62 Policies erhalten');
assert.ok(!/drop function[^;]*is_admin\s*\(\s*\)/i.test(executable(migration)),
  'is_admin() wird entfernt — daran haengen 62 RLS-Policies');
assert.ok(/is_admin_noarg\$ select public\.is_admin\(auth\.uid\(\)\)/.test(mig),
  'is_admin() leitet nicht auf is_admin(auth.uid()) weiter');

// ── 4. Rolle UND Status in allen drei Autorisierungsfunktionen ─────────────
for (const fn of ['is_admin_uuid', 'is_super_admin']) {
  const body = new RegExp('\\$' + fn + '\\$([\\s\\S]*?)\\$' + fn + '\\$').exec(migration);
  assert.ok(body, 'Funktionsrumpf nicht gefunden: ' + fn);
  assert.ok(/a\.role/.test(body[1]), fn + ' prueft die Rolle nicht');
  assert.ok(/a\.status/.test(body[1]), fn + ' prueft den Status nicht — ein deaktivierter Admin kaeme durch');
  assert.ok(/replace\(/.test(body[1]), fn + ' normalisiert nicht (super_admin vs super-admin)');
}

// ── 5. search_path auf allen SECURITY-DEFINER-Funktionen ───────────────────
{
  const definers = mig.match(/create or replace function public\.\w+\([^)]*\)[^$]*?security definer[^$]*?(?=as \$)/g) || [];
  assert.ok(definers.length >= 7, 'zu wenige SECURITY-DEFINER-Funktionen gefunden: ' + definers.length);
  for (const d of definers) {
    assert.ok(/set search_path = pg_catalog/.test(d),
      'SECURITY-DEFINER-Funktion ohne gepinnten search_path: ' + d.slice(0, 90));
  }
}
// coalesce ist ein SQL-Konstrukt und laesst sich nicht schema-qualifizieren.
assert.ok(!/pg_catalog\.coalesce\(/.test(migration),
  'pg_catalog.coalesce() existiert nicht — die Migration wuerde beim Anwenden scheitern');

// ── 6. Rechte: anon raus, authenticated nur wo noetig ──────────────────────
for (const fn of ['public.delete_auth_user_data(uuid)', 'public.next_credit_note_number_v1()',
                  'public.next_customer_code(integer)', 'public.cleanup_old_notifications()']) {
  assert.ok(mig.includes("('" + fn + "')"),
    'Funktion fehlt in der Nur-service_role-Liste: ' + fn);
}
for (const fn of ['public.is_admin()', 'public.is_admin(uuid)', 'public.current_customer_id()',
                  'public.ensure_user_profile(text,text,text)']) {
  assert.ok(mig.includes("('" + fn + "')"),
    'Funktion fehlt in der authenticated-Liste: ' + fn);
}
assert.ok(/revoke all privileges on function %s from anon/.test(migration),
  'anon wird nicht entrechtet');
assert.ok(!/grant execute on function %s to anon/.test(migration),
  'anon bekommt wieder EXECUTE');

// ── 7. Tabellen ────────────────────────────────────────────────────────────
assert.ok(/revoke insert on table public\.calls from authenticated/.test(migration),
  'calls: authenticated behaelt INSERT');
assert.ok(/grant insert on table public\.calls to service_role/.test(migration),
  'calls: der Server verliert seinen Schreibpfad');
assert.ok(!/revoke select on table public\.calls/.test(migration),
  'calls: SELECT wird zurueckgenommen — das Dashboard liest diese Tabelle');
assert.ok(/create policy system_config_admin_select[\s\S]{0,160}is_admin\(auth\.uid\(\)\)/.test(mig),
  'system_config bekommt keine admin-gebundene Lese-Policy');
assert.ok(/revoke select on table public\.system_config from anon/.test(migration),
  'system_config: anon behaelt SELECT');

// ── 8. Bereits erledigte Schritte werden nicht erneut angefasst ────────────
for (const tbl of ['public.notifications', 'public.ai_change_requests']) {
  assert.ok(!new RegExp('create policy[^;]*on ' + tbl.replace('.', '\\.')).test(mig),
    'die Migration fasst ' + tbl + ' erneut an — das ist bereits in einer eigenen Migration erledigt');
}

// ── 9. Verifikations-SQL ───────────────────────────────────────────────────
assert.ok(postflight.includes("case when passed then 'PASS' else 'FAIL' end"),
  'die Post-Migration-Pruefung meldet kein PASS/FAIL');
for (const check of [
  'is_admin(uuid) hat KEINEN DEFAULT',
  'argumentloser Aufruf is_admin() ist eindeutig aufloesbar',
  'abhaengige Policies weiterhin vorhanden',
  'mindestens ein Admin besteht die neue Pruefung',
  'calls: authenticated INSERT zurueckgenommen',
  'system_config: anon SELECT zurueckgenommen',
  'ensure_user_profile(text,text) bleibt entfernt'
]) assert.ok(postflight.includes(check), 'Post-Migration-Pruefung fehlt: ' + check);
assert.ok(preflight.includes('bestuende_neue_pruefung'),
  'der Preflight zeigt nicht, wer die neue Pruefung bestehen wuerde');
assert.ok(preflight.includes('nutzen is_admin() ohne Argument'),
  'der Preflight haelt die Zahl der abhaengigen Policies nicht fest');

console.log('P0 catch-up verification passed.');
