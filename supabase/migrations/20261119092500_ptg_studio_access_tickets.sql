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
