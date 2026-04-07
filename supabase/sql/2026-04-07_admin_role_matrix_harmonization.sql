-- Launch blocker fix: harmonize canonical admin role matrix used by RLS.
-- Canonical admin roles:
--   super-admin, admin, support, owner, ops

create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.admins a
    where a.id = p_user_id
      and replace(lower(coalesce(a.role, '')), '_', '-') in ('super-admin', 'admin', 'support', 'owner', 'ops')
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated, service_role;
