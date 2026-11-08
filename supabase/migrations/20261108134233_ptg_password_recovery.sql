create table private.ptg_password_recovery (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text unique,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  session_version bigint not null
);
alter table private.ptg_password_recovery enable row level security;
grant select, insert, update on private.ptg_password_recovery to service_role;

create function public.ptg_issue_password_recovery(p_user_id uuid, p_hash text)
returns boolean language sql set search_path = '' as $$
  with issued as (
    insert into private.ptg_password_recovery (user_id, token_hash, expires_at, session_version)
    select id, p_hash, now() + interval '30 minutes', session_version
    from public.user_profiles where id = p_user_id and is_active
    on conflict (user_id) do update
      set token_hash = excluded.token_hash, expires_at = excluded.expires_at,
          session_version = excluded.session_version, requested_at = now()
      where private.ptg_password_recovery.requested_at <= now() - interval '15 minutes'
    returning 1
  )
  select exists(select 1 from issued)
$$;

create function public.ptg_claim_password_recovery(p_hash text)
returns uuid language sql set search_path = '' as $$
  update private.ptg_password_recovery r set token_hash = null
  from public.user_profiles p
  where r.token_hash = p_hash and r.expires_at > now() and p.id = r.user_id
    and p.is_active and p.role_key in ('SYSTEM_ADMIN','BRANCH_ADMIN')
    and p.session_version = r.session_version
  returning r.user_id
$$;

revoke execute on function public.ptg_issue_password_recovery(uuid,text), public.ptg_claim_password_recovery(text) from public, anon, authenticated;
grant execute on function public.ptg_issue_password_recovery(uuid,text), public.ptg_claim_password_recovery(text) to service_role;
