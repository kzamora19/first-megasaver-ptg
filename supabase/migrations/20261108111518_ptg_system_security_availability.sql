create function public.ptg_lock_access_change() returns trigger
language plpgsql set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(19189, 2026);
  return null;
end;
$$;

create function public.ptg_check_session_availability() returns trigger
language plpgsql set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(19189, 2026);
  if exists (select 1 from public.user_profiles where id = new.user_id and role_key = 'SYSTEM_ADMIN') then
    return new;
  end if;
  if exists (select 1 from public.system_controls where control_key = 'MASTER_SYSTEM' and not enabled) then
    raise exception 'PTG_SYSTEM_OFF';
  end if;
  if exists (select 1 from public.system_controls where control_key = 'MAINTENANCE_MODE' and enabled) then
    raise exception 'PTG_MAINTENANCE';
  end if;
  if new.branch_id is not null and not exists (
    select 1 from public.branches where id = new.branch_id and status = 'ACTIVE' and operational_status = 'ON'
  ) then
    raise exception 'PTG_BRANCH_OFF';
  end if;
  return new;
end;
$$;

create function public.ptg_revoke_unavailable_sessions() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_table_name = 'system_controls' then
    if (new.control_key = 'MASTER_SYSTEM' and not new.enabled)
      or (new.control_key = 'MAINTENANCE_MODE' and new.enabled) then
      update public.app_sessions s
      set revoked_at = pg_catalog.clock_timestamp(), revoke_reason = new.control_key
      where s.revoked_at is null and s.expires_at > pg_catalog.now()
        and not exists (select 1 from public.user_profiles p where p.id = s.user_id and p.role_key = 'SYSTEM_ADMIN');
    end if;
  elsif new.status <> 'ACTIVE' or new.operational_status <> 'ON' then
    update public.app_sessions
    set revoked_at = pg_catalog.clock_timestamp(), revoke_reason = 'BRANCH_OFF'
    where branch_id = new.id and revoked_at is null and expires_at > pg_catalog.now();
  end if;
  return null;
end;
$$;

revoke execute on function public.ptg_lock_access_change() from public, anon, authenticated;
revoke execute on function public.ptg_check_session_availability() from public, anon, authenticated;
revoke execute on function public.ptg_revoke_unavailable_sessions() from public, anon, authenticated;

create trigger ptg_serialize_system_control
before insert or update on public.system_controls for each statement execute function public.ptg_lock_access_change();

create trigger ptg_serialize_branch_control
before update of status, operational_status on public.branches for each statement execute function public.ptg_lock_access_change();

create trigger ptg_check_session_availability
before insert on public.app_sessions for each row execute function public.ptg_check_session_availability();

create trigger ptg_revoke_unavailable_system_sessions
after insert or update of enabled on public.system_controls for each row execute function public.ptg_revoke_unavailable_sessions();

create trigger ptg_revoke_unavailable_branch_sessions
after update of status, operational_status on public.branches for each row execute function public.ptg_revoke_unavailable_sessions();
