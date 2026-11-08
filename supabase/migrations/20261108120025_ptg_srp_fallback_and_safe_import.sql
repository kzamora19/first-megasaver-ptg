create function public.ptg_srp_barcode_key(barcode text)
returns text language sql immutable strict set search_path = ''
as $$
  select case when btrim(barcode) ~ '^[0-9]+$'
    then coalesce(nullif(ltrim(btrim(barcode), '0'), ''), '0')
    else upper(btrim(barcode)) end
$$;

create unique index product_srp_barcode_key_unique on public.product_srp (public.ptg_srp_barcode_key(barcode));
create index memo_products_srp_barcode_key on public.memo_products (public.ptg_srp_barcode_key(barcode));

create function public.ptg_import_srp(p_rows jsonb, p_source text)
returns integer language sql set search_path = ''
as $$
  with saved as (
    insert into public.product_srp (barcode, model_description, srp, source_file)
    select barcode, description, greatest(srp, 0), p_source
    from jsonb_to_recordset(p_rows) as row(barcode text, description text, srp numeric)
    on conflict (public.ptg_srp_barcode_key(barcode)) do update
      set barcode = excluded.barcode, model_description = excluded.model_description,
          srp = excluded.srp, source_file = excluded.source_file, import_date = now()
      where excluded.srp > 0
    returning 1
  )
  select count(*)::integer from saved
$$;

create function public.ptg_search_srp_fallback(p_query text, p_branch_id uuid, p_system_admin boolean)
returns table (id uuid, barcode text, model text, brand text, srp numeric, sub_category text)
language sql stable set search_path = ''
as $$
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
  )
  and (length(p_query) < 2
    or strpos(lower(s.barcode), lower(p_query)) > 0
    or (p_query ~ '^[0-9]+$' and public.ptg_srp_barcode_key(s.barcode) = public.ptg_srp_barcode_key(p_query))
    or strpos(lower(s.model_description), lower(p_query)) > 0
    or strpos(lower(pm.brand), lower(p_query)) > 0)
$$;

revoke execute on function public.ptg_srp_barcode_key(text), public.ptg_import_srp(jsonb, text),
  public.ptg_search_srp_fallback(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.ptg_srp_barcode_key(text), public.ptg_import_srp(jsonb, text),
  public.ptg_search_srp_fallback(text, uuid, boolean) to service_role;
