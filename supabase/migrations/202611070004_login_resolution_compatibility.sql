-- Preserve legacy universal-login resolution order:
-- 1) a SYSTEM identity wins when present;
-- 2) otherwise resolve only active branch accounts;
-- 3) an explicit branch code can disambiguate a branch username.
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
  with normalized as (
    select upper(trim(p_username)) as username,
           nullif(upper(trim(p_branch_code)), '') as branch_code
  ),
  system_identity as (
    select li.auth_user_id, li.auth_email, li.account_scope, li.username,
           up.role_key, up.display_name, up.is_active,
           up.failed_login_attempts, up.locked_until, up.session_version,
           up.branch_id, b.branch_code, b.branch_name, b.status, b.operational_status
      from private.login_identities li
      join public.user_profiles up on up.id = li.auth_user_id
      left join public.branches b on b.id = up.branch_id
      cross join normalized n
     where li.account_scope = 'SYSTEM'
       and li.normalized_username = n.username
       and n.branch_code is null
  ),
  branch_identities as (
    select li.auth_user_id, li.auth_email, li.account_scope, li.username,
           up.role_key, up.display_name, up.is_active,
           up.failed_login_attempts, up.locked_until, up.session_version,
           up.branch_id, b.branch_code, b.branch_name, b.status, b.operational_status
      from private.login_identities li
      join public.user_profiles up on up.id = li.auth_user_id
      join public.branches b on b.id = up.branch_id
      cross join normalized n
     where li.account_scope = 'BRANCH'
       and li.normalized_username = n.username
       and (n.branch_code is null or b.branch_code = n.branch_code)
       and (n.branch_code is not null or up.is_active = true)
       and not exists (select 1 from system_identity)
  )
  select * from system_identity
  union all
  select * from branch_identities
$$;

revoke all on function public.resolve_ptg_login_identity(text,text) from public, anon, authenticated;
grant execute on function public.resolve_ptg_login_identity(text,text) to service_role;
