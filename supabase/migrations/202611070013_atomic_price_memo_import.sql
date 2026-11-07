-- Atomic memo import. REPLACE removes the prior memo's product rows only inside
-- the same transaction that inserts the replacement rows.
create or replace function public.import_price_memo(
  p_branch_id uuid,
  p_memo_id text,
  p_period text,
  p_source_file text,
  p_imported_by uuid,
  p_duplicate_action text,
  p_products jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_memo public.price_memos%rowtype;
  v_exists boolean;
  v_count integer;
begin
  if p_duplicate_action not in ('SKIP','REPLACE') then
    raise exception 'Invalid duplicate action';
  end if;
  if p_memo_id is null or btrim(p_memo_id) = '' then
    raise exception 'Memo number is required';
  end if;
  if jsonb_typeof(p_products) <> 'array' then
    raise exception 'Products must be a JSON array';
  end if;

  select exists(
    select 1 from public.price_memos
    where branch_id = p_branch_id and memo_id = p_memo_id
  ) into v_exists;

  if v_exists and p_duplicate_action = 'SKIP' then
    return jsonb_build_object('skipped', true, 'duplicate', true, 'totalProducts', 0);
  end if;

  insert into public.price_memos
    (branch_id, memo_id, period, source_file, product_count, imported_by, imported_at)
  values
    (p_branch_id, p_memo_id, coalesce(p_period,''), coalesce(p_source_file,''), 0, p_imported_by, now())
  on conflict (branch_id, memo_id) do update set
    period = excluded.period,
    source_file = excluded.source_file,
    product_count = 0,
    imported_by = excluded.imported_by,
    imported_at = now()
  returning * into v_memo;

  delete from public.memo_products where memo_id = v_memo.id;

  insert into public.memo_products (
    memo_id, period, source_file, brand, category, barcode, model, srp,
    cash_payment, tag_this, months_6, months_9, months_12, months_18,
    months_24, remarks, eligible_for_price_tag, price_tag_status, imported_at
  )
  select
    v_memo.id,
    coalesce(x.period, ''),
    coalesce(x.source_file, ''),
    coalesce(x.brand, ''),
    coalesce(x.category, ''),
    coalesce(x.barcode, ''),
    coalesce(x.model, ''),
    coalesce(x.srp, 0),
    coalesce(x.cash_payment, 0),
    coalesce(x.tag_this, 0),
    coalesce(x.months_6, 0),
    coalesce(x.months_9, 0),
    coalesce(x.months_12, 0),
    coalesce(x.months_18, 0),
    coalesce(x.months_24, 0),
    coalesce(x.remarks, ''),
    coalesce(x.eligible_for_price_tag, false),
    coalesce(x.price_tag_status, ''),
    now()
  from jsonb_to_recordset(p_products) as x(
    period text, source_file text, brand text, category text, barcode text,
    model text, srp numeric, cash_payment numeric, tag_this numeric,
    months_6 numeric, months_9 numeric, months_12 numeric, months_18 numeric,
    months_24 numeric, remarks text, eligible_for_price_tag boolean,
    price_tag_status text
  );

  get diagnostics v_count = row_count;
  update public.price_memos set product_count = v_count where id = v_memo.id;

  return jsonb_build_object(
    'skipped', false,
    'duplicate', v_exists,
    'totalProducts', v_count,
    'memoRecordId', v_memo.id
  );
end;
$$;

revoke all on function public.import_price_memo(uuid,text,text,text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.import_price_memo(uuid,text,text,text,uuid,text,jsonb) to service_role;
