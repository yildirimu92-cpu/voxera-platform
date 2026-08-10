-- Customer/User provisioning hardening
-- Ziel: auth.users.id -> public.users.id -> public.users.customer_id -> public.customers.id

create or replace function public.ensure_user_profile(
  p_customer_id text default null,
  -- Deprecated: retained only for RPC signature compatibility (no-op).
  p_dashboard_id text default null,
  p_email text default null
)
returns public.users
language plpgsql
security definer
set search_path = public
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

  v_customer_hint := nullif(trim(coalesce(p_customer_id, v_meta->>'customer_id', '')), '');
  -- Hardening: p_dashboard_id and auth metadata dashboard_id are intentionally ignored.
  -- Productive tenant mapping must only happen through users.customer_id -> customers.id.
  perform nullif(trim(coalesce(p_dashboard_id, '')), '');

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

revoke all on function public.ensure_user_profile(text, text, text) from public;
grant execute on function public.ensure_user_profile(text, text, text) to authenticated;

create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_ensure_public_user on auth.users;

create trigger on_auth_user_created_ensure_public_user
after insert on auth.users
for each row
execute function public.handle_auth_user_created();

-- Backfill already existing auth users without public.users row
insert into public.users (id)
select au.id
from auth.users au
left join public.users pu on pu.id = au.id
where pu.id is null;
