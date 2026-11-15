-- Import the SUBDEALER category independently of monthly/regular/7MBDS prices.
-- Newest memo for an updated barcode replaces ONLY the older SUBDEALER row(s).
-- Old prices for other barcodes remain even after their stated PDF period.
-- Empty superseded SUBDEALER headers are deleted; audit history remains.

create or replace function public.import_subdealer_price_memo(
  p_memo_id text, p_period text, p_source_file text, p_imported_by uuid,
  p_duplicate_action text, p_products jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $body$
declare
  v_start date;
  v_result jsonb;
  v_new_id uuid;
  v_removed int := 0;
  v_empties text[];
  v_incoming text[];
begin
  if p_memo_id is null or btrim(p_memo_id) = ''
     or p_memo_id !~ '^(SUBCON-[0-9]+|SUBD?20[0-9]{2}-[0-9]+)$'
     or p_duplicate_action not in ('SKIP', 'REPLACE')
     or jsonb_typeof(p_products) <> 'array' or jsonb_array_length(p_products) = 0
     or jsonb_array_length(p_products) > 10000 then
    raise exception 'Invalid subdealer memo import input';
  end if;
  v_start := public.ptg_period_start(p_period);
  if v_start is null or public.ptg_period_end(p_period) is null then
    raise exception 'Subdealer memo needs readable start/end dates';
  end if;
  select array_agg(distinct public.ptg_srp_barcode_key(x->>'barcode'))
  into v_incoming from jsonb_array_elements(p_products) x;
  if array_length(v_incoming,1) <> jsonb_array_length(p_products) then
    raise exception 'Duplicate barcode in subdealer memo';
  end if;
  if exists (select 1 from unnest(v_incoming) code where code is null or code = '') then
    raise exception 'A subdealer product barcode is blank';
  end if;

  -- Serialize overlapping memo imports and inspect current per-product prices.
  perform pg_advisory_xact_lock(20261108, 107);
  if exists (
    select 1 from public.memo_products item
    join public.price_memos old on old.id=item.memo_id
    join public.ptg_memo_campaigns campaign on campaign.memo_number=old.memo_id
    where campaign.campaign='SUBDEALER'
      and public.ptg_srp_barcode_key(item.barcode)=any(v_incoming)
      and public.ptg_period_start(old.period)>v_start
      and old.memo_id <> p_memo_id
  ) then
    raise exception 'A newer subdealer price already exists for one or more products; older memo not imported';
  end if;

  -- Replacing an existing memo must not remove unsubmitted products from it.
  if p_duplicate_action='REPLACE' and exists (
    select 1 from public.memo_products item
    join public.price_memos old on old.id=item.memo_id
    join public.ptg_memo_campaigns campaign on campaign.memo_number=old.memo_id
    where campaign.campaign='SUBDEALER'
      and old.memo_id=p_memo_id
      and public.ptg_srp_barcode_key(item.barcode) <> all(v_incoming)
  ) then
    raise exception 'Partial replacement of the same memo would discard unaffected products';
  end if;

  v_result := public.import_price_memo(
    null::uuid, p_memo_id, p_period, 'MEMO_LIST', p_source_file,
    p_imported_by, p_duplicate_action, p_products, 'SUBDEALER'
  );
  if (v_result->>'skipped')::boolean then
    return v_result || jsonb_build_object('supersededProductsRemoved',0);
  end if;
  v_new_id := (v_result->>'memoRecordId')::uuid;

  delete from public.memo_products item using public.price_memos old,
    public.ptg_memo_campaigns campaign
  where item.memo_id=old.id
    and campaign.memo_number=old.memo_id and campaign.campaign='SUBDEALER'
    and old.id<>v_new_id
    and public.ptg_srp_barcode_key(item.barcode)=any(v_incoming);
  get diagnostics v_removed = row_count;

  update public.price_memos old set product_count=(
    select count(*) from public.memo_products item where item.memo_id=old.id
  ) where old.memo_id in (
    select campaign.memo_number from public.ptg_memo_campaigns campaign
    where campaign.campaign='SUBDEALER'
  );

  select array_agg(old.memo_id) into v_empties
  from public.price_memos old
  join public.ptg_memo_campaigns campaign
    on campaign.memo_number=old.memo_id and campaign.campaign='SUBDEALER'
  where old.id<>v_new_id and old.product_count=0;
  if coalesce(array_length(v_empties,1),0)>0 then
    delete from public.price_memos where memo_id=any(v_empties);
    delete from public.ptg_memo_campaigns where memo_number=any(v_empties)
      and campaign='SUBDEALER';
  end if;
  return v_result || jsonb_build_object('supersededProductsRemoved',v_removed,
    'emptiedMemosDeleted',coalesce(array_length(v_empties,1),0));
end;
$body$;

revoke all on function public.import_subdealer_price_memo(text,text,text,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.import_subdealer_price_memo(text,text,text,uuid,text,jsonb)
  to service_role;
