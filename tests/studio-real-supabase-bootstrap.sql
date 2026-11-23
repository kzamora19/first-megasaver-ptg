-- Synthetic PTG fixtures for a brand-new LOCAL Supabase CLI stack only.
-- This intentionally does not create or override real auth.users.
DO $guard$
BEGIN
 IF current_database() <> 'postgres' OR to_regclass('auth.users') IS NULL
    OR to_regclass('public.user_profiles') IS NOT NULL THEN
  RAISE EXCEPTION 'Studio fixture requires a clean local Supabase database';
 END IF;
END $guard$;
create table public.branches (
 id uuid primary key,
 status text not null,
 operational_status text not null
);
create table public.user_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 role_key text not null,
 legacy_role text,
 is_active boolean not null default true,
 must_change_password boolean not null default false,
 session_version integer not null default 1
);
create table public.app_sessions (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 branch_id uuid references public.branches(id),
 session_version integer not null,
 remember_device boolean not null default false,
 expires_at timestamptz not null,
 last_activity_at timestamptz not null,
 revoked_at timestamptz
);
alter table public.branches enable row level security;
alter table public.user_profiles enable row level security;
alter table public.app_sessions enable row level security;
revoke all on public.branches,public.user_profiles,public.app_sessions from anon,authenticated;
grant select,insert,update,delete on public.branches,public.user_profiles,public.app_sessions to service_role;
select pg_notify('pgrst','reload schema');
