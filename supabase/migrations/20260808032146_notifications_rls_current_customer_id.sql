-- Notifications: tenant resolution via public.current_customer_id() + grant
-- hardening on public.notifications.
--
-- Two independent problems on the same table, fixed together because the fix
-- for one rewrites the policies the other lives in.
--
-- 1) Broken read path (the reported symptom).
--    notifications_select resolved the tenant with a raw subquery against
--    public.customers and ran as the *calling* role -- it is not a SECURITY
--    DEFINER path. anon holds no SELECT on public.customers, so every read
--    attempt without an established session failed with
--    "permission denied for table customers" (HTTP 401 on
--    /rest/v1/notifications) instead of returning an empty set.
--    2026-08-06_p0_rls_tenant_isolation_hardening.sql converted contracts,
--    subscriptions, offers, invoices and customer_addons to
--    `customer_id = public.current_customer_id()` -- a SECURITY DEFINER
--    helper that needs no direct grant on customers -- but did not cover
--    notifications. This migration completes that conversion.
--
--    Equivalence was verified against live data before the rewrite, not
--    assumed: for the only tenant with customers.auth_user_id set, both the
--    old predicate (customers.auth_user_id = auth.uid()) and the new one
--    (users.customer_id via current_customer_id()) resolve to the same
--    customer id and select exactly the same 9 of 21 notification rows.
--    The policy's second, legacy branch (auth.uid()::text = customers.id) is
--    dead: no customers.id is a uuid, they are all `cust_*` strings.
--
--    Dependency this makes explicit: public.users.customer_id must be
--    populated, which public.ensure_user_profile(text,text,text) does at
--    login. That is the same dependency contracts/invoices/offers already
--    carry since 2026-08-06 -- a customer for whom it fails cannot read
--    those either, so notifications gains no new failure mode.
--
-- 2) Anonymous notification injection (found while auditing the above).
--    notifications_service_insert was `FOR INSERT TO PUBLIC WITH CHECK
--    (true)` and anon still held the INSERT grant, so any holder of the
--    publishable anon key -- public by design in a browser app -- could
--    POST /rest/v1/notifications and write arbitrary rows for any
--    customer_id, with attacker-controlled title/sub rendered directly into
--    that customer's notification bell.
--    2026-07-28_p0_security_foundation.sql already revokes INSERT from anon
--    on this table, so the grant was re-issued afterwards; revoking it again
--    alone would not hold. The policy is therefore also narrowed to
--    service_role, so grant and policy have to both regress before the hole
--    reopens.
--
-- Writers, taken from the call sites rather than inferred:
--   browser  (customer-dashboard/index.html): UPDATE read_at only, at
--            :10490, :10500 and :10536 -- no INSERT, no DELETE.
--   server   (customer-dashboard/netlify/functions/elevenlabs-post-call.js):
--            INSERT via the service-role client.
--
-- Run supabase/verification/notifications_rls_preflight.sql first and keep
-- its output as rollback evidence;
-- supabase/verification/notifications_rls_post_migration.sql must report
-- zero FAIL rows afterwards.

begin;

do $notif$
begin
  if to_regclass('public.notifications') is null then
    return;
  end if;

  -- The whole migration keys off this helper. If it is missing the P0
  -- foundation did not run, and silently creating policies that always deny
  -- would lock every customer out of their own notifications.
  if to_regprocedure('public.current_customer_id()') is null then
    raise exception using
      errcode = 'P0001',
      message = 'notifications RLS migration aborted: public.current_customer_id() is required (2026-07-28_p0_security_foundation.sql)';
  end if;

  execute 'alter table public.notifications enable row level security';

  -- ---------------------------------------------------------------------
  -- Policies. Each is scoped to a concrete role instead of PUBLIC: all
  -- three previous policies were TO PUBLIC, which is what let the INSERT
  -- policy apply to anon in the first place.
  -- ---------------------------------------------------------------------
  execute 'drop policy if exists notifications_select on public.notifications';
  execute 'create policy notifications_select on public.notifications '
       || 'for select to authenticated '
       || 'using (customer_id = public.current_customer_id())';

  -- with check mirrors using: the old policy had `with check (true)`, which
  -- let a caller who passed the row test rewrite customer_id and hand their
  -- own notification to a different tenant.
  execute 'drop policy if exists notifications_update on public.notifications';
  execute 'create policy notifications_update on public.notifications '
       || 'for update to authenticated '
       || 'using (customer_id = public.current_customer_id()) '
       || 'with check (customer_id = public.current_customer_id())';

  -- service_role has rolbypassrls, so this policy is not consulted today.
  -- It is recreated scoped to service_role anyway: if bypassrls is ever
  -- dropped, the server insert keeps working and the policy still cannot be
  -- reached by anon or authenticated.
  execute 'drop policy if exists notifications_service_insert on public.notifications';
  execute 'create policy notifications_service_insert on public.notifications '
       || 'for insert to service_role with check (true)';

  -- ---------------------------------------------------------------------
  -- Grants. Policies and grants are independent controls -- the injection
  -- hole needed both a permissive policy and a live INSERT grant.
  -- ---------------------------------------------------------------------
  execute 'revoke all on table public.notifications from public';
  execute 'revoke all on table public.notifications from anon';
  execute 'revoke all on table public.notifications from authenticated';

  -- Browser: read own rows, and mark them read. Nothing else.
  execute 'grant select on table public.notifications to authenticated';
  execute 'grant update (read_at) on table public.notifications to authenticated';

  execute 'grant select, insert, update, delete on table public.notifications to service_role';
end
$notif$;

commit;
