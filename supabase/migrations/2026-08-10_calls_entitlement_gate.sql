-- Reinstates the customer-lifecycle entitlement gate on public.calls.
--
-- Context (PR #910 follow-up): is_customer_entitled() is referenced by the
-- P0 docs (docs/P0_RLS_TENANT_ISOLATION_2026-08-06.md) and defined in
-- supabase/sql/2026-04-12_customer_dashboard_entitlement_decouple_billing.sql,
-- but was never applied through a tracked migration. Verified live on
-- production (ulcofbgrovgcvowdjrge): the function does not exist, and none
-- of calls_select_admin/calls_select_own/calls_update_own reference it.
--
-- Live-tested (transaction + rollback, no permanent writes) before writing
-- this migration: with the entitlement check absent, customer_id =
-- current_customer_id() alone already enforces tenant isolation correctly
-- (a synthetic foreign customer's row was never visible to a simulated
-- customer session). So this is *not* a tenant-isolation fix -- it is a
-- lifecycle-access fix: without the gate, customers whose account has moved
-- to paused/suspended/churned/pending keep read/update access to their own
-- historical calls.
--
-- is_customer_entitled() checks lifecycle status only, deliberately
-- decoupled from payment/billing state (see the 2026-04-12 file above):
--   allowed:  onboarding, ready, invited, activated, live, active
--   excluded: paused, suspended, churned, pending
--
-- calls_select_admin (is_admin()) is intentionally left ungated -- admin
-- support access must not depend on the target customer's lifecycle status
-- (e.g. reviewing calls for a paused/suspended account). Only the two
-- customer-self-access policies get the gate.

begin;

create or replace function public.is_customer_entitled(p_customer_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.customers c
    where c.id = p_customer_id
      and lower(trim(coalesce(c.status, 'onboarding')))
          in ('onboarding', 'ready', 'invited', 'activated', 'live', 'active')
  );
$$;

revoke all on function public.is_customer_entitled(text) from public;
grant execute on function public.is_customer_entitled(text) to authenticated, service_role;

drop policy if exists calls_select_own on public.calls;
create policy calls_select_own on public.calls
  for select to authenticated
  using (
    customer_id = public.current_customer_id()
    and public.is_customer_entitled(customer_id)
  );

drop policy if exists calls_update_own on public.calls;
create policy calls_update_own on public.calls
  for update to authenticated
  using (
    customer_id = public.current_customer_id()
    and public.is_customer_entitled(customer_id)
  )
  with check (
    customer_id = public.current_customer_id()
    and public.is_customer_entitled(customer_id)
  );

commit;
