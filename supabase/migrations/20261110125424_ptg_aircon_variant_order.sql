create or replace function public.ptg_ordered_product_search(p_query text, p_branch_id uuid, p_system_admin boolean, p_page integer)
returns jsonb language sql stable set search_path = ''
as $$
  with input as (
    select lower(btrim(coalesce(p_query, ''))) as needle
  ), memo_rows as (
    select m.id, m.memo_id, m.brand, m.category, m.barcode, m.model,
      coalesce(nullif(btrim(pm.description), ''), m.model) as description,
      coalesce(pm.sub_category, '') as sub_category, m.srp, m.cash_payment,
      m.tag_this, m.months_6, m.months_9, m.months_12, m.months_18, m.months_24,
      m.remarks, m.eligible_for_price_tag, m.price_tag_status,
      jsonb_build_object('branch_id', memo.branch_id, 'memo_id', memo.memo_id, 'period', memo.period,
        'memo_type', memo.memo_type, 'created_at', memo.imported_at) as price_memos
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
      upper(coalesce(nullif(p.description, ''), p.model, '')) as model_text
    from products p cross join input i
  ), sort_keys as (
    select p.*,
      case when p.is_aircon then
        trim(regexp_replace(regexp_replace(regexp_replace(p.model_text,
          '[0-9]+([.][0-9]+)?[[:space:]]*HP\y', '', 'g'),
          '\m(?=[A-Z0-9/-]*[A-Z])(?=[A-Z0-9/-]*[0-9])[A-Z0-9]+([/-][A-Z0-9]+)*\M', '', 'g'),
          '[[:space:]]+', ' ', 'g')) end as family,
      case when p.is_aircon then substring(concat_ws(' ', p.description, p.model)
        from '(?i)\m([0-9]+(?:[.][0-9]+)?)[[:space:]]*HP\y')::numeric end as capacity,
      case when p.is_aircon then case
        when p.remarks ~* 'UNIT[ -]+ONLY|WITHOUT[[:space:]]+INSTALLATION|NO[[:space:]]+INSTALLATION' then 1
        when p.remarks ~* 'INSTALLATION' then 0
        else 2 end end as installation
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
$$;

notify pgrst, 'reload schema';
