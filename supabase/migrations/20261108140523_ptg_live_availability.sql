create policy "PTG clients can receive availability changes"
on realtime.messages for select to authenticated
using (extension = 'broadcast' and (select realtime.topic()) = 'ptg-availability');

create function public.ptg_broadcast_availability()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.control_key in ('MASTER_SYSTEM', 'MAINTENANCE_MODE') then
    perform realtime.send('{}'::jsonb, 'availability-changed', 'ptg-availability', true);
  end if;
  return null;
end;
$$;
revoke execute on function public.ptg_broadcast_availability() from public, anon, authenticated;

create trigger ptg_broadcast_availability
after insert or update of enabled on public.system_controls
for each row execute function public.ptg_broadcast_availability();
