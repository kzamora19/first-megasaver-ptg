-- Source-alignment fix: these two immutable PTG sort helpers exist in the
-- established PTG database but were absent from the archived baseline SQL.
-- Restored verbatim from the read-only pg_get_functiondef catalog and validated
-- in isolated Branchline Integration Staging on 2026-11-22.
-- Stays on the integration DEVELOPMENT branch; no production deployment.

CREATE OR REPLACE FUNCTION public.ptg_aircon_model_key(p_brand text, p_model text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  with raw as (
    select upper(btrim(coalesce(p_brand, ''))) as brand,
      upper(btrim(coalesce(p_model, ''))) as model_text
  ), parsed as (
    select brand, coalesce(
      substring(model_text from '^([0-9]{1,3}[A-Z][A-Z0-9/-]*)'),
      substring(model_text from 'TYPE[[:space:]]+([0-9]{1,3}[A-Z][A-Z0-9/-]*)'),
      substring(model_text from 'MOUNTED[[:space:]]+([0-9]{1,3}[A-Z][A-Z0-9/-]*)'),
      substring(model_text from '([A-Z][A-Z0-9/-]*[0-9][A-Z0-9/-]*)'),
      model_text
    ) as code from raw
  )
  select case
    when brand = 'LG' then regexp_replace(code, '^HSU', 'HSN')
    when brand in ('CARRIER', 'CONDURA') then regexp_replace(code, '^38([A-Z])', '42\1')
    when brand = 'PANASONIC' then regexp_replace(code, '^(CS/CU|CS/U|CU|CS|S/U|S)-', 'AC-')
    when brand = 'DAIKIN' then regexp_replace(code, '^R(K[A-Z])', 'FT\1')
    when brand = 'MIDEA' then regexp_replace(code, '-(ID|OD)$', '')
    when brand = 'KOLIN' then regexp_replace(code, '-(I|O)$', '')
    else code
  end from parsed;
$function$;

CREATE OR REPLACE FUNCTION public.ptg_aircon_family_key(p_brand text, p_model text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  with normalized as (
    select upper(btrim(coalesce(p_brand, ''))) as brand,
      public.ptg_aircon_model_key(p_brand, p_model) as code
  )
  select case
    when brand = 'PANASONIC' and code ~ '^(AC|CW)-[A-Z]+[0-9]'
      then substring(code from '^((AC|CW)-[A-Z]+)')
    when brand = 'SAMSUNG' and code ~ '^AR(60|70)H[0-9]{2}'
      then regexp_replace(code, '^(AR(60|70)H)[0-9]{2}', '\1#')
    when brand = 'MIDEA' and code ~ '^FP-[0-9]{2}[A-Z]+[0-9]{3}'
      then regexp_replace(code, '^([A-Z]+-[0-9]{2}[A-Z]+)[0-9]{3}', '\1#')
    else regexp_replace(code, '([A-Z][A-Z/-]*)[0-9]{1,3}', '\1#')
  end from normalized;
$function$;
