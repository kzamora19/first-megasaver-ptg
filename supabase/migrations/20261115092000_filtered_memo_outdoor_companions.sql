-- Include only matching SRP-only outdoor companions for filtered indoor memo offers.
-- Based on current live function so 5-row search pagination remains unchanged.
-- AIRCON print renderer, prices, memo validity, and stock data are unchanged.
CREATE OR REPLACE FUNCTION public.ptg_ordered_product_search(p_query text, p_branch_id uuid, p_system_admin boolean, p_page integer, p_stock_barcodes text[], p_promotions_only boolean, p_campaign text, p_regular_only boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with input as (
    select lower(btrim(coalesce(p_query, ''))) as needle, (current_timestamp at time zone 'Asia/Manila')::date as today
  ), memo_periods as (
    select memo.*, public.ptg_period_start(memo.period) as opens_on,
      public.ptg_period_end(memo.period) as closes_on, c.campaign as named_campaign
    from public.price_memos memo
    left join public.ptg_memo_campaigns c on c.memo_number = memo.memo_id and memo.branch_id is null
    where p_system_admin or memo.branch_id is null or memo.branch_id = p_branch_id
  ), classified_memos as (
    select memo.*, coalesce(named_campaign, case
      when opens_on = date '2026-11-14' and closes_on = date '2026-11-22' then '7MBDS'
    end) as campaign
    from memo_periods memo
  ), scheduled_memos as (
    select memo.*, case
      when campaign = '7MBDS' and opens_on = date '2026-11-14' and closes_on = date '2026-11-22'
      then date '2026-11-16' else opens_on
    end as selling_starts_on
    from classified_memos memo
  ), memo_candidates as (
    select m.id, m.memo_id, memo.source_file, m.brand, m.category, m.barcode, m.model,
      coalesce(nullif(btrim(pm.description), ''), m.model) as description,
      coalesce(pm.sub_category, '') as sub_category, m.srp, m.cash_payment,
      m.tag_this, m.months_6, m.months_9, m.months_12, m.months_18, m.months_24,
      m.remarks, m.eligible_for_price_tag, m.price_tag_status,
      memo.campaign, memo.opens_on, memo.selling_starts_on, memo.closes_on, memo.imported_at,
      memo.campaign is not null and i.today < memo.selling_starts_on as early_print_only,
      public.ptg_srp_barcode_key(m.barcode) as barcode_key,
      (length(i.needle) < 2 or strpos(lower(m.barcode), i.needle) > 0
        or strpos(lower(m.brand), i.needle) > 0 or strpos(lower(m.model), i.needle) > 0
        or strpos(lower(pm.description), i.needle) > 0
        or (i.needle ~ '^[0-9]+$' and public.ptg_srp_barcode_key(m.barcode) = public.ptg_srp_barcode_key(i.needle))) as matches_query,
      jsonb_build_object('branch_id', memo.branch_id, 'memo_id', memo.memo_id, 'period', memo.period,
        'memo_type', memo.memo_type, 'created_at', memo.imported_at, 'source_file', memo.source_file) as price_memos
    from public.memo_products m
    join scheduled_memos memo on memo.id = m.memo_id
    left join lateral (
      select p.description, p.sub_category
      from public.product_master p
      where p.barcode in (m.barcode, public.ptg_srp_barcode_key(m.barcode),
        case when m.barcode ~ '^[0-9]+$' and length(public.ptg_srp_barcode_key(m.barcode)) <= 8
          then lpad(public.ptg_srp_barcode_key(m.barcode), 8, '0') end)
      order by
        (upper(btrim(coalesce(p.description, ''))) = upper(btrim(m.model))) asc,
        length(btrim(coalesce(p.description, ''))) desc,
        p.updated_at desc,
        (p.barcode = m.barcode) desc, p.barcode
      limit 1
    ) pm on true
    cross join input i
    where (not p_promotions_only or (memo.campaign is not null and (p_campaign is null or memo.campaign = p_campaign)))
      and (not p_regular_only or (memo.campaign is null and memo.memo_id !~ '^PDF-[0-9a-f]{64}$'))
      and public.ptg_pdf_promotion_current(memo.memo_id, memo.period)
      and (memo.memo_id ~ '^PDF-[0-9a-f]{64}$'
        or (memo.opens_on <= i.today and (memo.campaign is null or memo.closes_on >= i.today)))
  ), memo_rows as (
    select r.id,r.memo_id,r.source_file,r.brand,r.category,r.barcode,r.model,r.description,
      r.sub_category,r.srp,r.cash_payment,r.tag_this,r.months_6,r.months_9,r.months_12,
      r.months_18,r.months_24,r.remarks,r.eligible_for_price_tag,r.price_tag_status,
      r.campaign,r.selling_starts_on,r.closes_on as selling_ends_on,r.early_print_only,r.price_memos
    from (
      select c.*, dense_rank() over (
        partition by case when (c.price_memos->>'memo_id') ~ '^PDF-[0-9a-f]{64}$'
          then c.id::text else c.barcode_key end, c.campaign
        order by c.opens_on desc nulls last, c.imported_at desc, c.memo_id desc
      ) as offer_rank,
      bool_or(c.matches_query) over (partition by c.barcode_key) as barcode_matches
      from memo_candidates c
    ) r where (r.offer_rank = 1 or p_promotions_only)
      and (r.matches_query or (not p_promotions_only and r.barcode_matches))
  ), matched_indoor_models as (
    -- The memo filter applies to price offers; an SRP-only outdoor is a
    -- companion to the selected indoor model, not itself a memo offer.
    select distinct upper(btrim(m.brand)) as brand,
      public.ptg_aircon_model_key(m.brand, m.model) as model_key
    from memo_rows m
    where (upper(coalesce(m.category, '')) like '%AIRCON%'
           or upper(coalesce(m.description, '')) like '%AIRCON%')
      and upper(coalesce(m.description, '')) not like '%OUTDOOR%'
      and nullif(btrim(m.model), '') is not null
      and (p_stock_barcodes is null or public.ptg_srp_barcode_key(m.barcode) = any(p_stock_barcodes))
  ), srp_candidates as (
    -- Preserve existing unfiltered behavior and keyword search.
    select s.* from public.ptg_search_srp_fallback(
      (select needle from input), p_branch_id, p_system_admin
    ) s
    where not p_promotions_only and not p_regular_only
    union all
    -- With a memo filter, include ONLY outdoor units that pair with an
    -- indoor memo offer surviving that filter. Search terms need not
    -- occur in the different outdoor model code (LG HSN vs HSU).
    select s.* from public.ptg_search_srp_fallback(
      ''::text, p_branch_id, p_system_admin
    ) s
    where (p_promotions_only or p_regular_only)
      and upper(s.model) like '%OUTDOOR%'
      and exists (
        select 1 from matched_indoor_models m
        where m.brand = upper(btrim(s.brand))
          and m.model_key = public.ptg_aircon_model_key(s.brand, s.model)
      )
  ), srp_rows as (
    select s.id, s.barcode, s.model, s.brand, s.srp, s.sub_category,
      coalesce(nullif(btrim(pm.description), ''), s.model) as description
    from srp_candidates s
    left join lateral (
      select p.description
      from public.product_master p
      where p.barcode in (s.barcode, public.ptg_srp_barcode_key(s.barcode),
        case when s.barcode ~ '^[0-9]+$' and length(public.ptg_srp_barcode_key(s.barcode)) <= 8
          then lpad(public.ptg_srp_barcode_key(s.barcode), 8, '0') end)
      order by
        (upper(btrim(coalesce(p.description, ''))) = upper(btrim(s.model))) asc,
        length(btrim(coalesce(p.description, ''))) desc,
        p.updated_at desc,
        (p.barcode = s.barcode) desc, p.barcode
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
    where p_stock_barcodes is null or public.ptg_srp_barcode_key(p.payload->>'barcode') = any(p_stock_barcodes)
  ), sort_keys as (
    select p.*,
      case when p.is_aircon then
        public.ptg_aircon_family_key(p.brand, p.model) end as family,
      case when p.is_aircon then public.ptg_aircon_model_key(p.brand, p.model) end as model_key,
      case when p.is_aircon then substring(concat_ws(' ', p.description, p.model)
        from '(?i)\m([0-9]+(?:[.][0-9]+)?)[[:space:]]*HP\y')::numeric end as capacity,
      case when p.is_aircon then case
        when p.is_outdoor then 2
        when p.remarks ~* 'UNIT[ -]+ONLY|WITHOUT[[:space:]]+INSTALLATION|NO[[:space:]]+INSTALLATION' then 1
        when p.remarks ~* 'INSTALLATION' then 0
        else 3 end end as installation
    from aircon_models p
  ), ordered as (
    select p.payload, p.is_outdoor, case
      when p.payload->>'campaign' = '7MBDS' then 2
      when p.payload->>'campaign' is not null or (p.payload->'price_memos'->>'memo_id') ~ '^PDF-[0-9a-f]{64}$' then 1
      else 0
    end as offer_position,
    row_number() over (order by case when p.is_split then 0 when p.is_aircon then 1 else p.source + 2 end,
      upper(p.brand), p.family nulls last, p.capacity nulls last, p.model_key nulls last,
      p.is_outdoor, p.installation nulls last,
      p.source, upper(p.model), p.id) as position
    from sort_keys p
  ), grouped as (
    select *, min(position) over (partition by public.ptg_srp_barcode_key(payload->>'barcode')) as first_position
    from ordered
  ), paged as (
    -- Exactly five offer rows per search page, rather than five barcodes.
    -- Keep family, capacity, model and offer ordering unchanged.
    select *, row_number() over (order by first_position, offer_position, position) as result_position
    from grouped
  )
  select jsonb_build_object('total', coalesce(max(result_position), 0), 'campaigns', (
      select coalesce(jsonb_agg(distinct m.campaign order by m.campaign), '[]'::jsonb)
      from scheduled_memos m cross join input i
      where m.product_count > 0 and m.campaign is not null and i.today between m.opens_on and m.closes_on
    ), 'products',
    coalesce(jsonb_agg(payload order by result_position)
      filter (where result_position between
      (greatest(1, least(p_page, 1000000)) - 1) * 5 + 1 and greatest(1, least(p_page, 1000000)) * 5), '[]'::jsonb))
  from paged
$function$;
revoke all on function public.ptg_ordered_product_search(text, uuid, boolean, integer, text[], boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.ptg_ordered_product_search(text, uuid, boolean, integer, text[], boolean, text, boolean) to service_role;
notify pgrst, 'reload schema';
