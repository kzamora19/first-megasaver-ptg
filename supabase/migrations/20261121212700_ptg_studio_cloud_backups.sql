-- STAGING ONLY. Never apply to production until final hosted acceptance.
-- These rows live in the EXISTING PTG Supabase project. Actor UUIDs are
-- PTG Auth identities, not MegaFrame/MegaFlyer Auth identities.
-- The encrypted content is created by the browser's per-account AES-GCM vault.
create table if not exists public.ptg_studio_cloud_backups (
  studio_id text not null check (studio_id in ('megaframe','flyer')),
  owner_ptg_id uuid not null references auth.users(id) on delete cascade,
  record_key text not null check (length(record_key) between 2 and 110),
  iv text not null check (iv ~ '^[A-Za-z0-9_-]{16}$'),
  encrypted text not null check (
    length(encrypted) between 24 and 1200000 and
    encrypted ~ '^[A-Za-z0-9_-]+$'
  ),
  version integer not null default 1 check (version between 1 and 2000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (studio_id,owner_ptg_id,record_key)
);
create index if not exists ptg_studio_cloud_user_idx
  on public.ptg_studio_cloud_backups(owner_ptg_id,studio_id,updated_at desc);
alter table public.ptg_studio_cloud_backups enable row level security;
revoke all on public.ptg_studio_cloud_backups from public, anon, authenticated;
grant select, insert, update, delete on public.ptg_studio_cloud_backups to service_role;
comment on table public.ptg_studio_cloud_backups is
 'Explicit opt-in AES-GCM encrypted cloud snapshots for PTG-authorized Studio users. No direct browser access.';

-- Atomic create-or-compare-and-swap; a device cannot silently overwrite a
-- different device's latest project version. Service-only SECURITY INVOKER.
create or replace function public.ptg_studio_cloud_write(
 p_studio_id text,p_user_id uuid,p_record_key text,p_iv text,
 p_encrypted text,p_expected_version integer
) returns integer
language plpgsql security invoker set search_path = ''
as $cloud$
declare new_version integer;
begin
 if p_expected_version = 0 then
   insert into public.ptg_studio_cloud_backups
      (studio_id,owner_ptg_id,record_key,iv,encrypted)
   values (p_studio_id,p_user_id,p_record_key,p_iv,p_encrypted)
   on conflict do nothing
   returning version into new_version;
 elsif p_expected_version between 1 and 1999999999 then
   update public.ptg_studio_cloud_backups
      set iv=p_iv,encrypted=p_encrypted,version=version+1,updated_at=clock_timestamp()
    where studio_id=p_studio_id and owner_ptg_id=p_user_id
      and record_key=p_record_key and version=p_expected_version
   returning version into new_version;
 end if;
 return new_version; -- null signals conflicting edit/version.
end
$cloud$;
revoke all on function public.ptg_studio_cloud_write(text,uuid,text,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.ptg_studio_cloud_write(text,uuid,text,text,text,integer)
  to service_role;
