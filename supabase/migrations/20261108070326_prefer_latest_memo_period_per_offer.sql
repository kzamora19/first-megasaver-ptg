
create or replace function public.ptg_period_start(value text)
returns date language plpgsql stable set search_path = '' as $$
begin
  return substring(btrim(value) from '^[0-9]{4}-[0-9]{2}-[0-9]{2}|^[A-Za-z]+[[:space:]]+[0-9]{1,2},?[[:space:]]+[0-9]{4}')::date;
exception when invalid_datetime_format or datetime_field_overflow then
  return null;
end;
$$;

create or replace function public.ptg_offer_key(remarks text)
returns text language sql immutable set search_path = '' as $$
  select case
    when upper(remarks) ~ '\mUNIT[[:space:]]+ONLY\M' and upper(remarks) !~ 'FREE.*INSTALLATION' then 'unit only'
    when upper(remarks) ~ 'FREE.*INSTALLATION' and upper(remarks) !~ '\mUNIT[[:space:]]+ONLY\M' then 'free installation'
    else 'remarks:' || lower(regexp_replace(btrim(coalesce(remarks,'')), '[[:space:]]+', ' ', 'g'))
  end;
$$;

create or replace function public.ptg_prune_memo_offers(scope_branch uuid)
returns void language plpgsql set search_path = '' as $$
declare
  changed_memos uuid[];
begin
  with offers as (
    select p.id, p.memo_id,
      case when btrim(p.barcode) ~ '^[0-9]+$' then coalesce(nullif(ltrim(btrim(p.barcode),'0'),''),'0')
           else upper(btrim(p.barcode)) end as barcode_key,
      public.ptg_offer_key(p.remarks) as offer_key,
      public.ptg_period_start(m.period) as start_on
    from public.memo_products p join public.price_memos m on m.id = p.memo_id
    where m.branch_id is not distinct from scope_branch and btrim(p.barcode) <> ''
  ), ranked as (
    select *, max(start_on) over (partition by barcode_key, offer_key) as newest
    from offers
  ), removed as (
    delete from public.memo_products p using ranked r
    where p.id = r.id and r.start_on < r.newest
    returning p.memo_id
  )
  select array_agg(distinct memo_id) into changed_memos from removed;

  update public.price_memos m
  set product_count = (select count(*) from public.memo_products p where p.memo_id = m.id)
  where m.id = any(changed_memos);
end;
$$;

revoke execute on function public.ptg_period_start(text), public.ptg_offer_key(text), public.ptg_prune_memo_offers(uuid) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION public.import_price_memo(p_branch_id uuid, p_memo_id text, p_period text, p_memo_type text, p_source_file text, p_imported_by uuid, p_duplicate_action text, p_products jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_memo public.price_memos%rowtype;
  v_exists boolean;
  v_count integer;
  v_start date;
  v_saved_start date;
begin
  if p_duplicate_action not in ('SKIP','REPLACE') then raise exception 'Invalid duplicate action'; end if;
  if p_memo_type not in ('MEMO_LIST','KIOSK_MEMO_LIST') then raise exception 'Invalid memo type'; end if;
  if p_memo_id is null or btrim(p_memo_id) = '' then raise exception 'Memo number is required'; end if;
  if jsonb_typeof(p_products) <> 'array' then raise exception 'Products must be a JSON array'; end if;

  perform pg_advisory_xact_lock(20261108, 107);
  v_start := public.ptg_period_start(p_period);
  if v_start is null then raise exception 'A readable Period Covered start date is required'; end if;

  select exists(
    select 1 from public.price_memos
    where branch_id is not distinct from p_branch_id and memo_id=p_memo_id
  ) into v_exists;
  if v_exists and p_duplicate_action='SKIP' then
    return jsonb_build_object('skipped',true,'duplicate',true,'totalProducts',0);
  end if;

  if v_exists then
    select public.ptg_period_start(period) into v_saved_start
    from public.price_memos where branch_id is not distinct from p_branch_id and memo_id = p_memo_id;
    if v_saved_start is null or v_saved_start > v_start then
      return jsonb_build_object('skipped',true,'duplicate',true,'totalProducts',0,'olderPeriod',true);
    end if;
  end if;

  if p_branch_id is null then
    insert into public.price_memos
      (branch_id,memo_id,period,memo_type,source_file,product_count,imported_by,imported_at)
    values
      (null,p_memo_id,coalesce(p_period,''),p_memo_type,coalesce(p_source_file,''),0,p_imported_by,now())
    on conflict (memo_id) where branch_id is null do update set
      period=excluded.period,memo_type=excluded.memo_type,source_file=excluded.source_file,
      product_count=0,imported_by=excluded.imported_by,imported_at=now()
    returning * into v_memo;
  else
    insert into public.price_memos
      (branch_id,memo_id,period,memo_type,source_file,product_count,imported_by,imported_at)
    values
      (p_branch_id,p_memo_id,coalesce(p_period,''),p_memo_type,coalesce(p_source_file,''),0,p_imported_by,now())
    on conflict (branch_id,memo_id) do update set
      period=excluded.period,memo_type=excluded.memo_type,source_file=excluded.source_file,
      product_count=0,imported_by=excluded.imported_by,imported_at=now()
    returning * into v_memo;
  end if;

  delete from public.memo_products where memo_id=v_memo.id;
  insert into public.memo_products (
    memo_id,period,source_file,brand,category,barcode,model,srp,cash_payment,tag_this,
    months_6,months_9,months_12,months_18,months_24,remarks,eligible_for_price_tag,price_tag_status,imported_at
  )
  select v_memo.id,coalesce(x.period,''),coalesce(x.source_file,''),coalesce(x.brand,''),coalesce(x.category,''),
    coalesce(x.barcode,''),coalesce(x.model,''),coalesce(x.srp,0),coalesce(x.cash_payment,0),coalesce(x.tag_this,0),
    coalesce(x.months_6,0),coalesce(x.months_9,0),coalesce(x.months_12,0),coalesce(x.months_18,0),
    coalesce(x.months_24,0),coalesce(x.remarks,''),coalesce(x.eligible_for_price_tag,false),coalesce(x.price_tag_status,''),now()
  from jsonb_to_recordset(p_products) as x(
    period text,source_file text,brand text,category text,barcode text,model text,srp numeric,cash_payment numeric,
    tag_this numeric,months_6 numeric,months_9 numeric,months_12 numeric,months_18 numeric,months_24 numeric,
    remarks text,eligible_for_price_tag boolean,price_tag_status text
  );
  get diagnostics v_count=row_count;
  update public.price_memos set product_count=v_count where id=v_memo.id;
  perform public.ptg_prune_memo_offers(p_branch_id);
  select product_count into v_count from public.price_memos where id = v_memo.id;
  return jsonb_build_object('skipped',false,'duplicate',v_exists,'totalProducts',v_count,'memoRecordId',v_memo.id);
end;
$function$;

select pg_advisory_xact_lock(20261108, 107);
select public.ptg_prune_memo_offers(null);
