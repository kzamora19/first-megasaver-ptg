-- Account provisioning support. No users or production credentials are created here.
alter table public.user_profiles
  add column if not exists legacy_role text not null default '',
  add column if not exists must_change_password boolean not null default true;

-- Keep role permissions aligned with the four technical roles. TEAM LEADER is
-- retained as a legacy title on the profile and maps to BRANCH_USER permissions.
-- A Team Leader must never inherit Branch Admin permissions by title alone.

create or replace function public.bump_ptg_user_session_version(p_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_version bigint;
begin
  update public.user_profiles
     set session_version = session_version + 1,
         updated_at = now()
   where id = p_user_id
   returning session_version into v_version;

  update public.app_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoke_reason = case when revoked_at is null then 'ADMIN_FORCE_LOGOUT' else revoke_reason end
   where user_id = p_user_id and revoked_at is null;

  return v_version;
end;
$$;

revoke all on function public.bump_ptg_user_session_version(uuid) from public, anon, authenticated;
grant execute on function public.bump_ptg_user_session_version(uuid) to service_role;

create or replace function public.set_ptg_user_status(p_user_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_role text; v_active_admins integer;
begin
  select role_key into v_role from public.user_profiles where id = p_user_id for update;
  if not found then return false; end if;

  if not p_enabled and v_role = 'SYSTEM_ADMIN' then
    select count(*) into v_active_admins
      from public.user_profiles
     where role_key = 'SYSTEM_ADMIN' and is_active = true and id <> p_user_id;
    if v_active_admins = 0 then
      raise exception 'The last active SYSTEM ADMIN cannot be disabled.';
    end if;
  end if;

  update public.user_profiles
     set is_active = p_enabled,
         failed_login_attempts = 0,
         locked_until = null,
         session_version = session_version + 1,
         updated_at = now()
   where id = p_user_id;

  update public.app_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoke_reason = case when revoked_at is null then
           case when p_enabled then 'ACCOUNT_REENABLED' else 'ACCOUNT_DISABLED' end
           else revoke_reason end
   where user_id = p_user_id and revoked_at is null;

  return true;
end;
$$;

revoke all on function public.set_ptg_user_status(uuid,boolean) from public, anon, authenticated;
grant execute on function public.set_ptg_user_status(uuid,boolean) to service_role;

create or replace function public.reset_ptg_user_password_state(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_profiles
     set failed_login_attempts = 0,
         locked_until = null,
         must_change_password = true,
         session_version = session_version + 1,
         updated_at = now()
   where id = p_user_id;

  if not found then return false; end if;

  update public.app_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoke_reason = case when revoked_at is null then 'PASSWORD_RESET' else revoke_reason end
   where user_id = p_user_id and revoked_at is null;

  return true;
end;
$$;

revoke all on function public.reset_ptg_user_password_state(uuid) from public, anon, authenticated;
grant execute on function public.reset_ptg_user_password_state(uuid) to service_role;
