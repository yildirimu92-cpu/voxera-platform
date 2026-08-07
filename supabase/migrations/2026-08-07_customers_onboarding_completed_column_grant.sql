-- Fix: customer-dashboard onboarding modal reappears after being dismissed.
--
-- Root cause (confirmed against this repo's own migrations, not inferred):
-- 2026-08-06_p0_rls_tenant_isolation_hardening.sql (P0-5) revoked table-wide
-- UPDATE on public.customers for the `authenticated` role and re-granted it
-- for exactly three columns only:
--   contact_first_name, in_app_notification_settings, updated_at
-- Its own post-migration verification script asserts this count explicitly
-- (supabase/verification/p0_rls_tenant_isolation_post_migration.sql, check
-- "customers authenticated column UPDATE allowlist matches exactly 3
-- columns"). That allowlist was built by grepping
-- `.from('customers').update(...)` call sites in customer-dashboard/index.html
-- -- it missed customer-dashboard/index.html's vxOnboardingMarkComplete(),
-- which does `.from('customers').update({ onboarding_completed: true })`
-- using the customer's own authenticated session (not service-role).
--
-- Effect: every onboarding-dismiss write from a real customer session has
-- been rejected by Postgres column privileges (42501 insufficient_privilege)
-- since 2026-08-06. The browser code never checked the Supabase response for
-- an `error` field (fixed separately in customer-dashboard/index.html), so
-- the rejection was silent -- the DB row stayed onboarding_completed=false
-- forever, and every subsequent poll cycle reopened the modal. A client-side
-- localStorage fallback was shipped as an immediate mitigation, but the
-- underlying DB write needs to actually succeed so the dismissal survives a
-- cache reset or a login from a different device/browser.
--
-- onboarding_completed also isn't declared in
-- supabase/sql/2026-04-08_core_tables_schema_sot.sql's customers baseline,
-- so this migration adds it defensively (IF NOT EXISTS -- a no-op if the
-- column already exists live, which customer-dashboard/index.html:17021
-- reading `f.onboarding_completed` implies it does).

begin;

do $fix$
begin
  if to_regclass('public.customers') is not null then
    execute 'alter table public.customers add column if not exists onboarding_completed boolean not null default false';
    execute 'grant update (onboarding_completed) on table public.customers to authenticated';
  end if;
end
$fix$;

commit;
