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
