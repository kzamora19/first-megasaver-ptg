create or replace function public.ptg_signal_availability()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'branches' then
    if old.status is distinct from new.status or old.operational_status is distinct from new.operational_status then
      update public.ptg_availability_signal set changed_at = clock_timestamp() where singleton;
    end if;
  elsif new.control_key in ('MASTER_SYSTEM', 'MAINTENANCE_MODE') then
    update public.ptg_availability_signal set changed_at = clock_timestamp() where singleton;
  end if;
  return null;
end;
$$;

create trigger ptg_signal_availability
after update of status, operational_status on public.branches
for each row execute function public.ptg_signal_availability();
