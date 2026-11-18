-- Ensure active-offer lookups can exclude manually expired memos.
-- Safe to apply after the local Memo History / Expiration implementation:
-- the column is created only when it does not already exist.
alter table public.price_memos
  add column if not exists expired_at timestamptz;

create index if not exists price_memos_active_branch_idx
  on public.price_memos(branch_id, memo_id)
  where expired_at is null;
