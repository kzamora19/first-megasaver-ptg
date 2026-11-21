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
