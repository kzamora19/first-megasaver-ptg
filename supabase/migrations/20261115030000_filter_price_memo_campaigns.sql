create table public.ptg_memo_campaigns (
  memo_number text primary key,
  campaign text not null check (length(campaign) between 1 and 80)
);
alter table public.ptg_memo_campaigns enable row level security;
revoke all on public.ptg_memo_campaigns from public, anon, authenticated;
grant select, insert, update on public.ptg_memo_campaigns to service_role;

-- Verified November 14–22 campaign workbook IDs, including files pending import.
insert into public.ptg_memo_campaigns (memo_number, campaign)
values
  ('APPS-00001632-261114-261122', '7MBDS'),
  ('CAM01-00001616-261114-261122', '7MBDS'),
  ('CONC1-00001585-261114-261122', '7MBDS'),
  ('CONC1-00001586-261114-261122', '7MBDS'),
  ('CONI1-00001607-261114-261122', '7MBDS'),
  ('CONMI-00001591-261114-261122', '7MBDS'),
  ('CONMI-00001605-261114-261122', '7MBDS'),
  ('CONT1-00001596-261114-261122', '7MBDS'),
  ('CONT1-00001614-261114-261122', '7MBDS'),
  ('CONT1-00001622-261114-261122', '7MBDS'),
  ('CSC-00001604-261114-261122', '7MBDS'),
  ('CSC-00001623-261114-261122', '7MBDS'),
  ('DAIKI-00001587-261114-261122', '7MBDS'),
  ('EURO-00001588-261114-261122', '7MBDS'),
  ('EURO-00001600-261114-261122', '7MBDS'),
  ('EXC01-00001589-261114-261122', '7MBDS'),
  ('EXC01-00001601-261114-261122', '7MBDS'),
  ('EXC01-00001602-261114-261122', '7MBDS'),
  ('EXC01-00001620-261114-261122', '7MBDS'),
  ('EXC01-00001635-261114-261122', '7MBDS'),
  ('LGC01-00001597-261114-261122', '7MBDS'),
  ('LGC01-00001608-261114-261122', '7MBDS'),
  ('LGC01-00001609-261114-261122', '7MBDS'),
  ('LGC01-00001625-261114-261122', '7MBDS'),
  ('MGME1-00001624-261114-261122', '7MBDS'),
  ('NIKON-00001615-261114-261122', '7MBDS'),
  ('ONEPH-00001617-261114-261122', '7MBDS'),
  ('PMP-00001592-261114-261122', '7MBDS'),
  ('PMP-00001612-261114-261122', '7MBDS'),
  ('SAM01-00001593-261114-261122', '7MBDS'),
  ('SAM01-00001610-261114-261122', '7MBDS'),
  ('SAM01-00001611-261114-261122', '7MBDS'),
  ('SAM01-00001627-261114-261122', '7MBDS'),
  ('SANYO-00001590-261114-261122', '7MBDS'),
  ('SANYO-00001613-261114-261122', '7MBDS'),
  ('SANYO-00001621-261114-261122', '7MBDS'),
  ('SHA01-00001594-261114-261122', '7MBDS'),
  ('SHA01-00001606-261114-261122', '7MBDS'),
  ('SHA01-00001628-261114-261122', '7MBDS'),
  ('SKY-00001629-261114-261122', '7MBDS'),
  ('SON01-00001630-261114-261122', '7MBDS'),
  ('TCL01-00001595-261114-261122', '7MBDS'),
  ('TCL01-00001598-261114-261122', '7MBDS'),
  ('TCL01-00001599-261114-261122', '7MBDS'),
  ('TCL01-00001631-261114-261122', '7MBDS'),
  ('TPENT-00001618-261114-261122', '7MBDS'),
  ('TRECO-00001636-261114-261122', '7MBDS'),
  ('UG-00001603-261114-261122', '7MBDS'),
  ('UG-00001634-261114-261122', '7MBDS'),
  ('VISMA-00001626-261114-261122', '7MBDS'),
  ('YFCBI-00001619-261114-261122', '7MBDS');

create function public.import_price_memo(
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
  result := public.import_price_memo(
    p_branch_id, p_memo_id, p_period, p_memo_type, p_source_file,
    p_imported_by, p_duplicate_action, p_products
  );
  if campaign_name is not null and (result->>'skipped')::boolean is false then
    insert into public.ptg_memo_campaigns (memo_number, campaign)
    values (p_memo_id, campaign_name)
    on conflict (memo_number) do update set campaign = excluded.campaign;
  end if;
  return result;
end;
$function$;
revoke all on function public.import_price_memo(uuid,text,text,text,text,uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.import_price_memo(uuid,text,text,text,text,uuid,text,jsonb,text) to service_role;

CREATE OR REPLACE FUNCTION public.ptg_ordered_product_search(p_query text, p_branch_id uuid, p_system_admin boolean, p_page integer, p_stock_barcodes text[], p_promotions_only boolean, p_campaign text)
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

revoke all on function public.ptg_ordered_product_search(text, uuid, boolean, integer, text[], boolean, text) from public, anon, authenticated;
grant execute on function public.ptg_ordered_product_search(text, uuid, boolean, integer, text[], boolean, text) to service_role;

create or replace function public.ptg_ordered_product_search(p_query text, p_branch_id uuid, p_system_admin boolean, p_page integer, p_stock_barcodes text[])
returns jsonb language sql stable set search_path to ''
as $function$
  select public.ptg_ordered_product_search(p_query, p_branch_id, p_system_admin, p_page, p_stock_barcodes, false, null);
$function$;

notify pgrst, 'reload schema';
