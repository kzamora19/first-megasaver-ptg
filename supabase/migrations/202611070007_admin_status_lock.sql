-- Serialize account-status changes so two concurrent requests cannot disable
-- the final two active System Admins at the same time.
create or replace function public.set_ptg_user_status(p_user_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_role text; v_active_admins integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ptg-system-admin-status', 0));
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
