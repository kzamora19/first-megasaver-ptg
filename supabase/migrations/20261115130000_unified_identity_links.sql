-- Phase 1: server-owned, immutable association between a newly invited
-- Sales Tracker identity and a separately provisioned PTG identity.
-- Existing PTG and Sales Tracker accounts are not linked or migrated.
-- This migration remains un-applied until the SSO broker is validated.
create table if not exists public.unified_identity_links (
  sales_user_id uuid primary key,
  ptg_user_id uuid not null unique references auth.users(id) on delete cascade,
  sales_dealer_id uuid not null,
  sales_branch_code text not null check (sales_branch_code ~ '^[A-Z0-9_-]{1,32}$'),
  ptg_branch_id uuid references public.branches(id),
  ptg_role_key text not null check (ptg_role_key in ('BRANCH_ADMIN','BRANCH_USER')),
  status text not null default 'PENDING' check (status in ('PENDING','ACTIVE','REVOKED')),
  linked_by_ptg_admin uuid not null references auth.users(id),
  linked_at timestamptz not null default now(),
  activated_at timestamptz,
  revoked_at timestamptz,
  constraint unified_link_branch_required check (ptg_branch_id is not null),
  constraint unified_link_revocation check (status <> 'REVOKED' or revoked_at is not null)
);
create index if not exists unified_identity_links_ptg_user_idx
  on public.unified_identity_links(ptg_user_id);
alter table public.unified_identity_links enable row level security;
revoke all on public.unified_identity_links from public, anon, authenticated;
grant select, insert, update on public.unified_identity_links to service_role;
comment on table public.unified_identity_links is
  'Future unified SSO: verified immutable Sales user ID linked to a newly provisioned PTG user. No bearer tokens or passwords stored.';
