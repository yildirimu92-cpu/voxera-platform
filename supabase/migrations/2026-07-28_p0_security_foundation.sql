-- Voxera P0 security foundation
-- Prepared from repository baseline main@682b88cbc16deb259f6f513de02b7bdc9fc255ab.
-- This migration is intentionally schema-drift-aware and does not modify product data.
-- Run the read-only preflight before applying this file.

begin;

-- ---------------------------------------------------------------------------
-- Canonical SECURITY DEFINER functions whose repository definitions are known.
-- ---------------------------------------------------------------------------

create or replace function public.delete_auth_user_data(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  delete from auth.sessions where user_id = target_user_id;
  delete from auth.identities where user_id = target_user_id;
  delete from auth.users where id = target_user_id;
end;
$$;

revoke all privileges on function public.delete_auth_user_data(uuid) from public;
revoke all privileges on function public.delete_auth_user_data(uuid) from anon;
revoke all privileges on function public.delete_auth_user_data(uuid) from authenticated;
revoke all privileges on function public.delete_auth_user_data(uuid) from service_role;
grant execute on function public.delete_auth_user_data(uuid) to service_role;

create or replace function public.ensure_user_profile(
  p_customer_id text default null,
  p_dashboard_id text default null,
  p_email text default null
)
returns public.users
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_row public.users%rowtype;
  v_meta jsonb := '{}'::jsonb;
  v_customer_hint text := null;
  v_resolved_customer_id text := null;
begin
  if v_auth_user_id is null then
    raise exception 'ensure_user_profile requires authenticated user';
  end if;

  select u.* into v_row
  from public.users u
  where u.id = v_auth_user_id;

  select au.raw_user_meta_data into v_meta
  from auth.users au
  where au.id = v_auth_user_id;

  v_customer_hint := nullif(pg_catalog.btrim(coalesce(p_customer_id, v_meta->>'customer_id', '')), '');
  perform nullif(pg_catalog.btrim(coalesce(p_dashboard_id, '')), '');
  perform nullif(pg_catalog.btrim(coalesce(p_email, '')), '');

  if v_customer_hint is not null then
    select c.id into v_resolved_customer_id
    from public.customers c
    where c.id = v_customer_hint
    limit 1;
  end if;

  if v_row.id is null then
    insert into public.users (id, customer_id)
    values (v_auth_user_id, v_resolved_customer_id)
    returning * into v_row;
  elsif v_row.customer_id is null and v_resolved_customer_id is not null then
    update public.users
    set customer_id = v_resolved_customer_id
    where id = v_auth_user_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all privileges on function public.ensure_user_profile(text, text, text) from public;
revoke all privileges on function public.ensure_user_profile(text, text, text) from anon;
revoke all privileges on function public.ensure_user_profile(text, text, text) from authenticated;
revoke all privileges on function public.ensure_user_profile(text, text, text) from service_role;
grant execute on function public.ensure_user_profile(text, text, text) to authenticated;
grant execute on function public.ensure_user_profile(text, text, text) to service_role;

create or replace function public.current_customer_id()
returns text
language sql
security definer
set search_path = pg_catalog
stable
as $$
  select u.customer_id
  from public.users u
  where u.id = auth.uid()
  limit 1
$$;

revoke all privileges on function public.current_customer_id() from public;
revoke all privileges on function public.current_customer_id() from anon;
revoke all privileges on function public.current_customer_id() from authenticated;
revoke all privileges on function public.current_customer_id() from service_role;
grant execute on function public.current_customer_id() to authenticated;
grant execute on function public.current_customer_id() to service_role;

create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = pg_catalog
stable
as $$
  select exists (
    select 1
    from public.admins a
    where a.id = p_user_id
      and pg_catalog.replace(pg_catalog.lower(coalesce(a.role, '')), '_', '-')
          in ('super-admin', 'admin', 'support', 'owner', 'ops')
      and pg_catalog.replace(pg_catalog.lower(coalesce(a.status, 'active')), '_', '-')
          in ('active', 'enabled')
  )
$$;

revoke all privileges on function public.is_admin(uuid) from public;
revoke all privileges on function public.is_admin(uuid) from anon;
revoke all privileges on function public.is_admin(uuid) from authenticated;
revoke all privileges on function public.is_admin(uuid) from service_role;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_admin(uuid) to service_role;

create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into public.users (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all privileges on function public.handle_auth_user_created() from public;
revoke all privileges on function public.handle_auth_user_created() from anon;
revoke all privileges on function public.handle_auth_user_created() from authenticated;
revoke all privileges on function public.handle_auth_user_created() from service_role;

-- ---------------------------------------------------------------------------
-- Legacy/optional SECURITY DEFINER functions. Existing bodies are preserved.
-- ---------------------------------------------------------------------------

do $p0$
begin
  if to_regprocedure('public.ensure_user_profile(text,text)') is not null then
    execute 'alter function public.ensure_user_profile(text,text) set search_path to pg_catalog, public, auth';
    execute 'revoke all privileges on function public.ensure_user_profile(text,text) from public';
    execute 'revoke all privileges on function public.ensure_user_profile(text,text) from anon';
    execute 'revoke all privileges on function public.ensure_user_profile(text,text) from authenticated';
    execute 'revoke all privileges on function public.ensure_user_profile(text,text) from service_role';
    execute 'grant execute on function public.ensure_user_profile(text,text) to service_role';
  end if;

  if to_regprocedure('public.is_admin()') is not null then
    execute 'alter function public.is_admin() set search_path to pg_catalog, public, auth';
    execute 'revoke all privileges on function public.is_admin() from public';
    execute 'revoke all privileges on function public.is_admin() from anon';
    execute 'revoke all privileges on function public.is_admin() from authenticated';
    execute 'revoke all privileges on function public.is_admin() from service_role';
    execute 'grant execute on function public.is_admin() to authenticated';
    execute 'grant execute on function public.is_admin() to service_role';
  end if;

  if to_regprocedure('public.is_super_admin()') is not null then
    execute 'alter function public.is_super_admin() set search_path to pg_catalog, public, auth';
    execute 'revoke all privileges on function public.is_super_admin() from public';
    execute 'revoke all privileges on function public.is_super_admin() from anon';
    execute 'revoke all privileges on function public.is_super_admin() from authenticated';
    execute 'revoke all privileges on function public.is_super_admin() from service_role';
    execute 'grant execute on function public.is_super_admin() to authenticated';
    execute 'grant execute on function public.is_super_admin() to service_role';
  end if;

  if to_regprocedure('public.cleanup_old_notifications()') is not null then
    execute 'alter function public.cleanup_old_notifications() set search_path to pg_catalog, public';
    execute 'revoke all privileges on function public.cleanup_old_notifications() from public';
    execute 'revoke all privileges on function public.cleanup_old_notifications() from anon';
    execute 'revoke all privileges on function public.cleanup_old_notifications() from authenticated';
    execute 'revoke all privileges on function public.cleanup_old_notifications() from service_role';
    execute 'grant execute on function public.cleanup_old_notifications() to service_role';
  end if;

  if to_regprocedure('public.next_customer_code(integer)') is not null then
    execute 'alter function public.next_customer_code(integer) set search_path to pg_catalog, public';
    execute 'revoke all privileges on function public.next_customer_code(integer) from public';
    execute 'revoke all privileges on function public.next_customer_code(integer) from anon';
    execute 'revoke all privileges on function public.next_customer_code(integer) from authenticated';
    execute 'revoke all privileges on function public.next_customer_code(integer) from service_role';
    execute 'grant execute on function public.next_customer_code(integer) to service_role';
  end if;
end
$p0$;

-- ---------------------------------------------------------------------------
-- calls: no browser/anonymous inserts. Repository callers use server-side keys.
-- ---------------------------------------------------------------------------

do $p0$
declare
  policy_row record;
begin
  if to_regclass('public.calls') is not null then
    alter table public.calls enable row level security;

    for policy_row in
      select p.polname
      from pg_catalog.pg_policy p
      where p.polrelid = 'public.calls'::regclass
        and p.polcmd in ('a', '*')
        and exists (
          select 1
          from pg_catalog.unnest(p.polroles) as assigned(role_oid)
          left join pg_catalog.pg_roles r on r.oid = assigned.role_oid
          where assigned.role_oid = 0 or r.rolname in ('anon', 'authenticated')
        )
    loop
      execute pg_catalog.format('drop policy if exists %I on public.calls', policy_row.polname);
    end loop;

    revoke insert on table public.calls from public;
    revoke insert on table public.calls from anon;
    revoke insert on table public.calls from authenticated;
    grant insert on table public.calls to service_role;
  end if;
end
$p0$;

-- ---------------------------------------------------------------------------
-- notifications: backend-only inserts until an explicit tenant-scoped action exists.
-- ---------------------------------------------------------------------------

do $p0$
declare
  policy_row record;
begin
  if to_regclass('public.notifications') is not null then
    alter table public.notifications enable row level security;

    for policy_row in
      select p.polname
      from pg_catalog.pg_policy p
      where p.polrelid = 'public.notifications'::regclass
        and p.polcmd in ('a', '*')
        and exists (
          select 1
          from pg_catalog.unnest(p.polroles) as assigned(role_oid)
          left join pg_catalog.pg_roles r on r.oid = assigned.role_oid
          where assigned.role_oid = 0 or r.rolname in ('anon', 'authenticated')
        )
    loop
      execute pg_catalog.format('drop policy if exists %I on public.notifications', policy_row.polname);
    end loop;

    revoke insert on table public.notifications from public;
    revoke insert on table public.notifications from anon;
    revoke insert on table public.notifications from authenticated;
    grant insert on table public.notifications to service_role;
  end if;
end
$p0$;

-- ---------------------------------------------------------------------------
-- ai_change_requests: canonical tenant isolation plus verified admin predicate.
-- ---------------------------------------------------------------------------

do $p0$
declare
  policy_row record;
begin
  if to_regclass('public.ai_change_requests') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'ai_change_requests' and column_name = 'customer_id'
    ) then
      raise exception 'P0 migration aborted: public.ai_change_requests.customer_id is required';
    end if;

    alter table public.ai_change_requests enable row level security;

    for policy_row in
      select p.polname
      from pg_catalog.pg_policy p
      where p.polrelid = 'public.ai_change_requests'::regclass
    loop
      execute pg_catalog.format('drop policy if exists %I on public.ai_change_requests', policy_row.polname);
    end loop;

    revoke all privileges on table public.ai_change_requests from public;
    revoke all privileges on table public.ai_change_requests from anon;
    revoke all privileges on table public.ai_change_requests from authenticated;
    grant select, insert, update, delete on table public.ai_change_requests to authenticated;
    grant select, insert, update, delete on table public.ai_change_requests to service_role;

    create policy ai_change_requests_admin_all
      on public.ai_change_requests
      for all
      to authenticated
      using (public.is_admin(auth.uid()))
      with check (public.is_admin(auth.uid()));

    create policy ai_change_requests_customer_select_own
      on public.ai_change_requests
      for select
      to authenticated
      using (customer_id = public.current_customer_id());

    create policy ai_change_requests_customer_insert_own
      on public.ai_change_requests
      for insert
      to authenticated
      with check (customer_id = public.current_customer_id());

    create policy ai_change_requests_customer_update_own
      on public.ai_change_requests
      for update
      to authenticated
      using (customer_id = public.current_customer_id())
      with check (customer_id = public.current_customer_id());

    create policy ai_change_requests_customer_delete_own
      on public.ai_change_requests
      for delete
      to authenticated
      using (customer_id = public.current_customer_id());
  end if;
end
$p0$;

-- ---------------------------------------------------------------------------
-- system_config: authenticated table access remains possible only for real admins.
-- The repository has no proven customer-browser dependency for prompt_master_l1.
-- ---------------------------------------------------------------------------

do $p0$
declare
  policy_row record;
begin
  if to_regclass('public.system_config') is not null then
    alter table public.system_config enable row level security;

    for policy_row in
      select p.polname
      from pg_catalog.pg_policy p
      where p.polrelid = 'public.system_config'::regclass
        and p.polcmd in ('r', '*')
    loop
      execute pg_catalog.format('drop policy if exists %I on public.system_config', policy_row.polname);
    end loop;

    revoke select on table public.system_config from public;
    revoke select on table public.system_config from anon;
    revoke select on table public.system_config from authenticated;
    grant select on table public.system_config to authenticated;
    grant select on table public.system_config to service_role;

    create policy system_config_admin_select
      on public.system_config
      for select
      to authenticated
      using (public.is_admin(auth.uid()));
  end if;
end
$p0$;

commit;
