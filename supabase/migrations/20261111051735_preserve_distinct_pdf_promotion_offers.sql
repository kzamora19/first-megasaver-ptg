CREATE OR REPLACE FUNCTION public.ptg_prune_memo_offers(scope_branch uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  changed_memos uuid[];
begin
  with offers as (
    select p.id, p.memo_id, m.imported_at,
      case when btrim(p.barcode) ~ '^[0-9]+$' then coalesce(nullif(ltrim(btrim(p.barcode),'0'),''),'0')
           else upper(btrim(p.barcode)) end as barcode_key,
      public.ptg_offer_key(p.remarks) as offer_key,
      public.ptg_period_start(m.period) as start_on
    from public.memo_products p join public.price_memos m on m.id = p.memo_id
    where m.branch_id is not distinct from scope_branch and btrim(p.barcode) <> ''
      and not (m.memo_id ~ '^PDF-[0-9a-f]{64}$' and m.source_file ilike '%.pdf')
  ), ranked as (
    select *, first_value(memo_id) over (
      partition by barcode_key, offer_key
      order by start_on desc nulls last, imported_at desc nulls last, memo_id desc
    ) as winning_memo
    from offers
  ), removed as (
    delete from public.memo_products p using ranked r
    where p.id = r.id and r.start_on is not null and r.memo_id <> r.winning_memo
    returning p.memo_id
  )
  select array_agg(distinct memo_id) into changed_memos from removed;

  update public.price_memos m
  set product_count = (select count(*) from public.memo_products p where p.memo_id = m.id)
  where m.id = any(changed_memos);
end;
$function$;

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
  v_uploaded_at timestamptz;
  v_promotion_pdf boolean;
begin
  if p_duplicate_action not in ('SKIP','REPLACE') then raise exception 'Invalid duplicate action'; end if;
  if p_memo_type not in ('MEMO_LIST','KIOSK_MEMO_LIST') then raise exception 'Invalid memo type'; end if;
  if p_memo_id is null or btrim(p_memo_id) = '' then raise exception 'Memo number is required'; end if;
  if jsonb_typeof(p_products) <> 'array' then raise exception 'Products must be a JSON array'; end if;

  v_promotion_pdf := p_memo_id ~ '^PDF-[0-9a-f]{64}$' and coalesce(p_source_file, '') ilike '%.pdf';
  if v_promotion_pdf and (p_branch_id is not null or not exists (
    select 1 from public.user_profiles
    where id = p_imported_by and role_key = 'SYSTEM_ADMIN' and is_active and not must_change_password
  )) then
    raise exception 'Only a System Admin can import shared promotion PDFs';
  end if;

  perform pg_advisory_xact_lock(20261108, 107);
  v_uploaded_at := clock_timestamp();
  v_start := public.ptg_period_start(p_period);
  if v_start is null and not (v_promotion_pdf and coalesce(p_period, '') = 'Period not printed in source') then
    raise exception 'A readable Period Covered start date is required';
  end if;

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
      (null,p_memo_id,coalesce(p_period,''),p_memo_type,coalesce(p_source_file,''),0,p_imported_by,v_uploaded_at)
    on conflict (memo_id) where branch_id is null do update set
      period=excluded.period,memo_type=excluded.memo_type,source_file=excluded.source_file,
      product_count=0,imported_by=excluded.imported_by,imported_at=v_uploaded_at
    returning * into v_memo;
  else
    insert into public.price_memos
      (branch_id,memo_id,period,memo_type,source_file,product_count,imported_by,imported_at)
    values
      (p_branch_id,p_memo_id,coalesce(p_period,''),p_memo_type,coalesce(p_source_file,''),0,p_imported_by,v_uploaded_at)
    on conflict (branch_id,memo_id) do update set
      period=excluded.period,memo_type=excluded.memo_type,source_file=excluded.source_file,
      product_count=0,imported_by=excluded.imported_by,imported_at=v_uploaded_at
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
    coalesce(x.months_24,0),coalesce(x.remarks,''),coalesce(x.eligible_for_price_tag,false),coalesce(x.price_tag_status,''),v_uploaded_at
  from jsonb_to_recordset(p_products) as x(
    period text,source_file text,brand text,category text,barcode text,model text,srp numeric,cash_payment numeric,
    tag_this numeric,months_6 numeric,months_9 numeric,months_12 numeric,months_18 numeric,months_24 numeric,
    remarks text,eligible_for_price_tag boolean,price_tag_status text
  );
  get diagnostics v_count=row_count;
  update public.price_memos set product_count=v_count where id=v_memo.id;
  if not v_promotion_pdf then
    perform public.ptg_prune_memo_offers(p_branch_id);
  end if;
  select product_count into v_count from public.price_memos where id = v_memo.id;
  return jsonb_build_object('skipped',false,'duplicate',v_exists,'totalProducts',v_count,'memoRecordId',v_memo.id);
end;
$function$;
