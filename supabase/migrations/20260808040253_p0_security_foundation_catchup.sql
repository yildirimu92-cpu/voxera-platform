-- P0-Nachzug: bringt die Datenbank auf den Stand, den
-- 2026-07-28_p0_security_foundation.sql beschreibt.
--
-- WARUM ES DIESE MIGRATION GIBT
--   P0 ist transaktional (begin; Zeile 1, commit; Zeile 321) -- alles oder
--   nichts. Auf der Produktionsdatenbank ist nichts davon wirksam: keine der
--   sechs Policies, die P0 anlegt, existiert; keine seiner Grant-Rücknahmen
--   greift; und die Funktionsrümpfe weichen durchgängig ab (anderer
--   search_path, fehlende Status-Prüfung, E-Mail- statt auth_user_id-Bindung,
--   PUBLIC EXECUTE statt der vorgeschriebenen Revokes). `create or replace`
--   hätte all das überschrieben. P0 wurde also nie angewandt -- die gleich
--   benannten Funktionen stammen aus einem früheren Stand.
--
--   Diese Migration prüft deshalb konsequent den IST-Zustand und setzt, was
--   fehlt. Sie ist idempotent und kann gefahrlos mehrfach laufen.
--
--   Bereits erledigt und hier bewusst NICHT wiederholt:
--     * public.notifications  -> 2026-08-08_notifications_rls_current_customer_id.sql
--     * public.ai_change_requests -> 2026-08-08_ai_change_requests_tenant_isolation_reassert.sql
--     * public.ensure_user_profile(text,text) entfernt
--       -> 2026-08-08_drop_legacy_ensure_user_profile_overload.sql
--
-- ─────────────────────────────────────────────────────────────────────────
-- ABWEICHUNG VON P0, BEWUSST UND GEPRÜFT: kein DEFAULT auf is_admin(uuid)
--
--   P0 deklariert `is_admin(p_user_id uuid default auth.uid())`. Auf diesem
--   Stand existiert zusätzlich `is_admin()` ohne Argument -- und daran hängen
--   62 aktive RLS-Policies auf rund 20 Tabellen. Beide Signaturen zusammen
--   machen jeden argumentlosen Aufruf mehrdeutig; in pg_temp nachgestellt:
--
--     ERROR: 42725: function ... is not unique
--     HINT:  Could not choose a best candidate function.
--
--   Ein wörtlicher P0-Nachzug hätte damit sämtliche 62 Policies auf einen
--   Schlag unbrauchbar gemacht. P0 wurde erkennbar für einen Stand
--   geschrieben, auf dem is_admin() nicht existiert.
--
--   Stattdessen: is_admin(uuid) trägt die Logik, ohne DEFAULT. is_admin()
--   wird zum dünnen Weiterleiter auf is_admin(auth.uid()). Damit gibt es
--   genau eine Stelle für die Regel, die 62 Policies laufen unverändert
--   weiter, und beide Fassungen prüfen ab jetzt dasselbe.
--
-- ZUSÄTZLICH ZU P0, auf ausdrücklichen Wunsch:
--   is_admin() prüft künftig Rolle UND Status. Heute prüft es keines von
--   beidem -- die blosse Existenz einer admins-Zeile genügt. P0 härtet zwar
--   is_admin(uuid), rührt den Rumpf von is_admin() aber nicht an; diese
--   Lücke bliebe also auch nach einem wörtlichen Nachzug bestehen.
--
--   Ebenfalls zusätzlich: is_super_admin() vergleicht `role = 'super-admin'`
--   mit Bindestrich, gespeichert ist 'super_admin' mit Unterstrich. Die
--   Funktion liefert dadurch für den einzigen vorhandenen Admin false. Sie
--   normalisiert jetzt wie is_admin().
--
-- KEIN LOCKOUT-RISIKO -- vorab an Echtdaten geprüft:
--   Genau eine Zeile in public.admins (role='super_admin', status='active',
--   mit passender auth.users-Zeile). Sie besteht sowohl die Rollen- als auch
--   die Statusprüfung. Der Block unten bricht trotzdem ab, falls das zum
--   Anwendungszeitpunkt nicht mehr gilt -- lieber nicht anwenden als das
--   Admin-Panel aussperren.
--
-- Reihenfolge: supabase/verification/p0_catchup_preflight.sql vorher laufen
-- lassen und die Ausgabe als Rollback-Evidenz sichern; danach muss
-- p0_catchup_post_migration.sql null FAIL-Zeilen melden.

begin;

-- ─── 0. Lockout-Schutz ──────────────────────────────────────────────────
do $guard$
begin
  if to_regclass('public.admins') is null then
    return;
  end if;
  if not exists (
    select 1
    from public.admins a
    join auth.users au on au.id = a.id
    where pg_catalog.replace(pg_catalog.lower(coalesce(a.role, '')), '_', '-')
            in ('super-admin', 'admin', 'support', 'owner', 'ops')
      and pg_catalog.replace(pg_catalog.lower(coalesce(a.status, 'active')), '_', '-')
            in ('active', 'enabled')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'P0-Nachzug abgebrochen: kein Admin wuerde die neue Rollen-/Statuspruefung bestehen -- das Admin-Panel haette danach keinen Lesepfad mehr';
  end if;
end
$guard$;

-- ─── 1. Autorisierungsfunktionen ────────────────────────────────────────
-- Traegt die Regel. Kein DEFAULT (siehe Kopfkommentar).
create or replace function public.is_admin(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog
stable
as $is_admin_uuid$
  select auth.uid() is not null
    and p_user_id is not distinct from auth.uid()
    and exists (
      select 1
      from public.admins as a
      where a.id = p_user_id
        and pg_catalog.replace(pg_catalog.lower(coalesce(a.role, '')), '_', '-')
            in ('super-admin', 'admin', 'support', 'owner', 'ops')
        and pg_catalog.replace(pg_catalog.lower(coalesce(a.status, 'active')), '_', '-')
            in ('active', 'enabled')
    )
$is_admin_uuid$;

-- Weiterleiter. create or replace erhaelt die OID, die 62 abhaengigen
-- Policies bleiben dadurch unberuehrt.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = pg_catalog
stable
as $is_admin_noarg$
  select public.is_admin(auth.uid())
$is_admin_noarg$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
set search_path = pg_catalog
stable
as $is_super_admin$
  select auth.uid() is not null
    and exists (
      select 1
      from public.admins as a
      where a.id = auth.uid()
        and pg_catalog.replace(pg_catalog.lower(coalesce(a.role, '')), '_', '-')
            = 'super-admin'
        and pg_catalog.replace(pg_catalog.lower(coalesce(a.status, 'active')), '_', '-')
            in ('active', 'enabled')
    )
$is_super_admin$;

-- ─── 2. Mandanten- und Profilfunktionen (P0-Fassungen) ──────────────────
create or replace function public.current_customer_id()
returns text
language sql
security definer
set search_path = pg_catalog
stable
as $current_customer_id$
  select u.customer_id
  from public.users as u
  where u.id = auth.uid()
  limit 1
$current_customer_id$;

-- P0-Fassung: bindet ausschliesslich ueber customers.auth_user_id und
-- ignoriert die vom Aufrufer gelieferten Parameter. Die bisherige Fassung
-- band ueber einen E-Mail-Abgleich; die Parameter bleiben nur der Signatur
-- wegen erhalten, damit der bestehende Aufruf im Dashboard
-- (customer-dashboard/index.html) unveraendert funktioniert.
-- users.email wird dabei nicht mehr gefuellt -- geprueft: keine Stelle liest
-- diese Spalte, alle Zugriffe holen nur id/customer_id.
create or replace function public.ensure_user_profile(
  p_customer_id text default null,
  p_dashboard_id text default null,
  p_email text default null
)
returns public.users
language plpgsql
security definer
set search_path = pg_catalog
as $ensure_user_profile$
declare
  v_auth_user_id uuid := auth.uid();
  v_row public.users%rowtype;
  v_customer_ids text[];
begin
  if v_auth_user_id is null then
    raise exception 'ensure_user_profile requires authenticated user';
  end if;
  select u.*
  into v_row
  from public.users as u
  where u.id = v_auth_user_id;
  if v_row.id is null then
    insert into public.users (id)
    values (v_auth_user_id)
    on conflict (id) do nothing;
    select u.*
    into v_row
    from public.users as u
    where u.id = v_auth_user_id;
  end if;
  if v_row.customer_id is not null then
    return v_row;
  end if;
  select pg_catalog.array_agg(c.id order by c.id)
  into v_customer_ids
  from public.customers as c
  where c.auth_user_id = v_auth_user_id;
  if coalesce(pg_catalog.array_length(v_customer_ids, 1), 0) = 1 then
    update public.users as u
    set customer_id = v_customer_ids[1]
    where u.id = v_auth_user_id
      and u.customer_id is null
    returning u.* into v_row;
  elsif coalesce(pg_catalog.array_length(v_customer_ids, 1), 0) > 1 then
    raise exception using
      errcode = 'P0001',
      message = 'ensure_user_profile found ambiguous server-side customer binding';
  end if;
  return v_row;
end;
$ensure_user_profile$;

create or replace function public.delete_auth_user_data(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $delete_auth_user_data$
begin
  delete from auth.sessions where user_id = target_user_id;
  delete from auth.identities where user_id = target_user_id;
  delete from auth.users where id = target_user_id;
end;
$delete_auth_user_data$;

create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $handle_auth_user_created$
begin
  insert into public.users (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$handle_auth_user_created$;

-- ─── 3. Funktionsrechte ─────────────────────────────────────────────────
do $acl$
declare
  f record;
begin
  -- Nur service_role: keine dieser Funktionen gehoert an die Browser-Rollen.
  for f in
    select sig from (values
      ('public.delete_auth_user_data(uuid)'),
      ('public.handle_auth_user_created()'),
      ('public.cleanup_old_notifications()'),
      ('public.next_credit_note_number_v1()'),
      ('public.next_customer_code(integer)'),
      ('public.next_invoice_number_v1()'),
      ('public.next_offer_number_v1()')
    ) v(sig)
  loop
    if to_regprocedure(f.sig) is not null then
      execute pg_catalog.format('revoke all privileges on function %s from public', f.sig);
      execute pg_catalog.format('revoke all privileges on function %s from anon', f.sig);
      execute pg_catalog.format('revoke all privileges on function %s from authenticated', f.sig);
      execute pg_catalog.format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;

  -- Von authenticated benoetigt (RLS-Praedikate und Login-Pfad laufen als
  -- aufrufende Rolle), anon bleibt aussen vor.
  for f in
    select sig from (values
      ('public.is_admin()'),
      ('public.is_admin(uuid)'),
      ('public.is_super_admin()'),
      ('public.current_customer_id()'),
      ('public.ensure_user_profile(text,text,text)')
    ) v(sig)
  loop
    if to_regprocedure(f.sig) is not null then
      execute pg_catalog.format('revoke all privileges on function %s from public', f.sig);
      execute pg_catalog.format('revoke all privileges on function %s from anon', f.sig);
      execute pg_catalog.format('revoke all privileges on function %s from authenticated', f.sig);
      execute pg_catalog.format('grant execute on function %s to authenticated', f.sig);
      execute pg_catalog.format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;

  -- search_path auf Bestandsfunktionen nachziehen, die hier nicht neu
  -- geschrieben werden.
  if to_regprocedure('public.cleanup_old_notifications()') is not null then
    execute 'alter function public.cleanup_old_notifications() set search_path to pg_catalog, public';
  end if;
end
$acl$;

-- ─── 4. public.calls: Schreibpfad gehoert dem Server ────────────────────
do $calls$
begin
  if to_regclass('public.calls') is null then
    return;
  end if;
  execute 'revoke insert on table public.calls from public';
  execute 'revoke insert on table public.calls from anon';
  execute 'revoke insert on table public.calls from authenticated';
  execute 'grant insert on table public.calls to service_role';
end
$calls$;

-- ─── 5. public.system_config: nur Admins lesen ──────────────────────────
do $sysconf$
declare
  policy_row record;
begin
  if to_regclass('public.system_config') is null then
    return;
  end if;
  execute 'alter table public.system_config enable row level security';
  for policy_row in
    select p.polname
    from pg_catalog.pg_policy as p
    where p.polrelid = 'public.system_config'::regclass
      and p.polcmd in ('r', '*')
  loop
    execute pg_catalog.format('drop policy if exists %I on public.system_config', policy_row.polname);
  end loop;
  execute 'revoke select on table public.system_config from public';
  execute 'revoke select on table public.system_config from anon';
  execute 'revoke select on table public.system_config from authenticated';
  execute 'grant select on table public.system_config to authenticated';
  execute 'grant select on table public.system_config to service_role';
  execute 'create policy system_config_admin_select '
       || 'on public.system_config for select to authenticated '
       || 'using (public.is_admin(auth.uid()))';
end
$sysconf$;

commit;
