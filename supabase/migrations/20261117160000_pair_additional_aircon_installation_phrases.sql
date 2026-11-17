-- Cover two additional verified Head Office aircon memo spellings:
-- SAMSUNG: "FREE 10FT FIRST INSTALLATION", CARRIER: "FREE 10F. INSTALLATION".
-- Preserve exact memo, barcode, package suffix, price and installment terms.
-- Uses the same existing pairing rule for every brand.

DO $pair_extra_aircon$
DECLARE
  fn record;
  function_sql text;
  changed integer := 0;
  previous_leading text := '((FIRST|1ST)[[:space:]]+)?10[[:space:]]*(FT|FEET)[[:space:].]*INSTALLATION';
  expanded_leading text := '((FIRST|1ST)[[:space:]]+)?10[[:space:]]*(FT|FEET|F)[[:space:].]*((FIRST|1ST)[[:space:]]+)?INSTALLATION';
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND ((p.proname = 'ptg_ordered_product_search' AND p.pronargs = 8)
        OR (p.proname = 'ptg_ordered_product_search_secure' AND p.pronargs = 9))
  LOOP
    function_sql := pg_catalog.pg_get_functiondef(fn.oid);
    IF pg_catalog.strpos(function_sql, previous_leading) = 0 THEN
      RAISE EXCEPTION 'Unexpected PTG pairing function version: %', fn.proname;
    END IF;
    function_sql := pg_catalog.replace(function_sql, previous_leading, expanded_leading);
    EXECUTE function_sql;
    changed := changed + 1;
  END LOOP;
  IF changed <> 2 THEN
    RAISE EXCEPTION 'Expected two PTG pairing functions; found %', changed;
  END IF;
END
$pair_extra_aircon$;

NOTIFY pgrst, 'reload schema';
