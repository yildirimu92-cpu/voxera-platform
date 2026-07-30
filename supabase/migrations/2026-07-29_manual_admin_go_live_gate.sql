begin;

alter table public.customers
  add column if not exists go_live_approved_at timestamptz,
  add column if not exists go_live_approved_by uuid references auth.users(id) on delete set null,
  add column if not exists go_live_approval_note text,
  add column if not exists go_live_checks jsonb not null default '{}'::jsonb,
  add column if not exists live_at timestamptz;

create table if not exists public.customer_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null references public.customers(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text,
  note text,
  checks jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customer_lifecycle_events_customer_created_idx
  on public.customer_lifecycle_events (customer_id, created_at desc);

alter table public.customer_lifecycle_events enable row level security;
revoke all privileges on table public.customer_lifecycle_events from public;
revoke all privileges on table public.customer_lifecycle_events from anon;
revoke all privileges on table public.customer_lifecycle_events from authenticated;
grant all privileges on table public.customer_lifecycle_events to service_role;

drop trigger if exists trg_customer_auto_live_after_test_call on public.calls;
drop function if exists public.fn_customer_auto_live_after_test_call();

create or replace function public.admin_approve_customer_go_live(
  p_customer_id text,
  p_actor_user_id uuid,
  p_actor_role text,
  p_note text default null,
  p_checks jsonb default '{}'::jsonb
)
returns public.customers
language plpgsql
security definer
set search_path = pg_catalog
as $admin_approve_customer_go_live$
declare
  v_customer public.customers%rowtype;
  v_updated public.customers%rowtype;
  v_onboarding public.onboarding%rowtype;
  v_from_status text;
  v_now timestamptz := pg_catalog.now();
  v_actor_role text := pg_catalog.lower(pg_catalog.replace(pg_catalog.coalesce(p_actor_role, ''), '_', '-'));
begin
  if p_actor_user_id is null or v_actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'Go-live approval requires owner or admin';
  end if;

  select c.*
    into v_customer
    from public.customers as c
   where c.id = p_customer_id
   for update;

  if v_customer.id is null then
    raise exception using errcode = 'P0002', message = 'Customer not found';
  end if;

  if pg_catalog.lower(pg_catalog.coalesce(v_customer.status, 'onboarding')) in ('live', 'paused', 'deleted') then
    raise exception using errcode = 'P0001', message = 'Customer cannot be approved in the current lifecycle status';
  end if;

  select o.*
    into v_onboarding
    from public.onboarding as o
   where o.customer_id = p_customer_id
   for update;

  if v_onboarding.id is null then
    raise exception using errcode = 'P0001', message = 'Onboarding record is required';
  end if;

  v_from_status := pg_catalog.coalesce(v_customer.status, 'onboarding');

  update public.customers as c
     set go_live_approved_at = v_now,
         go_live_approved_by = p_actor_user_id,
         go_live_approval_note = pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_note, '')), ''),
         go_live_checks = pg_catalog.coalesce(p_checks, '{}'::jsonb),
         status = case
           when pg_catalog.lower(pg_catalog.coalesce(c.status, 'onboarding')) in ('onboarding', 'ready')
             then 'ready'
           else c.status
         end,
         updated_at = v_now
   where c.id = p_customer_id
  returning c.* into v_updated;

  update public.onboarding as o
     set status = 'ready',
         progress = pg_catalog.greatest(pg_catalog.coalesce(o.progress, 0), 100),
         next_step = 'Admin-Freigabe erteilt – Kundenzugang senden',
         blocker = null,
         updated_at = v_now
   where o.customer_id = p_customer_id;

  insert into public.customer_lifecycle_events (
    customer_id, event_type, from_status, to_status,
    actor_user_id, actor_role, note, checks, metadata
  )
  values (
    p_customer_id, 'go_live_approved', v_from_status, v_updated.status,
    p_actor_user_id, v_actor_role,
    pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_note, '')), ''),
    pg_catalog.coalesce(p_checks, '{}'::jsonb),
    pg_catalog.jsonb_build_object('source', 'admin_portal')
  );

  return v_updated;
end;
$admin_approve_customer_go_live$;

revoke all privileges on function public.admin_approve_customer_go_live(text, uuid, text, text, jsonb) from public;
revoke all privileges on function public.admin_approve_customer_go_live(text, uuid, text, text, jsonb) from anon;
revoke all privileges on function public.admin_approve_customer_go_live(text, uuid, text, text, jsonb) from authenticated;
grant execute on function public.admin_approve_customer_go_live(text, uuid, text, text, jsonb) to service_role;

create or replace function public.admin_activate_customer_go_live(
  p_customer_id text,
  p_actor_user_id uuid,
  p_actor_role text,
  p_note text default null
)
returns public.customers
language plpgsql
security definer
set search_path = pg_catalog
as $admin_activate_customer_go_live$
declare
  v_customer public.customers%rowtype;
  v_updated public.customers%rowtype;
  v_from_status text;
  v_now timestamptz := pg_catalog.now();
  v_actor_role text := pg_catalog.lower(pg_catalog.replace(pg_catalog.coalesce(p_actor_role, ''), '_', '-'));
begin
  if p_actor_user_id is null or v_actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'Go-live activation requires owner or admin';
  end if;

  select c.*
    into v_customer
    from public.customers as c
   where c.id = p_customer_id
   for update;

  if v_customer.id is null then
    raise exception using errcode = 'P0002', message = 'Customer not found';
  end if;

  if pg_catalog.lower(pg_catalog.coalesce(v_customer.status, '')) = 'live' then
    return v_customer;
  end if;

  if v_customer.go_live_approved_at is null or v_customer.go_live_approved_by is null then
    raise exception using errcode = 'P0001', message = 'Documented admin approval is required';
  end if;

  if pg_catalog.lower(pg_catalog.coalesce(v_customer.status, '')) not in ('activated', 'paused') then
    raise exception using errcode = 'P0001', message = 'Customer access must be activated before go-live';
  end if;

  v_from_status := v_customer.status;

  update public.customers as c
     set status = 'live',
         live_at = pg_catalog.coalesce(c.live_at, v_now),
         activated_at = pg_catalog.coalesce(c.activated_at, v_now),
         updated_at = v_now
   where c.id = p_customer_id
  returning c.* into v_updated;

  update public.onboarding as o
     set status = 'completed',
         progress = 100,
         next_step = 'Live',
         blocker = null,
         updated_at = v_now
   where o.customer_id = p_customer_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'Onboarding record is required';
  end if;

  insert into public.customer_lifecycle_events (
    customer_id, event_type, from_status, to_status,
    actor_user_id, actor_role, note, checks, metadata
  )
  values (
    p_customer_id, 'customer_go_live', v_from_status, 'live',
    p_actor_user_id, v_actor_role,
    pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_note, '')), ''),
    pg_catalog.coalesce(v_customer.go_live_checks, '{}'::jsonb),
    pg_catalog.jsonb_build_object('source', 'admin_portal')
  );

  return v_updated;
end;
$admin_activate_customer_go_live$;

revoke all privileges on function public.admin_activate_customer_go_live(text, uuid, text, text) from public;
revoke all privileges on function public.admin_activate_customer_go_live(text, uuid, text, text) from anon;
revoke all privileges on function public.admin_activate_customer_go_live(text, uuid, text, text) from authenticated;
grant execute on function public.admin_activate_customer_go_live(text, uuid, text, text) to service_role;

commit;
