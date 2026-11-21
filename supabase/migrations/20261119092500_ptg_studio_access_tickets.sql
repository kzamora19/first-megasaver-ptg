-- STAGED ONLY: do not run against production until explicit release approval.
-- Opaque, short-lived, scoped PTG credentials for protected Studio origins.
create table if not exists public.ptg_studio_access_tickets (
  ticket_hash char(64) primary key check (ticket_hash ~ '^[0-9a-f]{64}$'),
  studio_id text not null check (studio_id in ('megaframe', 'flyer')),
  user_id uuid not null references auth.users(id) on delete cascade,
  app_session_id uuid not null references public.app_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at <= created_at + interval '10 minutes'),
  revoked_at timestamptz
);
create index if not exists ptg_studio_access_tickets_session_idx
  on public.ptg_studio_access_tickets (app_session_id, expires_at);
alter table public.ptg_studio_access_tickets enable row level security;
revoke all on public.ptg_studio_access_tickets from public, anon, authenticated;
grant select, insert, update, delete on public.ptg_studio_access_tickets to service_role;
comment on table public.ptg_studio_access_tickets is
  'Opaque hashed 10-minute studio tickets; only the PTG service_role may access; no browser-readable RLS policies.';

-- STAGED ONLY: not applied to any live Supabase database.
-- The source PTG ticket may be redeemed only once; refresh uses signed challenges.
alter table public.ptg_studio_access_tickets
 add column if not exists redeemed_at timestamptz;
create table if not exists public.ptg_studio_proof_sessions (
 id uuid primary key default gen_random_uuid(),
 studio_id text not null check (studio_id in ('megaframe','flyer')),
 user_id uuid not null references auth.users(id) on delete cascade,
 app_session_id uuid not null references public.app_sessions(id) on delete cascade,
 public_jwk jsonb not null,
 challenge_hash char(64) not null check (challenge_hash ~ '^[0-9a-f]{64}$'),
 challenge_expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null check (expires_at <= created_at + interval '2 hours'),
 revoked_at timestamptz
);
create index if not exists ptg_studio_proof_source_idx
 on public.ptg_studio_proof_sessions (app_session_id, expires_at);
alter table public.ptg_studio_proof_sessions enable row level security;
revoke all on public.ptg_studio_proof_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.ptg_studio_proof_sessions to service_role;
comment on table public.ptg_studio_proof_sessions is
 'Server-only short lived proof-of-possession sessions. Public JWK is not a bearer credential.';

-- Development only: atomic fixed-window Studio issue quota, shared by both Studios.
-- Twelve successful issue attempts per PTG user in any 60-second window.
-- Service-only RPC. SECURITY INVOKER avoids a public privileged code path.
create table if not exists public.ptg_studio_issue_limits (
 user_id uuid primary key references auth.users(id) on delete cascade,
 window_started_at timestamptz not null default now(),
 attempts integer not null default 0 check (attempts between 0 and 12)
);
alter table public.ptg_studio_issue_limits enable row level security;
revoke all on public.ptg_studio_issue_limits from public, anon, authenticated;
grant select, insert, update, delete on public.ptg_studio_issue_limits to service_role;

create or replace function public.ptg_studio_reserve_issue_slot(p_user_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $quota$
declare
 reserved_count integer;
begin
 insert into public.ptg_studio_issue_limits as lim (user_id, window_started_at, attempts)
 values(p_user_id, clock_timestamp(), 1)
 on conflict(user_id) do update
 set window_started_at=case
   when lim.window_started_at <= clock_timestamp()-interval '60 seconds'
   then clock_timestamp() else lim.window_started_at end,
     attempts=case
   when lim.window_started_at <= clock_timestamp()-interval '60 seconds'
   then 1 else lim.attempts+1 end
 where lim.window_started_at <= clock_timestamp()-interval '60 seconds'
    or lim.attempts < 12
 returning attempts into reserved_count;
 return reserved_count is not null;
end
$quota$;
revoke all on function public.ptg_studio_reserve_issue_slot(uuid) from public, anon, authenticated;
grant execute on function public.ptg_studio_reserve_issue_slot(uuid) to service_role;
comment on function public.ptg_studio_reserve_issue_slot(uuid) is
 'Service-only, atomic per-account Studio issue quota. No browser EXECUTE; shared across both Studios.';
