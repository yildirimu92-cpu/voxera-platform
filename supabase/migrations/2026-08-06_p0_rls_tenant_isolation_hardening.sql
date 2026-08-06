-- P0 RLS tenant isolation hardening.
-- Addresses P0-1, P0-2 and P0-5 from SECURITY_BESTANDSAUFNAHME_2026-08-06.md.
-- Baseline: codex/restore-customer-launch-checks@a4e45bf2bcbd86d3b1a17ff43ff183a7b5f9e62b
--
-- RLS policies and table GRANTs are independent controls. Service-role server
-- operations do not justify permissive browser policies. Run
-- supabase/verification/p0_rls_tenant_isolation_preflight.sql first and save
-- its output as rollback evidence.

begin;

-- ---------------------------------------------------------------------------
-- P0-1: public.users.customer_id must not be self-service writable.
--
-- Repository-wide check found no legitimate browser write path to
-- public.users: the dashboard only ever SELECTs its own row. Tenant binding
-- is performed exclusively by the SECURITY DEFINER function
-- public.ensure_user_profile(text,text,text), which already ignores
-- caller-supplied parameters and binds only via a unique
-- customers.auth_user_id match (2026-07-28_p0_security_foundation.sql).
--
-- The previous users_self_update policy restricted rows (id = auth.uid())
-- but not columns, so an authenticated customer could set their own
-- customer_id to an arbitrary value and read/write any other tenant through
-- every policy that keys off current_customer_id(). Revoking UPDATE removes
-- that path for customer_id, role and is_admin together; no narrower
-- column grant is re-issued because no legitimate use was found.
-- ---------------------------------------------------------------------------
do $p0$
begin
  if to_regclass('public.users') is not null then
    execute 'drop policy if exists users_self_update on public.users';
    execute 'revoke update on table public.users from authenticated';
    execute 'revoke update on table public.users from anon';
  end if;
end
$p0$;

-- ---------------------------------------------------------------------------
-- P0-5: column-scoped UPDATE on public.customers and public.calls.
--
-- The existing customers_customer_update_own / calls_customer_update_own
-- policies (2026-04-12_customer_dashboard_entitlement_decouple_billing.sql)
-- correctly restrict rows to the caller's own tenant, but never restricted
-- columns, so a browser client holding the anon key could write any column
-- on its own row -- including ai_instructions, ai_fallback_escalation,
-- ai_response_constraints and status on customers, and duration_seconds,
-- transcript, call_summary on calls.
--
-- The column allowlists below were taken from every direct
-- `.from('customers').update(...)` / `.from('calls').update(...)` call site
-- found in customer-dashboard/index.html, not inferred:
--   customers: contact_first_name, in_app_notification_settings, updated_at
--   calls:     read_at, notes_customer_voxera, dashboard_status, updated_at
--
-- Row-level policies are unchanged; this migration only narrows which
-- columns the existing row-level grant applies to.
-- ---------------------------------------------------------------------------
do $p0$
begin
  if to_regclass('public.customers') is not null then
    execute 'revoke update on table public.customers from authenticated';
    execute 'grant update (contact_first_name, in_app_notification_settings, updated_at) on table public.customers to authenticated';
  end if;
end
$p0$;

do $p0$
begin
  if to_regclass('public.calls') is not null then
    execute 'revoke update on table public.calls from authenticated';
    execute 'grant update (read_at, notes_customer_voxera, dashboard_status, updated_at) on table public.calls to authenticated';
  end if;
end
$p0$;

-- ---------------------------------------------------------------------------
-- P0-2: RLS for contracts, subscriptions, invoices, offers, customer_addons.
--
-- None of these tables had RLS enabled or a GRANT restriction in any
-- migration in this repository. Supabase's default table privileges leave
-- anon/authenticated with broad access on newly created public tables, so
-- every contract, subscription, invoice and offer across every tenant was
-- readable through the anon key.
--
-- Scope decision: customer policies below grant SELECT of the caller's own
-- rows only (ownership, matching "Kunden duerfen nur eigene Datensaetze
-- lesen"). They deliberately do NOT gate on is_customer_entitled() the way
-- customers/calls/cases/onboarding do -- whether a customer with a lapsed
-- contract should still see historical invoices/contracts is a product
-- decision, not part of this security fix, and is left to a follow-up.
-- Admins retain full access via is_admin(auth.uid()); service_role is
-- untouched and continues to bypass RLS for every existing Netlify Function.
-- ---------------------------------------------------------------------------

-- contracts
do $p0$
begin
  if to_regclass('public.contracts') is not null then
    execute 'alter table public.contracts enable row level security';

    execute 'revoke all on table public.contracts from public';
    execute 'revoke all on table public.contracts from anon';
    execute 'revoke all on table public.contracts from authenticated';
    execute 'grant select on table public.contracts to authenticated';

    execute 'drop policy if exists contracts_admin_all on public.contracts';
    execute 'create policy contracts_admin_all on public.contracts for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))';

    execute 'drop policy if exists contracts_customer_select_own on public.contracts';
    execute 'create policy contracts_customer_select_own on public.contracts for select to authenticated using (customer_id = public.current_customer_id())';
  end if;
end
$p0$;

-- subscriptions
do $p0$
begin
  if to_regclass('public.subscriptions') is not null then
    execute 'alter table public.subscriptions enable row level security';

    execute 'revoke all on table public.subscriptions from public';
    execute 'revoke all on table public.subscriptions from anon';
    execute 'revoke all on table public.subscriptions from authenticated';
    execute 'grant select on table public.subscriptions to authenticated';

    execute 'drop policy if exists subscriptions_admin_all on public.subscriptions';
    execute 'create policy subscriptions_admin_all on public.subscriptions for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))';

    execute 'drop policy if exists subscriptions_customer_select_own on public.subscriptions';
    execute 'create policy subscriptions_customer_select_own on public.subscriptions for select to authenticated using (customer_id = public.current_customer_id())';
  end if;
end
$p0$;

-- offers
do $p0$
begin
  if to_regclass('public.offers') is not null then
    execute 'alter table public.offers enable row level security';

    execute 'revoke all on table public.offers from public';
    execute 'revoke all on table public.offers from anon';
    execute 'revoke all on table public.offers from authenticated';
    execute 'grant select on table public.offers to authenticated';

    execute 'drop policy if exists offers_admin_all on public.offers';
    execute 'create policy offers_admin_all on public.offers for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))';

    -- offers.customer_id is nullable (unlinked prospect offers before
    -- offer-link-customer.js runs); the equality predicate is false/null for
    -- those rows, so they stay invisible to every customer, which is correct.
    execute 'drop policy if exists offers_customer_select_own on public.offers';
    execute 'create policy offers_customer_select_own on public.offers for select to authenticated using (customer_id = public.current_customer_id())';
  end if;
end
$p0$;

-- invoices
-- admin-panel/index.html:12838 performs a direct authClient.from('invoices')
-- .update({status, updated_at}) after mail-dispatch succeeds, using the
-- admin's own authenticated session (not service-role). UPDATE is granted
-- table-wide to authenticated so that path keeps working; the
-- invoices_admin_all policy is the actual gate -- customers receive no
-- UPDATE policy on invoices, so the grant alone does not let them write.
do $p0$
begin
  if to_regclass('public.invoices') is not null then
    execute 'alter table public.invoices enable row level security';

    execute 'revoke all on table public.invoices from public';
    execute 'revoke all on table public.invoices from anon';
    execute 'revoke all on table public.invoices from authenticated';
    execute 'grant select, update on table public.invoices to authenticated';

    execute 'drop policy if exists invoices_admin_all on public.invoices';
    execute 'create policy invoices_admin_all on public.invoices for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))';

    execute 'drop policy if exists invoices_customer_select_own on public.invoices';
    execute 'create policy invoices_customer_select_own on public.invoices for select to authenticated using (customer_id = public.current_customer_id())';
  end if;
end
$p0$;

-- customer_addons
-- Repository schema declares customer_addons.customer_id as uuid while
-- customers.id (and current_customer_id()) is text. The explicit ::text
-- cast below makes the policy correct regardless of which type is actually
-- live; see preflight query (6) for the live FK/type check. The underlying
-- schema mismatch is a separate, non-security follow-up.
do $p0$
begin
  if to_regclass('public.customer_addons') is not null then
    execute 'alter table public.customer_addons enable row level security';

    execute 'revoke all on table public.customer_addons from public';
    execute 'revoke all on table public.customer_addons from anon';
    execute 'revoke all on table public.customer_addons from authenticated';
    execute 'grant select on table public.customer_addons to authenticated';

    execute 'drop policy if exists customer_addons_admin_all on public.customer_addons';
    execute 'create policy customer_addons_admin_all on public.customer_addons for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))';

    execute 'drop policy if exists customer_addons_customer_select_own on public.customer_addons';
    execute 'create policy customer_addons_customer_select_own on public.customer_addons for select to authenticated using (customer_id::text = public.current_customer_id())';
  end if;
end
$p0$;

commit;
