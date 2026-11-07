-- Applied to Supabase project agknxlowackphvwyvxge on 2026-11-07.
-- Initial PTG schema only. No production records or credentials are included.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.branches (
 id uuid primary key default gen_random_uuid(), branch_code text not null unique
 check(branch_code=upper(trim(branch_code))), branch_name text not null,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','INACTIVE')),
 operational_status text not null default 'ON' check(operational_status in ('ON','OFF')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.user_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '',
 role_key text not null check(role_key in ('SYSTEM_ADMIN','SYSTEM_VIEWER','BRANCH_ADMIN','BRANCH_USER')),
 branch_id uuid references public.branches(id) on delete restrict,
 is_active boolean not null default true,
 failed_login_attempts integer not null default 0 check(failed_login_attempts>=0),
 locked_until timestamptz, session_version bigint not null default 1 check(session_version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((role_key in ('SYSTEM_ADMIN','SYSTEM_VIEWER') and branch_id is null)
    or (role_key in ('BRANCH_ADMIN','BRANCH_USER') and branch_id is not null))
);
create index user_profiles_branch_role_idx on public.user_profiles(branch_id,role_key) where branch_id is not null;

-- Private username resolver: SYSTEM usernames are unique globally; BRANCH
-- usernames are unique within their branch. Supabase Auth owns password hashes.
create table private.login_identities (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 username text not null, normalized_username text not null,
 account_scope text not null check(account_scope in ('SYSTEM','BRANCH')),
 branch_id uuid references public.branches(id) on delete restrict,
 auth_email text not null unique, created_at timestamptz not null default now(),
 check((account_scope='SYSTEM' and branch_id is null)
    or (account_scope='BRANCH' and branch_id is not null))
);
create unique index login_identity_system_username_uq on private.login_identities(normalized_username) where account_scope='SYSTEM';
create unique index login_identity_branch_username_uq on private.login_identities(branch_id,normalized_username) where account_scope='BRANCH';
revoke all on private.login_identities from public,anon,authenticated;

create table public.permission_catalog(permission_key text primary key,label text not null,scope_description text not null default '');
create table public.role_permissions(
 role_key text not null check(role_key in ('SYSTEM_ADMIN','SYSTEM_VIEWER','BRANCH_ADMIN','BRANCH_USER')),
 permission_key text not null references public.permission_catalog(permission_key) on delete cascade,
 access_level text not null check(access_level in ('FULL','VIEW','OWN_BRANCH','LIMITED','NONE')),
 primary key(role_key,permission_key)
);
insert into public.permission_catalog values
 ('VIEW_SYSTEM_STATUS','View System Status','System-wide status visibility'),
 ('MASTER_SYSTEM_CONTROL','MASTER SYSTEM ON / OFF','Entire system'),
 ('BRANCH_REGISTRY_VIEW','View Branch Registry','Branch information'),
 ('BRANCH_CONTROL','Enable / Disable Branch','Entire system'),
 ('BRANCH_EDIT','Add / Edit Branch Information','Entire system'),
 ('MAINTENANCE_CONTROL','Maintenance Mode ON / OFF','Entire system'),
 ('SYSTEM_ADMIN_ACCOUNT_MANAGEMENT','Manage System Admin Accounts','System Admin accounts'),
 ('BRANCH_USER_ACCOUNT_MANAGEMENT','Manage Branch User Accounts','Assigned branch'),
 ('PASSWORD_RESET','Reset User Passwords','Permitted accounts'),
 ('USER_STATUS_CONTROL','Enable / Disable User Accounts','Permitted accounts'),
 ('FORCE_LOGOUT','Force Logout Active Sessions','Permitted branch sessions'),
 ('SECURITY_LOG_VIEW','View Security / Activity Logs','Available security logs'),
 ('SECURITY_CONFIGURATION','Change Security Configuration','System-wide security configuration'),
 ('IMPORT_SRP','Import Product SRP Data','PRODUCT_SRP data import')
on conflict(permission_key) do update set label=excluded.label,scope_description=excluded.scope_description;
insert into public.role_permissions
select r.role_key,p.permission_key,
 case when r.role_key='SYSTEM_ADMIN' then 'FULL'
 when r.role_key='SYSTEM_VIEWER' then case when p.permission_key in ('IMPORT_SRP','PASSWORD_RESET','BRANCH_USER_ACCOUNT_MANAGEMENT') then 'NONE' else 'VIEW' end
 when r.role_key='BRANCH_ADMIN' then case when p.permission_key='VIEW_SYSTEM_STATUS' then 'LIMITED' when p.permission_key='BRANCH_REGISTRY_VIEW' then 'OWN_BRANCH' when p.permission_key in ('BRANCH_USER_ACCOUNT_MANAGEMENT','PASSWORD_RESET','USER_STATUS_CONTROL','FORCE_LOGOUT','SECURITY_LOG_VIEW') then 'OWN_BRANCH' else 'NONE' end
 when p.permission_key='BRANCH_REGISTRY_VIEW' then 'OWN_BRANCH' else 'NONE' end
from (values('SYSTEM_ADMIN'),('SYSTEM_VIEWER'),('BRANCH_ADMIN'),('BRANCH_USER')) r(role_key)
cross join public.permission_catalog p
on conflict(role_key,permission_key) do update set access_level=excluded.access_level;

create table public.app_sessions(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 auth_session_id uuid, branch_id uuid references public.branches(id) on delete set null,
 session_version bigint not null, device_label text not null default '',
 created_at timestamptz not null default now(), last_activity_at timestamptz not null default now(),
 expires_at timestamptz not null, revoked_at timestamptz, revoke_reason text
);
create index app_sessions_user_active_idx on public.app_sessions(user_id,expires_at) where revoked_at is null;
create table public.security_audit_logs(
 id bigint generated always as identity primary key, actor_user_id uuid references auth.users(id) on delete set null,
 branch_id uuid references public.branches(id) on delete set null, event_category text not null,
 action text not null, target_identifier text not null default '',
 outcome text not null check(outcome in ('SUCCESS','DENIED','WARNING','INFO')),
 message text not null default '', metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index security_audit_logs_created_idx on public.security_audit_logs(created_at desc);
create index security_audit_logs_branch_created_idx on public.security_audit_logs(branch_id,created_at desc);
create table public.system_controls(
 control_key text primary key, enabled boolean not null default false,
 value_json jsonb not null default '{}'::jsonb, updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);
create table public.price_memos(
 id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete restrict,
 memo_id text not null, period text not null default '', source_file text not null default '',
 product_count integer not null default 0 check(product_count>=0),
 imported_by uuid references auth.users(id) on delete set null, imported_at timestamptz not null default now(),
 unique(branch_id,memo_id)
);
create index price_memos_branch_period_idx on public.price_memos(branch_id,period desc);
create table public.memo_products(
 id uuid primary key default gen_random_uuid(), memo_id uuid not null references public.price_memos(id) on delete cascade,
 period text not null default '', source_file text not null default '', brand text not null default '',
 category text not null default '', barcode text not null default '', model text not null default '',
 srp numeric(14,2) not null default 0, cash_payment numeric(14,2) not null default 0,
 tag_this numeric(14,2) not null default 0, months_6 numeric(14,2) not null default 0,
 months_9 numeric(14,2) not null default 0, months_12 numeric(14,2) not null default 0,
 months_18 numeric(14,2) not null default 0, months_24 numeric(14,2) not null default 0,
 remarks text not null default '', eligible_for_price_tag boolean not null default false,
 price_tag_status text not null default '', imported_at timestamptz not null default now()
);
create index memo_products_memo_idx on public.memo_products(memo_id);
create index memo_products_barcode_idx on public.memo_products(barcode);
create index memo_products_brand_idx on public.memo_products(brand);
create table public.product_master(
 id uuid primary key default gen_random_uuid(), barcode text not null unique, description text not null,
 category text not null default '', sub_category text not null default '', brand text not null default '',
 source_file text not null default '', imported_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index product_master_brand_idx on public.product_master(brand);
create table public.product_srp(
 id uuid primary key default gen_random_uuid(), barcode text not null unique, model_description text not null,
 srp numeric(14,2) not null default 0 check(srp>=0), import_date timestamptz not null default now(), source_file text not null default ''
);
create table public.logo_assets(
 id uuid primary key default gen_random_uuid(),
 logo_key text not null unique check(logo_key in ('header','promo','zero','flexi','home','qr','social','appHeader','securityHeader')),
 storage_path text not null, mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp')),
 original_file_name text not null default '', updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);
create table public.branch_installations(
 id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
 installation_label text not null default '', installation_url text not null default '',
 app_version text not null default '', last_verified_at timestamptz, created_at timestamptz not null default now()
);
create table public.deployment_config(
 config_key text primary key, config_value text not null,
 updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);

-- SECURITY DEFINER helpers are isolated in a non-exposed schema with a fixed search_path.
create or replace function private.current_role_key() returns text
language sql stable security definer set search_path='' as $$
 select p.role_key from public.user_profiles p where p.id=(select auth.uid()) and p.is_active=true limit 1 $$;
create or replace function private.current_branch_id() returns uuid
language sql stable security definer set search_path='' as $$
 select p.branch_id from public.user_profiles p where p.id=(select auth.uid()) and p.is_active=true limit 1 $$;
create or replace function private.is_system_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles p where p.id=(select auth.uid()) and p.is_active=true and p.role_key='SYSTEM_ADMIN') $$;
create or replace function private.can_read_branch(target_branch_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles p where p.id=(select auth.uid()) and p.is_active=true and
 (p.role_key in ('SYSTEM_ADMIN','SYSTEM_VIEWER') or (p.role_key in ('BRANCH_ADMIN','BRANCH_USER') and p.branch_id=target_branch_id))) $$;
create or replace function private.can_manage_branch(target_branch_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles p where p.id=(select auth.uid()) and p.is_active=true and
 (p.role_key='SYSTEM_ADMIN' or (p.role_key='BRANCH_ADMIN' and p.branch_id=target_branch_id))) $$;
revoke all on function private.current_role_key() from public;
revoke all on function private.current_branch_id() from public;
revoke all on function private.is_system_admin() from public;
revoke all on function private.can_read_branch(uuid) from public;
revoke all on function private.can_manage_branch(uuid) from public;
grant execute on function private.current_role_key() to authenticated;
grant execute on function private.current_branch_id() to authenticated;
grant execute on function private.is_system_admin() to authenticated;
grant execute on function private.can_read_branch(uuid) to authenticated;
grant execute on function private.can_manage_branch(uuid) to authenticated;

do $$ declare t text; begin
 foreach t in array array['branches','user_profiles','permission_catalog','role_permissions','app_sessions','security_audit_logs','system_controls','price_memos','memo_products','product_master','product_srp','logo_assets','branch_installations','deployment_config']
 loop execute format('alter table public.%I enable row level security',t); end loop;
end $$;

create policy branches_read_scoped on public.branches for select to authenticated using(private.can_read_branch(id));
create policy branches_admin_write on public.branches for all to authenticated using(private.is_system_admin()) with check(private.is_system_admin());
create policy profiles_read_scoped on public.user_profiles for select to authenticated using(id=(select auth.uid()) or private.is_system_admin() or (private.current_role_key()='BRANCH_ADMIN' and branch_id=(select private.current_branch_id())));
create policy profiles_admin_update on public.user_profiles for update to authenticated using(private.is_system_admin() or (private.current_role_key()='BRANCH_ADMIN' and branch_id=(select private.current_branch_id()))) with check(private.is_system_admin() or (private.current_role_key()='BRANCH_ADMIN' and branch_id=(select private.current_branch_id())));
create policy permission_catalog_read on public.permission_catalog for select to authenticated using(true);
create policy role_permissions_read on public.role_permissions for select to authenticated using(true);
create policy role_permissions_admin_write on public.role_permissions for all to authenticated using(private.is_system_admin()) with check(private.is_system_admin());
create policy app_sessions_read_scoped on public.app_sessions for select to authenticated using(user_id=(select auth.uid()) or private.is_system_admin() or (private.current_role_key()='BRANCH_ADMIN' and branch_id=(select private.current_branch_id())));
create policy audit_read_scoped on public.security_audit_logs for select to authenticated using(private.is_system_admin() or private.current_role_key()='SYSTEM_VIEWER' or (private.current_role_key()='BRANCH_ADMIN' and branch_id=(select private.current_branch_id())));
create policy system_controls_read on public.system_controls for select to authenticated using(private.current_role_key() in ('SYSTEM_ADMIN','SYSTEM_VIEWER'));
create policy system_controls_admin_write on public.system_controls for all to authenticated using(private.is_system_admin()) with check(private.is_system_admin());
create policy price_memos_read_branch on public.price_memos for select to authenticated using(private.can_read_branch(branch_id));
create policy price_memos_manage_branch on public.price_memos for all to authenticated using(private.can_manage_branch(branch_id)) with check(private.can_manage_branch(branch_id));
create policy memo_products_read_branch on public.memo_products for select to authenticated using(exists(select 1 from public.price_memos m where m.id=public.memo_products.memo_id and private.can_read_branch(m.branch_id)));
create policy memo_products_manage_branch on public.memo_products for all to authenticated using(exists(select 1 from public.price_memos m where m.id=public.memo_products.memo_id and private.can_manage_branch(m.branch_id))) with check(exists(select 1 from public.price_memos m where m.id=public.memo_products.memo_id and private.can_manage_branch(m.branch_id)));
create policy product_master_read_auth on public.product_master for select to authenticated using(true);
create policy product_master_admin_write on public.product_master for all to authenticated using(private.is_system_admin()) with check(private.is_system_admin());
create policy product_srp_read_auth on public.product_srp for select to authenticated using(true);
create policy product_srp_admin_write on public.product_srp for all to authenticated using(private.is_system_admin()) with check(private.is_system_admin());
create policy logo_assets_read_auth on public.logo_assets for select to authenticated using(true);
create policy logo_assets_admin_write on public.logo_assets for all to authenticated using(private.is_system_admin()) with check(private.is_system_admin());
create policy branch_installations_read on public.branch_installations for select to authenticated using(private.can_read_branch(branch_id));
create policy branch_installations_manage on public.branch_installations for all to authenticated using(private.can_manage_branch(branch_id)) with check(private.can_manage_branch(branch_id));
create policy deployment_config_admin_read on public.deployment_config for select to authenticated using(private.is_system_admin());
create policy deployment_config_admin_write on public.deployment_config for all to authenticated using(private.is_system_admin()) with check(private.is_system_admin());

grant select on public.branches,public.permission_catalog,public.role_permissions,public.user_profiles,public.app_sessions,
 public.security_audit_logs,public.system_controls,public.price_memos,public.memo_products,public.product_master,
 public.product_srp,public.logo_assets,public.branch_installations,public.deployment_config to authenticated;
grant insert,update,delete on public.branches,public.role_permissions,public.system_controls,public.price_memos,
 public.memo_products,public.product_master,public.product_srp,public.logo_assets,public.branch_installations,public.deployment_config to authenticated;
revoke insert,update,delete on public.user_profiles,public.app_sessions,public.security_audit_logs from authenticated;
