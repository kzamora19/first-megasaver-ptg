-- Email-based account invitation lifecycle.
alter table public.user_profiles
  add column if not exists email text,
  add column if not exists invitation_status text not null default 'ACTIVATED'
    check (invitation_status in ('PENDING','SENT','ACCEPTED','ACTIVATED','EXPIRED')),
  add column if not exists invited_at timestamptz,
  add column if not exists invitation_expires_at timestamptz,
  add column if not exists invitation_accepted_at timestamptz,
  add column if not exists activated_at timestamptz;
create unique index if not exists user_profiles_email_unique
  on public.user_profiles (lower(email)) where email is not null;

create table if not exists private.account_invitations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table private.account_invitations enable row level security;
revoke all on private.account_invitations from public,anon,authenticated,service_role;
grant all on private.account_invitations to service_role;

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
 insert into public.user_profiles(id,display_name,role_key,legacy_role,branch_id,is_active,must_change_password,invitation_status)
 values(p_user_id,p_display_name,p_role_key,upper(trim(coalesce(p_legacy_role,''))),p_branch_id,false,true,'PENDING');
 insert into private.login_identities(auth_user_id,username,normalized_username,account_scope,branch_id,auth_email)
 values(p_user_id,p_username,upper(trim(p_username)),case when p_role_key='SYSTEM_ADMIN' then 'SYSTEM' else 'BRANCH' end,p_branch_id,p_auth_email);
end;
$$;
revoke all on function public.provision_ptg_user_profile(uuid,text,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.provision_ptg_user_profile(uuid,text,text,text,text,uuid,text) to service_role;
