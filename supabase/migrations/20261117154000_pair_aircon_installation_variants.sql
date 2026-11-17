-- Pair matching aircon installation and unit-only offers regardless of
-- common "FIRST"/"1ST" and "10FT." memo wording variations.
-- This adjusts only the search presentation function; source memo rows,
-- approved prices, installments, campaign scope, and print queue IDs remain intact.
-- Patch both regular and secure/subdealer search functions identically.

DO $pair_aircon$
DECLARE
  fn record;
  function_sql text;
  changed integer := 0;
  previous_leading text := '(FIRST[[:space:]]+)?10[[:space:]]*(FT|FEET)[[:space:]]*INSTALLATION';
  expanded_leading text := '((FIRST|1ST)[[:space:]]+)?10[[:space:]]*(FT|FEET)[[:space:].]*INSTALLATION';
  previous_trailing text := 'INSTALLATION([[:space:]]+1ST)?[[:space:]]+10[[:space:]]*(FT|FEET)';
  expanded_trailing text := 'INSTALLATION[[:space:]]+((1ST|FIRST)[[:space:]]+)?10[[:space:]]*(FT|FEET)';
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
    -- Fail without changing anything if the function's underlying pairing
    -- logic has drifted; avoid silently overriding newer application behavior.
    IF pg_catalog.strpos(function_sql, previous_leading) = 0
       OR pg_catalog.strpos(function_sql, previous_trailing) = 0 THEN
      RAISE EXCEPTION 'Unsupported PTG pairing function version: %', fn.proname;
    END IF;
    function_sql := pg_catalog.replace(
      pg_catalog.replace(function_sql, previous_leading, expanded_leading),
      previous_trailing, expanded_trailing
    );
    EXECUTE function_sql;
    changed := changed + 1;
  END LOOP;

  IF changed <> 2 THEN
    RAISE EXCEPTION 'Expected two PTG pairing functions; found %', changed;
  END IF;
END
$pair_aircon$;

NOTIFY pgrst, 'reload schema';
