-- Server-only helper to read the canonical login name for an authenticated user.
create or replace function public.get_ptg_login_username(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select li.username
  from private.login_identities li
  where li.auth_user_id = p_user_id
  limit 1
$$;

revoke all on function public.get_ptg_login_username(uuid) from public, anon, authenticated;
grant execute on function public.get_ptg_login_username(uuid) to service_role;
