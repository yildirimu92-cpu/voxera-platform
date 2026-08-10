-- Central entitlement gate for customer dashboard access.
-- Productive customer access is allowed only for paid customers
-- with an allowed lifecycle status.

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
      and lower(trim(coalesce(c.payment_status, 'none'))) = 'paid'
      and lower(trim(coalesce(c.status, 'onboarding'))) in ('onboarding', 'ready', 'invited', 'activated', 'live', 'active')
  );
$$;

revoke all on function public.is_customer_entitled(text) from public;
grant execute on function public.is_customer_entitled(text) to authenticated, service_role;

-- customers (customer self-access)
drop policy if exists customers_customer_select_own on public.customers;
create policy customers_customer_select_own on public.customers
  for select to authenticated
  using (
    id = public.current_customer_id()
    and public.is_customer_entitled(id)
  );

drop policy if exists customers_customer_update_own on public.customers;
create policy customers_customer_update_own on public.customers
  for update to authenticated
  using (
    id = public.current_customer_id()
    and public.is_customer_entitled(id)
  )
  with check (
    id = public.current_customer_id()
    and public.is_customer_entitled(id)
  );

-- calls (customer self-access)
drop policy if exists calls_customer_select_own on public.calls;
create policy calls_customer_select_own on public.calls
  for select to authenticated
  using (
    customer_id = public.current_customer_id()
    and public.is_customer_entitled(customer_id)
  );

drop policy if exists calls_customer_update_own on public.calls;
create policy calls_customer_update_own on public.calls
  for update to authenticated
  using (
    customer_id = public.current_customer_id()
    and public.is_customer_entitled(customer_id)
  )
  with check (
    customer_id = public.current_customer_id()
    and public.is_customer_entitled(customer_id)
  );

-- onboarding (customer self-read)
drop policy if exists onboarding_customer_select_own on public.onboarding;
create policy onboarding_customer_select_own on public.onboarding
  for select to authenticated
  using (
    customer_id = public.current_customer_id()
    and public.is_customer_entitled(customer_id)
  );

-- cases (customer self-read)
drop policy if exists cases_customer_select_own on public.cases;
create policy cases_customer_select_own on public.cases
  for select to authenticated
  using (
    customer_id = public.current_customer_id()
    and public.is_customer_entitled(customer_id)
  );
