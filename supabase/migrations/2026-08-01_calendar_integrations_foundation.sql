begin;

create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null references public.customers(id) on delete cascade,
  provider text not null check (provider in ('google','microsoft')),
  provider_account_id text,
  account_email text,
  account_label text,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}'::text[],
  calendars jsonb not null default '[]'::jsonb,
  selected_calendar_id text,
  selected_calendar_name text,
  status text not null default 'connected' check (status in ('connected','reauthorization_required','error','disconnected')),
  last_error text,
  connected_by_user_id text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, provider)
);

create index if not exists calendar_connections_customer_idx
  on public.calendar_connections(customer_id);

create table if not exists public.calendar_settings (
  customer_id text primary key references public.customers(id) on delete cascade,
  active_provider text check (active_provider is null or active_provider in ('google','microsoft')),
  timezone text not null default 'Europe/Zurich',
  appointment_duration_minutes integer not null default 30 check (appointment_duration_minutes between 10 and 240),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 180),
  buffer_after_minutes integer not null default 10 check (buffer_after_minutes between 0 and 180),
  minimum_notice_minutes integer not null default 120 check (minimum_notice_minutes between 0 and 10080),
  booking_horizon_days integer not null default 60 check (booking_horizon_days between 1 and 365),
  business_hours jsonb not null default '{"mon":[["08:00","17:00"]],"tue":[["08:00","17:00"]],"wed":[["08:00","17:00"]],"thu":[["08:00","17:00"]],"fri":[["08:00","17:00"]],"sat":[],"sun":[]}'::jsonb,
  appointment_title_template text not null default 'Termin via Voxera',
  feature_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_oauth_states (
  state_hash text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  user_id text not null,
  provider text not null check (provider in ('google','microsoft')),
  return_origin text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists calendar_oauth_states_expiry_idx
  on public.calendar_oauth_states(expires_at);

create table if not exists public.calendar_booking_audit (
  id uuid primary key default gen_random_uuid(),
  request_id text,
  customer_id text not null references public.customers(id) on delete cascade,
  connection_id uuid references public.calendar_connections(id) on delete set null,
  provider text not null check (provider in ('google','microsoft')),
  action text not null check (action in ('availability','book','reschedule','cancel','connect','disconnect','verify')),
  actor_type text not null default 'system' check (actor_type in ('customer','assistant','admin','system')),
  external_event_id text,
  status text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists calendar_booking_audit_request_id_idx
  on public.calendar_booking_audit(customer_id, request_id)
  where request_id is not null;

alter table public.calendar_connections enable row level security;
alter table public.calendar_settings enable row level security;
alter table public.calendar_oauth_states enable row level security;
alter table public.calendar_booking_audit enable row level security;

revoke all on public.calendar_connections from anon, authenticated;
revoke all on public.calendar_settings from anon, authenticated;
revoke all on public.calendar_oauth_states from anon, authenticated;
revoke all on public.calendar_booking_audit from anon, authenticated;

commit;
