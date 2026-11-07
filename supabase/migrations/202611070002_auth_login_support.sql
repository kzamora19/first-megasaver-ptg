-- Username-based login support for the PTG migration.
-- These RPCs are callable only with the Supabase server secret/service_role.
-- No browser role receives EXECUTE. The private login mapping remains unexposed.

create or replace function public.resolve_ptg_login_identity(
  p_username text,
  p_branch_code text default null
)
returns table (
  auth_user_id uuid,
  auth_email text,
  account_scope text,
  username text,
  role_key text,
  display_name text,
  is_active boolean,
  failed_login_attempts integer,
  locked_until timestamptz,
  session_version bigint,
  branch_id uuid,
  branch_code text,
  branch_name text,
  branch_status text,
  operational_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    li.auth_user_id,
    li.auth_email,
    li.account_scope,
    li.username,
    up.role_key,
    up.display_name,
    up.is_active,
    up.failed_login_attempts,
    up.locked_until,
    up.session_version,
    up.branch_id,
    b.branch_code,
    b.branch_name,
    b.status,
    b.operational_status
  from private.login_identities li
  join public.user_profiles up on up.id = li.auth_user_id
  left join public.branches b on b.id = up.branch_id
  where li.normalized_username = upper(trim(p_username))
    and (
      (li.account_scope = 'SYSTEM' and p_branch_code is null)
      or
      (li.account_scope = 'BRANCH'
        and (p_branch_code is null or b.branch_code = upper(trim(p_branch_code))))
    )
  order by li.account_scope, b.branch_code
$$;

create or replace function public.record_ptg_login_failure(p_user_id uuid)
returns table (failed_login_attempts integer, locked_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_locked_until timestamptz;
begin
  update public.user_profiles as p
     set failed_login_attempts = case
           when locked_until is not null and locked_until <= now() then 1
           else failed_login_attempts + 1
         end,
         locked_until = case
           when (case
             when locked_until is not null and locked_until <= now() then 1
             else failed_login_attempts + 1
           end) >= 5 then now() + interval '15 minutes'
           when locked_until is not null and locked_until > now() then locked_until
           else null
         end,
         updated_at = now()
   where p.id = p_user_id
   returning p.failed_login_attempts, p.locked_until
        into v_attempts, v_locked_until;

  return query select v_attempts, v_locked_until;
end;
$$;

create or replace function public.clear_ptg_login_failures(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.user_profiles as p
     set failed_login_attempts = 0,
         locked_until = null,
         updated_at = now()
   where p.id = p_user_id
$;

revoke all on function public.resolve_ptg_login_identity(text,text) from public, anon, authenticated;
revoke all on function public.record_ptg_login_failure(uuid) from public, anon, authenticated;
revoke all on function public.clear_ptg_login_failures(uuid) from public, anon, authenticated;
grant execute on function public.resolve_ptg_login_identity(text,text) to service_role;
grant execute on function public.record_ptg_login_failure(uuid) to service_role;
grant execute on function public.clear_ptg_login_failures(uuid) to service_role;
