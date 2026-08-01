begin;

create table if not exists public.customer_operational_updates (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null references public.customers(id) on delete cascade,
  type text not null check (type in ('closure','special_hours','absence','temporary_contact','appointment_pause','notice')),
  title text not null check (char_length(title) between 1 and 100),
  message text not null check (char_length(message) between 1 and 500),
  behavior text check (behavior is null or char_length(behavior) <= 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'published' check (status in ('published','cancelled')),
  created_by_user_id text,
  sync_status text not null default 'pending' check (sync_status in ('pending','success','failed')),
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_operational_updates_valid_window check (ends_at > starts_at),
  constraint customer_operational_updates_max_window check (ends_at <= starts_at + interval '370 days')
);

create index if not exists customer_operational_updates_customer_window_idx
  on public.customer_operational_updates(customer_id, starts_at, ends_at)
  where status = 'published';

alter table public.customer_operational_updates enable row level security;
revoke all on public.customer_operational_updates from anon, authenticated;

commit;
