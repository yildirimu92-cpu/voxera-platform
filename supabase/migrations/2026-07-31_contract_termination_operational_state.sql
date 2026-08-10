begin;

alter table public.contracts
  add column if not exists termination_type text,
  add column if not exists termination_status text,
  add column if not exists termination_effective_at timestamptz,
  add column if not exists termination_reason text,
  add column if not exists terminated_at timestamptz,
  add column if not exists terminated_by uuid;

alter table public.customers
  add column if not exists operational_status text not null default 'active',
  add column if not exists operational_ended_at timestamptz,
  add column if not exists operational_end_reason text;

create index if not exists idx_contracts_termination_effective_at
  on public.contracts (termination_effective_at)
  where termination_status = 'scheduled';

create index if not exists idx_customers_operational_status
  on public.customers (operational_status);

update public.customers c
set operational_status = 'terminated',
    operational_ended_at = coalesce(c.operational_ended_at, now()),
    operational_end_reason = coalesce(c.operational_end_reason, 'legacy_cancelled_contract')
where not exists (
  select 1
  from public.contracts ct
  where ct.customer_id = c.id
    and lower(coalesce(ct.status, '')) in ('active','signed','pending','suspended')
)
and exists (
  select 1
  from public.contracts ct
  where ct.customer_id = c.id
    and lower(coalesce(ct.status, '')) = 'cancelled'
);

commit;
