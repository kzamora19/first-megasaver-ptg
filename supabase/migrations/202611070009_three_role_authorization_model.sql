-- Consolidate PTG authorization to SYSTEM_ADMIN, BRANCH_ADMIN, and BRANCH_USER.
-- Legacy employee titles remain descriptive metadata in user_profiles.legacy_role.
alter table public.user_profiles drop constraint if exists user_profiles_check;
alter table public.user_profiles drop constraint if exists user_profiles_role_key_check;
alter table public.user_profiles add constraint user_profiles_role_key_check
  check (role_key in ('SYSTEM_ADMIN','BRANCH_ADMIN','BRANCH_USER'));
alter table public.user_profiles add constraint user_profiles_check
  check ((role_key='SYSTEM_ADMIN' and branch_id is null)
    or (role_key in ('BRANCH_ADMIN','BRANCH_USER') and branch_id is not null));

delete from public.role_permissions where role_key='SYSTEM_VIEWER';
alter table public.role_permissions drop constraint if exists role_permissions_role_key_check;
alter table public.role_permissions add constraint role_permissions_role_key_check
  check (role_key in ('SYSTEM_ADMIN','BRANCH_ADMIN','BRANCH_USER'));

create or replace function private.can_read_branch(target_branch_id uuid) returns boolean
language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.user_profiles p
 where p.id=(select auth.uid()) and p.is_active=true
 and (p.role_key='SYSTEM_ADMIN' or
 (p.role_key in ('BRANCH_ADMIN','BRANCH_USER') and p.branch_id=target_branch_id)))
$$;

drop policy if exists audit_read_scoped on public.security_audit_logs;
create policy audit_read_scoped on public.security_audit_logs for select to authenticated
using (private.is_system_admin() or
(private.current_role_key()='BRANCH_ADMIN' and branch_id=(select private.current_branch_id())));

drop policy if exists system_controls_read on public.system_controls;
create policy system_controls_read on public.system_controls for select to authenticated
using (private.current_role_key()='SYSTEM_ADMIN');

create or replace function public.provision_ptg_user_profile(
 p_user_id uuid,p_username text,p_display_name text,p_role_key text,
 p_legacy_role text,p_branch_id uuid,p_auth_email text
) returns void language plpgsql security definer set search_path=''
as $$
begin
 if p_role_key not in ('SYSTEM_ADMIN','BRANCH_ADMIN','BRANCH_USER') then raise exception 'Invalid role.'; end if;
 if (p_role_key in ('BRANCH_ADMIN','BRANCH_USER')) <> (p_branch_id is not null) then raise exception 'Branch assignment does not match role.'; end if;
 if p_role_key='BRANCH_ADMIN' and upper(trim(coalesce(p_legacy_role,''))) not in ('BRANCH ADMIN','BRANCH MANAGER') then raise exception 'Invalid Branch Admin title.'; end if;
 if p_role_key='BRANCH_USER' and upper(trim(coalesce(p_legacy_role,''))) not in ('BRANCH USER','TEAM LEADER') then raise exception 'Invalid Branch User title.'; end if;
 if p_role_key='SYSTEM_ADMIN' and coalesce(trim(p_legacy_role),'')<>'' then raise exception 'System Admin legacy title must be blank.'; end if;
 insert into public.user_profiles(id,display_name,role_key,legacy_role,branch_id,is_active,must_change_password)
 values(p_user_id,p_display_name,p_role_key,upper(trim(coalesce(p_legacy_role,''))),p_branch_id,true,true);
 insert into private.login_identities(auth_user_id,username,normalized_username,account_scope,branch_id,auth_email)
 values(p_user_id,p_username,upper(trim(p_username)),case when p_role_key='SYSTEM_ADMIN' then 'SYSTEM' else 'BRANCH' end,p_branch_id,p_auth_email);
end;
$$;
revoke all on function public.provision_ptg_user_profile(uuid,text,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.provision_ptg_user_profile(uuid,text,text,text,text,uuid,text) to service_role;
