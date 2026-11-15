-- DEVELOPMENT ONLY: after migrations 20261115020000 and 20261115030000.
-- Test on an isolated DB branch; no historical cleanup runs at migration time.
create or replace function public.ptg_period_end(v text)
returns date language plpgsql stable set search_path to '' as $$
declare result text;
begin
 result:=substring(btrim(v) from '([A-Za-z]+[[:space:]]+[0-9]{1,2},?[[:space:]]+[0-9]{4})$');
 if result is null then result:=substring(btrim(v) from '([0-9]{4}-[0-9]{2}-[0-9]{2})$'); end if;
 return result::date;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end; $$;

-- Removes only older, matching monthly price rows after a successful import.
-- A campaign, PDF, future memo, or short/unknown-period memo never initiates cleanup.
create or replace function public.ptg_cleanup_after_import(new_id uuid)
returns integer language plpgsql security definer set search_path to '' as $$
declare
 h public.price_memos%rowtype;
 old_id uuid;
 n integer;
 total integer:=0;
begin
 select * into h from public.price_memos where id=new_id;
 if not found then raise exception 'Memo not found'; end if;
 if h.memo_id ~ '^PDF-[0-9a-f]{64}$'
    or coalesce(current_setting('ptg.import_campaign',true),'')<>''
    or exists(select 1 from public.ptg_memo_campaigns c where c.memo_number=h.memo_id)
    or (public.ptg_period_start(h.period)=date '2026-11-14' and public.ptg_period_end(h.period)=date '2026-11-22')
    or public.ptg_period_end(h.period)-public.ptg_period_start(h.period)<20
    or public.ptg_period_end(h.period) is null
    or public.ptg_period_start(h.period)>(current_timestamp at time zone 'Asia/Manila')::date
 then return 0; end if;
 for old_id in
   select distinct old.memo_id
   from public.memo_products old
   join public.price_memos om on om.id=old.memo_id
   join public.memo_products fresh on fresh.memo_id=new_id
   where old.memo_id<>new_id and om.branch_id is not distinct from h.branch_id
     and om.memo_id !~ '^PDF-[0-9a-f]{64}$'
     and not exists(select 1 from public.ptg_memo_campaigns c where c.memo_number=om.memo_id)
     and not (public.ptg_period_start(om.period)=date '2026-11-14' and public.ptg_period_end(om.period)=date '2026-11-22')
     and public.ptg_period_start(om.period)<=public.ptg_period_start(h.period)
     and om.imported_at<h.imported_at
     and public.ptg_srp_barcode_key(old.barcode)=public.ptg_srp_barcode_key(fresh.barcode)
 loop
   delete from public.memo_products old using public.memo_products fresh
    where old.memo_id=old_id and fresh.memo_id=new_id
      and public.ptg_srp_barcode_key(old.barcode)=public.ptg_srp_barcode_key(fresh.barcode);
   get diagnostics n=row_count;
   total:=total+n;
   update public.price_memos m set product_count=(select count(*) from public.memo_products p where p.memo_id=m.id)
     where m.id=old_id;
   if not exists(select 1 from public.memo_products where memo_id=old_id) then
     insert into public.security_audit_logs(actor_user_id,branch_id,event_category,action,target_identifier,outcome,message,metadata)
     select h.imported_by,h.branch_id,'PRICE_MEMO','AUTO_SUPERSEDE',memo_id,'SUCCESS',
       'Monthly memo superseded',jsonb_build_object('replaced_by',h.memo_id,'removed_rows',n)
     from public.price_memos where id=old_id;
     delete from public.price_memos where id=old_id;
   end if;
 end loop;
 return total;
end; $$;
revoke all on function public.ptg_cleanup_after_import(uuid) from public,anon,authenticated;
grant execute on function public.ptg_cleanup_after_import(uuid) to service_role;


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
begin
  if p_duplicate_action not in ('SKIP','REPLACE') then raise exception 'Invalid duplicate action'; end if;
  if p_memo_type not in ('MEMO_LIST','KIOSK_MEMO_LIST') then raise exception 'Invalid memo type'; end if;
  if p_memo_id is null or btrim(p_memo_id) = '' then raise exception 'Memo number is required'; end if;
  if jsonb_typeof(p_products) <> 'array' then raise exception 'Products must be a JSON array'; end if;

  if p_memo_id ~ '^PDF-[0-9a-f]{64}$' and coalesce(p_source_file, '') ilike '%.pdf' then
    raise exception 'Direct PDF promotion imports are unavailable.';
  end if;

  perform pg_advisory_xact_lock(20261108, 107);
  v_uploaded_at := clock_timestamp();
  v_start := public.ptg_period_start(p_period);
  if v_start is null then
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
  perform public.ptg_cleanup_after_import(v_memo.id);
  return jsonb_build_object('skipped',false,'duplicate',v_exists,'totalProducts',v_count,'memoRecordId',v_memo.id);
end;
$function$;

create or replace function public.import_price_memo(
  p_branch_id uuid, p_memo_id text, p_period text, p_memo_type text,
  p_source_file text, p_imported_by uuid, p_duplicate_action text,
  p_products jsonb, p_campaign text
)
returns jsonb language plpgsql set search_path = '' as $function$
declare
  result jsonb;
  campaign_name text := nullif(upper(btrim(regexp_replace(p_campaign, '[[:space:]]+', ' ', 'g'))), '');
begin
  if length(campaign_name) > 80 or (campaign_name is not null and p_branch_id is not null) then
    raise exception 'A campaign name of at most 80 characters is allowed for shared memos';
  end if;
  perform set_config('ptg.import_campaign',coalesce(campaign_name,''),true);
  result := public.import_price_memo(
    p_branch_id, p_memo_id, p_period, p_memo_type, p_source_file,
    p_imported_by, p_duplicate_action, p_products
  );
  if campaign_name is not null and (result->>'skipped')::boolean is false then
    insert into public.ptg_memo_campaigns (memo_number, campaign)
    values (p_memo_id, campaign_name)
    on conflict (memo_number) do update set campaign = excluded.campaign;
  end if;
  perform set_config('ptg.import_campaign','',true);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ptg_ordered_product_search(p_query text, p_branch_id uuid, p_system_admin boolean, p_page integer, p_stock_barcodes text[], p_promotions_only boolean, p_campaign text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with input as (
    select lower(btrim(coalesce(p_query, ''))) as needle
  ), memo_candidates as (
    select m.id, m.memo_id, memo.source_file, m.brand, m.category, m.barcode, m.model,
      case when memo.memo_id ~ '^PDF-[0-9a-f]{64}$' then m.model else coalesce(nullif(btrim(pm.description), ''), m.model) end as description,
      coalesce(pm.sub_category, '') as sub_category, m.srp, m.cash_payment,
      m.tag_this, m.months_6, m.months_9, m.months_12, m.months_18, m.months_24,
      m.remarks, m.eligible_for_price_tag, m.price_tag_status,
      campaign.campaign,
      jsonb_build_object('branch_id', memo.branch_id, 'memo_id', memo.memo_id, 'period', memo.period,
        'memo_type', memo.memo_type, 'created_at', memo.imported_at, 'source_file', memo.source_file) as price_memos
    from public.memo_products m
    join public.price_memos memo on memo.id = m.memo_id
    left join public.ptg_memo_campaigns campaign on campaign.memo_number = memo.memo_id and memo.branch_id is null
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
      and (not p_promotions_only or (campaign.campaign is not null
        and (p_campaign is null or campaign.campaign = p_campaign)))
      and public.ptg_pdf_promotion_current(memo.memo_id, memo.period)
      and (memo.memo_id ~ '^PDF-[0-9a-f]{64}$'
        or (campaign.campaign is null and public.ptg_period_start(memo.period)
          <= (current_timestamp at time zone 'Asia/Manila')::date)
        or (campaign.campaign is not null and
          (current_timestamp at time zone 'Asia/Manila')::date
          between public.ptg_period_start(memo.period) and public.ptg_period_end(memo.period)))
      and (length(i.needle) < 2 or strpos(lower(m.barcode), i.needle) > 0
        or strpos(lower(m.brand), i.needle) > 0 or strpos(lower(m.model), i.needle) > 0
        or strpos(lower(pm.description), i.needle) > 0
        or (i.needle ~ '^[0-9]+$' and public.ptg_srp_barcode_key(m.barcode) = public.ptg_srp_barcode_key(i.needle)))
  ), memo_rows as (
    select r.id,r.memo_id,r.source_file,r.brand,r.category,r.barcode,r.model,r.description,
      r.sub_category,r.srp,r.cash_payment,r.tag_this,r.months_6,r.months_9,r.months_12,
      r.months_18,r.months_24,r.remarks,r.eligible_for_price_tag,r.price_tag_status,
      r.campaign,r.price_memos
    from (
      select c.*, dense_rank() over (
        partition by case when (c.price_memos->>'memo_id') ~ '^PDF-[0-9a-f]{64}$'
          then c.id::text else public.ptg_srp_barcode_key(c.barcode) end
        order by case when c.campaign is not null then 0 else 1 end,
          public.ptg_period_start(c.price_memos->>'period') desc nulls last,
          (c.price_memos->>'created_at')::timestamptz desc,
          c.memo_id desc
      ) as rank_for_ptg from memo_candidates c
    ) r where r.rank_for_ptg=1 or (p_promotions_only and r.campaign is not null)
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
    where not p_promotions_only
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
    where p_stock_barcodes is null or public.ptg_srp_barcode_key(p.payload->>'barcode') = any(p_stock_barcodes)
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
  select jsonb_build_object('total', count(*), 'campaigns', (
      select coalesce(jsonb_agg(distinct c.campaign order by c.campaign), '[]'::jsonb)
      from public.ptg_memo_campaigns c
      join public.price_memos m on m.memo_id = c.memo_number and m.branch_id is null
      where m.product_count > 0
    ), 'products',
    coalesce(jsonb_agg(payload order by position) filter (where position between
      (greatest(1, least(p_page, 1000000)) - 1) * 5 + 1 and greatest(1, least(p_page, 1000000)) * 5), '[]'::jsonb))
  from ordered
$function$;


notify pgrst, 'reload schema';
