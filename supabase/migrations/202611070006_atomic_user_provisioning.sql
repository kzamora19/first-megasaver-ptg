create or replace function public.provision_ptg_user_profile(
  p_user_id uuid,
  p_username text,
  p_display_name text,
  p_role_key text,
  p_legacy_role text,
  p_branch_id uuid,
  p_auth_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_role_key not in ('SYSTEM_ADMIN','SYSTEM_VIEWER','BRANCH_ADMIN','BRANCH_USER') then
    raise exception 'Invalid role.';
  end if;
  if (p_role_key in ('BRANCH_ADMIN','BRANCH_USER')) <> (p_branch_id is not null) then
    raise exception 'Branch assignment does not match role.';
  end if;
  insert into public.user_profiles
    (id,display_name,role_key,legacy_role,branch_id,is_active,must_change_password)
  values
    (p_user_id,p_display_name,p_role_key,p_legacy_role,p_branch_id,true,true);

  insert into private.login_identities
    (auth_user_id,username,normalized_username,account_scope,branch_id,auth_email)
  values
    (p_user_id,p_username,upper(trim(p_username)),
     case when p_role_key in ('SYSTEM_ADMIN','SYSTEM_VIEWER') then 'SYSTEM' else 'BRANCH' end,
     p_branch_id,p_auth_email);
end;
$$;

revoke all on function public.provision_ptg_user_profile(uuid,text,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.provision_ptg_user_profile(uuid,text,text,text,text,uuid,text) to service_role;
