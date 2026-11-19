-- STAGED ONLY. Never run against the production PTG project before
-- retention, performance and RLS reviews and a controlled test import.
-- Revision tracking begins when this migration is applied; prior deleted
-- product rows CANNOT be reconstructed.
create schema if not exists private;

create table if not exists private.ptg_memo_price_revisions (
  id bigint generated always as identity primary key,
  transaction_id bigint not null,
  memo_record_id uuid not null,
  memo_number text not null,
  barcode text not null,
  operation text not null check (operation in ('INSERT', 'DELETE')),
  row_snapshot jsonb not null,
  actor_user_id uuid,
  source_period text,
  source_file text,
  recorded_at timestamptz not null default clock_timestamp()
);
create index if not exists ptg_memo_price_revisions_memo_idx
  on private.ptg_memo_price_revisions (memo_number, id desc);
create index if not exists ptg_memo_price_revisions_transaction_idx
  on private.ptg_memo_price_revisions (transaction_id, memo_record_id, barcode);

alter table private.ptg_memo_price_revisions enable row level security;
revoke all on table private.ptg_memo_price_revisions from public, anon, authenticated;
grant select, insert on table private.ptg_memo_price_revisions to service_role;

create or replace function private.ptg_capture_memo_price_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row public.memo_products%rowtype;
  v_number text;
  v_importer uuid;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  select m.memo_id, m.imported_by into v_number, v_importer
  from public.price_memos m where m.id = v_row.memo_id;
  insert into private.ptg_memo_price_revisions (
    transaction_id, memo_record_id, memo_number, barcode, operation,
    row_snapshot, actor_user_id, source_period, source_file
  ) values (
    txid_current(), v_row.memo_id, coalesce(v_number, '[deleted memo]'),
    coalesce(v_row.barcode, ''), tg_op,
    to_jsonb(v_row), v_importer, v_row.period, v_row.source_file
  );
  return null; -- AFTER trigger: the returned row is ignored.
end;
$$;
revoke all on function private.ptg_capture_memo_price_revision()
  from public, anon, authenticated;
drop trigger if exists ptg_capture_memo_price_revision on public.memo_products;
create trigger ptg_capture_memo_price_revision
after insert or delete on public.memo_products
for each row execute function private.ptg_capture_memo_price_revision();

-- The Edge Function uses its service role to retrieve ONLY sanitized fields.
-- Do not expose private row_snapshot JSON (which may include subdealer data)
-- to the browser, branch users, or public API routes.
create or replace function public.ptg_admin_memo_price_revisions(
  p_memo_number text,
  p_offset integer default 0
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_events jsonb;
  v_count integer;
  v_offset integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_memo_number is null or length(btrim(p_memo_number)) < 1 or length(p_memo_number) > 120
    then raise exception 'Memo number is required';
  end if;
  if p_offset < 0 or p_offset > 50000 then raise exception 'Invalid page offset'; end if;
  v_offset := coalesce(p_offset, 0);
  with items as (
    select id, transaction_id, memo_number, barcode, operation, row_snapshot,
      actor_user_id, source_period, source_file, recorded_at
    from private.ptg_memo_price_revisions
    where memo_number = btrim(p_memo_number)
    order by id desc
    limit 41 offset v_offset
  )
  select count(*), coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'transactionId', transaction_id, 'memoNumber', memo_number,
    'barcode', barcode, 'operation', operation,
    'tagThis', row_snapshot->>'tag_this', 'srp', row_snapshot->>'srp',
    'months6', row_snapshot->>'months_6', 'months9', row_snapshot->>'months_9',
    'months12', row_snapshot->>'months_12',
    'months18', row_snapshot->>'months_18', 'months24', row_snapshot->>'months_24',
    'remarks', left(coalesce(row_snapshot->>'remarks',''),240),
    'sourcePeriod', source_period, 'sourceFile', source_file,
    'recordedAt', recorded_at, 'importedById', actor_user_id
  ) order by id desc), '[]'::jsonb)
    into v_count, v_events from items;
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(item order by (item->>'id')::bigint desc)
      from jsonb_array_elements(v_events) with ordinality x(item, ord)
      where ord <= 40), '[]'::jsonb),
    'hasMore', v_count > 40,
    'nextOffset', v_offset + least(v_count, 40),
    'historyStartsAtInstallation', true
  );
end;
$$;
revoke all on function public.ptg_admin_memo_price_revisions(text,integer)
  from public, anon, authenticated;
grant execute on function public.ptg_admin_memo_price_revisions(text,integer)
  to service_role;

comment on table private.ptg_memo_price_revisions is
  'Append-only memo product INSERT/DELETE snapshots captured since installation. Service-role-only.';
