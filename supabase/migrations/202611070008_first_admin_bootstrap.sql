-- One-time first SYSTEM_ADMIN bootstrap, replacing Apps Script L1.
-- Bootstrap state is private; only trusted server code can issue/consume it.
create table private.first_admin_bootstrap (
  singleton boolean primary key default true check (singleton),
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table private.first_admin_bootstrap enable row level security;
revoke all on private.first_admin_bootstrap from public, anon, authenticated;

create or replace function public.issue_ptg_first_admin_bootstrap(p_code_hash text, p_expires_at timestamptz)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ptg-first-admin-bootstrap', 0));
  if exists (select 1 from public.user_profiles where role_key = 'SYSTEM_ADMIN') then
    delete from private.first_admin_bootstrap where singleton = true;
    return false;
  end if;
  if p_code_hash is null or length(p_code_hash) <> 64 or p_expires_at <= pg_catalog.now()
     or p_expires_at > pg_catalog.now() + interval '16 minutes' then
    raise exception 'Invalid bootstrap challenge.';
  end if;
  insert into private.first_admin_bootstrap(singleton,code_hash,expires_at,consumed_at,created_at)
  values(true,p_code_hash,p_expires_at,null,pg_catalog.now())
  on conflict(singleton) do update set code_hash=excluded.code_hash, expires_at=excluded.expires_at,
    consumed_at=null, created_at=pg_catalog.now();
  return true;
end;
$$;

create or replace function public.bootstrap_ptg_first_system_admin(
  p_user_id uuid, p_username text, p_display_name text, p_auth_email text, p_code_hash text
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_expires timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ptg-first-admin-bootstrap', 0));
  if exists (select 1 from public.user_profiles where role_key = 'SYSTEM_ADMIN') then
    delete from private.first_admin_bootstrap where singleton = true;
    raise exception 'First System Admin initialization has already been completed.';
  end if;
  select expires_at into v_expires from private.first_admin_bootstrap
   where singleton=true and code_hash=p_code_hash and consumed_at is null for update;
  if not found or v_expires <= pg_catalog.now() then
    raise exception 'Bootstrap code is invalid or expired.';
  end if;
  if p_username is null or p_username !~ '^[A-Z0-9._-]{3,32}$'
     or p_display_name is null or pg_catalog.length(pg_catalog.btrim(p_display_name)) = 0
     or p_auth_email is null then
    raise exception 'Invalid first administrator details.';
  end if;
  insert into public.user_profiles(id,display_name,role_key,branch_id,is_active,must_change_password)
  values(p_user_id,pg_catalog.btrim(p_display_name),'SYSTEM_ADMIN',null,true,true);
  insert into private.login_identities(auth_user_id,username,normalized_username,account_scope,branch_id,auth_email)
  values(p_user_id,p_username,p_username,'SYSTEM',null,p_auth_email);
  update private.first_admin_bootstrap set consumed_at=pg_catalog.now(),code_hash='CONSUMED' where singleton=true;
  insert into public.security_audit_logs(actor_user_id,event_category,action,target_identifier,outcome,message,metadata)
  values(p_user_id,'SYSTEM ADMIN ACCOUNT','FIRST ADMIN BOOTSTRAP',p_username,'SUCCESS',
    'First SYSTEM ADMIN initialized through controlled one-time bootstrap.',
    pg_catalog.jsonb_build_object('role','SYSTEM_ADMIN','displayName',p_display_name));
  return true;
end;
$$;

revoke all on function public.issue_ptg_first_admin_bootstrap(text,timestamptz) from public, anon, authenticated;
revoke all on function public.bootstrap_ptg_first_system_admin(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.issue_ptg_first_admin_bootstrap(text,timestamptz) to service_role;
grant execute on function public.bootstrap_ptg_first_system_admin(uuid,text,text,text,text) to service_role;
