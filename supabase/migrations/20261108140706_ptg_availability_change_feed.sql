drop trigger ptg_broadcast_availability on public.system_controls;
drop function public.ptg_broadcast_availability();
drop policy "PTG clients can receive availability changes" on realtime.messages;

create table public.ptg_availability_signal (
  singleton boolean primary key default true check (singleton),
  changed_at timestamptz not null default now()
);
insert into public.ptg_availability_signal default values;
alter table public.ptg_availability_signal enable row level security;
revoke all on table public.ptg_availability_signal from anon, authenticated;
grant select on table public.ptg_availability_signal to authenticated;
grant select, update on table public.ptg_availability_signal to service_role;
create policy "Signed-in clients can read the PTG availability signal"
on public.ptg_availability_signal for select to authenticated using (true);
alter publication supabase_realtime add table public.ptg_availability_signal;

create function public.ptg_signal_availability()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.control_key in ('MASTER_SYSTEM', 'MAINTENANCE_MODE') then
    update public.ptg_availability_signal set changed_at = clock_timestamp() where singleton;
  end if;
  return null;
end;
$$;
revoke execute on function public.ptg_signal_availability() from public, anon, authenticated;
create trigger ptg_signal_availability
after insert or update of enabled on public.system_controls
for each row execute function public.ptg_signal_availability();
