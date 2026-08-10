-- Helper function to hard-delete auth users including dependent auth records.
-- Intended to be called by backend services (Netlify Function with service role key).
create or replace function public.delete_auth_user_data(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  delete from auth.sessions where user_id = target_user_id;
  delete from auth.identities where user_id = target_user_id;
  delete from auth.users where id = target_user_id;
end;
$$;

revoke all on function public.delete_auth_user_data(uuid) from public;
grant execute on function public.delete_auth_user_data(uuid) to service_role;
