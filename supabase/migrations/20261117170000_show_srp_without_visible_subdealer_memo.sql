-- SRP-only products remain visible when the ONLY matching memo is a
-- private Subdealer campaign, unless another normal memo controls the price.
-- Do not expose Subdealer memo prices while its filter is unchecked.
-- This preserves the existing branch-aware, PDF, and search conditions.

DO $patch_srp_subdealer$
DECLARE
  fn_oid oid;
  old_definition text;
  new_definition text;
  anchor text := '      and not (memo.memo_id ~ ''^PDF-[0-9a-f]{64}$'' and memo.source_file ilike ''%.pdf'')';
  new_clause text := '      and not exists (
        select 1 from public.ptg_memo_campaigns c
        where c.memo_number = memo.memo_id
          and c.campaign = ''SUBDEALER''
          and memo.branch_id is null
      )
';
BEGIN
  SELECT p.oid INTO fn_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='ptg_search_srp_fallback' AND p.pronargs=3;
  IF fn_oid IS NULL THEN
    RAISE EXCEPTION 'PTG SRP fallback routine is missing';
  END IF;

  old_definition := pg_catalog.pg_get_functiondef(fn_oid);
  IF pg_catalog.strpos(old_definition, anchor)=0
     OR pg_catalog.strpos(old_definition, 'public.memo_products m')=0
     OR pg_catalog.strpos(old_definition, new_clause)>0 THEN
    RAISE EXCEPTION 'Unexpected PTG SRP fallback version: migration not applied';
  END IF;
  new_definition := pg_catalog.replace(old_definition, anchor, new_clause || anchor);
  EXECUTE new_definition;
END
$patch_srp_subdealer$;

NOTIFY pgrst, 'reload schema';
