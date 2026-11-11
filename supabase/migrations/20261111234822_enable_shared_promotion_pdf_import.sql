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
  v_end date;
  v_added integer;
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
  if v_promotion_pdf then
    if p_period is null or p_period !~ '^(Until |[0-9]{4}-[0-9]{2}-[0-9]{2} to )[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'A confirmed promotion end date is required';
    end if;
    v_start := substring(p_period from '^([0-9]{4}-[0-9]{2}-[0-9]{2})')::date;
    v_end := right(p_period, 10)::date;
    if v_start > v_end then raise exception 'The promotion end date precedes its start date'; end if;
  elsif v_start is null then
    raise exception 'A readable Period Covered start date is required';
  end if;

  select exists(
    select 1 from public.price_memos
    where branch_id is not distinct from p_branch_id and memo_id=p_memo_id
  ) into v_exists;
  if v_exists and not v_promotion_pdf and p_duplicate_action='SKIP' then
    return jsonb_build_object('skipped',true,'duplicate',true,'totalProducts',0);
  end if;

  if v_exists and not v_promotion_pdf then
    select public.ptg_period_start(period) into v_saved_start
    from public.price_memos where branch_id is not distinct from p_branch_id and memo_id = p_memo_id;
    if v_saved_start is null or v_saved_start > v_start then
      return jsonb_build_object('skipped',true,'duplicate',true,'totalProducts',0,'olderPeriod',true);
    end if;
  end if;

  if v_promotion_pdf and v_exists then
    select * into strict v_memo from public.price_memos where branch_id is null and memo_id = p_memo_id;
    if v_memo.period is distinct from p_period then raise exception 'The existing promotion has different dates'; end if;
  elsif p_branch_id is null then
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

  if not v_promotion_pdf then
    delete from public.memo_products where memo_id=v_memo.id;
  end if;
  insert into public.memo_products (
    memo_id,period,source_file,brand,category,barcode,model,srp,cash_payment,tag_this,
    months_6,months_9,months_12,months_18,months_24,remarks,eligible_for_price_tag,price_tag_status,imported_at
  )
  select v_memo.id,coalesce(x.period,''),case when v_promotion_pdf then v_memo.source_file else coalesce(x.source_file,'') end,coalesce(x.brand,''),coalesce(x.category,''),
    coalesce(x.barcode,''),coalesce(x.model,''),coalesce(x.srp,0),coalesce(x.cash_payment,0),coalesce(x.tag_this,0),
    coalesce(x.months_6,0),coalesce(x.months_9,0),coalesce(x.months_12,0),coalesce(x.months_18,0),
    coalesce(x.months_24,0),coalesce(x.remarks,''),coalesce(x.eligible_for_price_tag,false),coalesce(x.price_tag_status,''),v_uploaded_at
  from jsonb_to_recordset(p_products) as x(
    period text,source_file text,brand text,category text,barcode text,model text,srp numeric,cash_payment numeric,
    tag_this numeric,months_6 numeric,months_9 numeric,months_12 numeric,months_18 numeric,months_24 numeric,
    remarks text,eligible_for_price_tag boolean,price_tag_status text
  )
  where not v_promotion_pdf or not exists (
    select 1 from public.memo_products p where p.memo_id = v_memo.id
      and (p.barcode, p.model, p.remarks, p.srp, p.cash_payment, p.tag_this,
        p.months_6, p.months_9, p.months_12, p.months_18, p.months_24) is not distinct from
        (coalesce(x.barcode,''), coalesce(x.model,''), coalesce(x.remarks,''),
         coalesce(x.srp,0), coalesce(x.cash_payment,0), coalesce(x.tag_this,0),
         coalesce(x.months_6,0), coalesce(x.months_9,0), coalesce(x.months_12,0), coalesce(x.months_18,0), coalesce(x.months_24,0))
  );
  get diagnostics v_added=row_count;
  update public.price_memos
  set product_count=(select count(*) from public.memo_products where memo_id=v_memo.id)
  where id=v_memo.id;
  if not v_promotion_pdf then
    perform public.ptg_prune_memo_offers(p_branch_id);
  end if;
  select product_count into v_count from public.price_memos where id = v_memo.id;
  return jsonb_build_object('skipped',v_promotion_pdf and v_exists and v_added=0,'duplicate',v_exists,'totalProducts',v_count,'memoRecordId',v_memo.id);
end;
$function$;
revoke all on function public.import_price_memo(uuid,text,text,text,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_price_memo(uuid,text,text,text,text,uuid,text,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.ptg_pdf_promotion_current(p_memo_id text, p_period text)
returns boolean language sql stable set search_path = '' as $$
  select p_memo_id !~ '^PDF-[0-9a-f]{64}$'
    or ((substring(p_period from '^([0-9]{4}-[0-9]{2}-[0-9]{2})')::date is null
      or substring(p_period from '^([0-9]{4}-[0-9]{2}-[0-9]{2})')::date <= (current_timestamp at time zone 'Asia/Manila')::date)
      and substring(p_period from '(?: to |^Until )([0-9]{4}-[0-9]{2}-[0-9]{2})$')::date >= (current_timestamp at time zone 'Asia/Manila')::date)
$$;
revoke all on function public.ptg_pdf_promotion_current(text,text) from public,anon,authenticated;
grant execute on function public.ptg_pdf_promotion_current(text,text) to service_role;

-- Keep the standard SRP searchable when a promotion PDF contains the same barcode.
CREATE OR REPLACE FUNCTION public.ptg_search_srp_fallback(p_query text, p_branch_id uuid, p_system_admin boolean)
 RETURNS TABLE(id uuid, barcode text, model text, brand text, srp numeric, sub_category text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select s.id, s.barcode, s.model_description,
    coalesce(nullif(trim(pm.brand), ''), upper(substring(s.model_description from '^([^[:space:]]+)')), ''),
    s.srp, coalesce(pm.sub_category, '')
  from public.product_srp s
  left join lateral (
    select m.brand, m.sub_category
    from public.product_master m
    where m.barcode in (s.barcode, public.ptg_srp_barcode_key(s.barcode),
      case when s.barcode ~ '^[0-9]+$' and length(public.ptg_srp_barcode_key(s.barcode)) <= 8
        then lpad(public.ptg_srp_barcode_key(s.barcode), 8, '0') end)
    order by (m.barcode = s.barcode) desc, m.barcode
    limit 1
  ) pm on true
  where not exists (
    select 1 from public.memo_products m
    join public.price_memos memo on memo.id = m.memo_id
    where public.ptg_srp_barcode_key(m.barcode) = public.ptg_srp_barcode_key(s.barcode)
      and (p_system_admin or memo.branch_id is null or memo.branch_id = p_branch_id)
      and not (memo.memo_id ~ '^PDF-[0-9a-f]{64}$' and memo.source_file ilike '%.pdf')
  )
  and (length(p_query) < 2
    or strpos(lower(s.barcode), lower(p_query)) > 0
    or (p_query ~ '^[0-9]+$' and public.ptg_srp_barcode_key(s.barcode) = public.ptg_srp_barcode_key(p_query))
    or strpos(lower(s.model_description), lower(p_query)) > 0
    or strpos(lower(pm.brand), lower(p_query)) > 0)
$function$;

CREATE OR REPLACE FUNCTION public.ptg_ordered_product_search(p_query text, p_branch_id uuid, p_system_admin boolean, p_page integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with input as (
    select lower(btrim(coalesce(p_query, ''))) as needle
  ), memo_rows as (
    select m.id, m.memo_id, memo.source_file, m.brand, m.category, m.barcode, m.model,
      case when memo.memo_id ~ '^PDF-[0-9a-f]{64}$' then m.model else coalesce(nullif(btrim(pm.description), ''), m.model) end as description,
      coalesce(pm.sub_category, '') as sub_category, m.srp, m.cash_payment,
      m.tag_this, m.months_6, m.months_9, m.months_12, m.months_18, m.months_24,
      m.remarks, m.eligible_for_price_tag, m.price_tag_status,
      jsonb_build_object('branch_id', memo.branch_id, 'memo_id', memo.memo_id, 'period', memo.period,
        'memo_type', memo.memo_type, 'created_at', memo.imported_at, 'source_file', memo.source_file) as price_memos
    from public.memo_products m
    join public.price_memos memo on memo.id = m.memo_id
    left join lateral (
      select p.description, p.sub_category
      from public.product_master p
      where p.barcode in (m.barcode, public.ptg_srp_barcode_key(m.barcode),
        case when m.barcode ~ '^[0-9]+$' and length(public.ptg_srp_barcode_key(m.barcode)) <= 8
          then lpad(public.ptg_srp_barcode_key(m.barcode), 8, '0') end)
      order by (p.barcode = m.barcode) desc, p.barcode
      limit 1
    ) pm on true
    cross join input i
    where (p_system_admin or memo.branch_id is null or memo.branch_id = p_branch_id)
      and public.ptg_pdf_promotion_current(memo.memo_id, memo.period)
      and (length(i.needle) < 2 or strpos(lower(m.barcode), i.needle) > 0
        or strpos(lower(m.brand), i.needle) > 0 or strpos(lower(m.model), i.needle) > 0
        or strpos(lower(pm.description), i.needle) > 0
        or (i.needle ~ '^[0-9]+$' and public.ptg_srp_barcode_key(m.barcode) = public.ptg_srp_barcode_key(i.needle)))
  ), srp_rows as (
    select s.id, s.barcode, s.model, s.brand, s.srp, s.sub_category,
      coalesce(nullif(btrim(pm.description), ''), s.model) as description
    from public.ptg_search_srp_fallback((select needle from input), p_branch_id, p_system_admin) s
    left join lateral (
      select p.description
      from public.product_master p
      where p.barcode in (s.barcode, public.ptg_srp_barcode_key(s.barcode),
        case when s.barcode ~ '^[0-9]+$' and length(public.ptg_srp_barcode_key(s.barcode)) <= 8
          then lpad(public.ptg_srp_barcode_key(s.barcode), 8, '0') end)
      order by (p.barcode = s.barcode) desc, p.barcode
      limit 1
    ) pm on true
  ), products as (
    select 0 as source, m.id, m.brand, m.model, m.description, m.category, m.sub_category, m.remarks, to_jsonb(m) as payload
    from memo_rows m
    union all
    select 1, s.id, s.brand, s.model, s.description, '', s.sub_category, '', to_jsonb(s) ||
      jsonb_build_object('cash_payment', s.srp, 'tag_this', s.srp, 'eligible_for_price_tag', false,
        'price_tag_status', 'SRP ONLY', 'price_memos', null)
    from srp_rows s
  ), aircon_models as (
    select p.*,
      length(i.needle) >= 2 and concat_ws(' ', p.sub_category, p.description, p.model) ~* 'SPLIT[ -]+TYPE' as is_split,
      length(i.needle) >= 2 and concat_ws(' ', p.category, p.sub_category, p.description, p.model)
        ~* '\m(AIR[ -]*CON(DITIONER|DITIONING)?|SPLIT[ -]+TYPE)\M' as is_aircon,
      concat_ws(' ', p.description, p.model) ~* '\mOUTDOOR\M' as is_outdoor,
      upper(coalesce(nullif(p.description, ''), p.model, '')) as model_text
    from products p cross join input i
  ), sort_keys as (
    select p.*,
      case when p.is_aircon then
        trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(p.model_text,
          '[0-9]+([.][0-9]+)?[[:space:]]*HP\y', '', 'g'),
          '\m(?=[A-Z0-9/-]*[A-Z])(?=[A-Z0-9/-]*[0-9])[A-Z0-9]+([/-][A-Z0-9]+)*\M', '', 'g'),
          '\m(INDOOR|OUTDOOR)([[:space:]]+UNIT)?\M', '', 'g'),
          '[[:space:]]+', ' ', 'g')) end as family,
      case when p.is_aircon then substring(concat_ws(' ', p.description, p.model)
        from '(?i)\m([0-9]+(?:[.][0-9]+)?)[[:space:]]*HP\y')::numeric end as capacity,
      case when p.is_aircon then case
        when p.is_outdoor then 2
        when p.remarks ~* 'UNIT[ -]+ONLY|WITHOUT[[:space:]]+INSTALLATION|NO[[:space:]]+INSTALLATION' then 1
        when p.remarks ~* 'INSTALLATION' then 0
        else 3 end end as installation
    from aircon_models p
  ), ordered as (
    select p.payload, row_number() over (order by case when p.is_split then 0 when p.is_aircon then 1 else p.source + 2 end,
      upper(p.brand), p.family nulls last, p.capacity nulls last, p.installation nulls last,
      p.source, upper(p.model), p.id) as position
    from sort_keys p
  )
  select jsonb_build_object('total', count(*), 'products',
    coalesce(jsonb_agg(payload order by position) filter (where position between
      (greatest(1, least(p_page, 1000000)) - 1) * 5 + 1 and greatest(1, least(p_page, 1000000)) * 5), '[]'::jsonb))
  from ordered
$function$;

notify pgrst,'reload schema';
