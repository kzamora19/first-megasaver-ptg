-- SSO entitlement staging for new Branchline identities only.
-- Not automatically populated from email or existing PTG accounts.
-- Only a future authenticated cross-project provisioning service may grant it.

create table if not exists public.ptg_unified_sso_grants (
  sales_user_id uuid primary key,
  ptg_user_id uuid unique references auth.users(id),
  expected_email text not null check (expected_email = lower(btrim(expected_email))
    and expected_email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'),
  username text not null unique check (length(btrim(username)) between 3 and 120),
  display_name text not null check (length(btrim(display_name)) between 2 and 140),
  role_key text not null check (role_key in ('BRANCH_USER','BRANCH_ADMIN')),
  legacy_role text not null check (legacy_role in ('TEAM LEADER','BRANCH MANAGER','BRANCH ADMIN')),
  branch_id uuid not null references public.branches(id),
  is_active boolean not null default false,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unified_role_map check (
    (role_key='BRANCH_USER' and legacy_role='TEAM LEADER') or
    (role_key='BRANCH_ADMIN' and legacy_role in ('BRANCH MANAGER','BRANCH ADMIN'))
  ),
  constraint unified_grant_approval check (not is_active or approved_at is not null)
);

create unique index if not exists ptg_unified_sso_grants_username_uq
  on public.ptg_unified_sso_grants (upper(btrim(username)));
alter table public.ptg_unified_sso_grants enable row level security;
revoke all on public.ptg_unified_sso_grants from public,anon,authenticated;
grant all on public.ptg_unified_sso_grants to service_role;

comment on table public.ptg_unified_sso_grants is
 'Trusted cross-project SSO entitlements for approved new users only; not email-self-service registration. Only service_role may read/write.';
