-- Migration: RLS access hardening for admin/customer browser access
-- Date: 2026-04-06

create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.admins a
    where a.id = p_user_id
      and lower(coalesce(a.role, '')) in ('super-admin', 'admin', 'support')
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated, service_role;

create or replace function public.current_customer_id()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select u.customer_id
  from public.users u
  where u.id = auth.uid()
  limit 1
$$;

revoke all on function public.current_customer_id() from public;
grant execute on function public.current_customer_id() to authenticated, service_role;

-- customers
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customers') THEN
    EXECUTE 'alter table public.customers enable row level security';

    EXECUTE 'drop policy if exists customers_admin_select_all on public.customers';
    EXECUTE 'create policy customers_admin_select_all on public.customers for select to authenticated using (public.is_admin(auth.uid()))';

    EXECUTE 'drop policy if exists customers_customer_select_own on public.customers';
    EXECUTE 'create policy customers_customer_select_own on public.customers for select to authenticated using (id = public.current_customer_id())';

    EXECUTE 'drop policy if exists customers_customer_update_own on public.customers';
    EXECUTE $$create policy customers_customer_update_own on public.customers
      for update to authenticated
      using (id = public.current_customer_id())
      with check (id = public.current_customer_id())$$;
  END IF;
END
$$;

-- users
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users') THEN
    EXECUTE 'alter table public.users enable row level security';

    EXECUTE 'drop policy if exists users_admin_select_all on public.users';
    EXECUTE 'create policy users_admin_select_all on public.users for select to authenticated using (public.is_admin(auth.uid()))';

    EXECUTE 'drop policy if exists users_self_select on public.users';
    EXECUTE 'create policy users_self_select on public.users for select to authenticated using (id = auth.uid())';

    EXECUTE 'drop policy if exists users_self_update on public.users';
    EXECUTE 'create policy users_self_update on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid())';
  END IF;
END
$$;

-- calls
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='calls') THEN
    EXECUTE 'alter table public.calls enable row level security';

    EXECUTE 'drop policy if exists calls_admin_select_all on public.calls';
    EXECUTE 'create policy calls_admin_select_all on public.calls for select to authenticated using (public.is_admin(auth.uid()))';

    EXECUTE 'drop policy if exists calls_customer_select_own on public.calls';
    EXECUTE 'create policy calls_customer_select_own on public.calls for select to authenticated using (customer_id = public.current_customer_id())';

    EXECUTE 'drop policy if exists calls_customer_update_own on public.calls';
    EXECUTE 'create policy calls_customer_update_own on public.calls for update to authenticated using (customer_id = public.current_customer_id()) with check (customer_id = public.current_customer_id())';
  END IF;
END
$$;

-- onboarding
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='onboarding') THEN
    EXECUTE 'alter table public.onboarding enable row level security';

    EXECUTE 'drop policy if exists onboarding_admin_select_all on public.onboarding';
    EXECUTE 'create policy onboarding_admin_select_all on public.onboarding for select to authenticated using (public.is_admin(auth.uid()))';

    EXECUTE 'drop policy if exists onboarding_customer_select_own on public.onboarding';
    EXECUTE 'create policy onboarding_customer_select_own on public.onboarding for select to authenticated using (customer_id = public.current_customer_id())';
  END IF;
END
$$;

-- cases
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cases') THEN
    EXECUTE 'alter table public.cases enable row level security';

    EXECUTE 'drop policy if exists cases_admin_select_all on public.cases';
    EXECUTE 'create policy cases_admin_select_all on public.cases for select to authenticated using (public.is_admin(auth.uid()))';

    EXECUTE 'drop policy if exists cases_customer_select_own on public.cases';
    EXECUTE 'create policy cases_customer_select_own on public.cases for select to authenticated using (customer_id = public.current_customer_id())';
  END IF;
END
$$;

-- admins
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='admins') THEN
    EXECUTE 'alter table public.admins enable row level security';

    EXECUTE 'drop policy if exists admins_admin_select_all on public.admins';
    EXECUTE 'create policy admins_admin_select_all on public.admins for select to authenticated using (public.is_admin(auth.uid()))';

    EXECUTE 'drop policy if exists admins_self_select on public.admins';
    EXECUTE 'create policy admins_self_select on public.admins for select to authenticated using (id = auth.uid())';
  END IF;
END
$$;
