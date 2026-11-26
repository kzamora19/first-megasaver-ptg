-- Synthetic integration assertions; psql -v ON_ERROR_STOP=1.
DO $$
DECLARE a uuid:='00000000-0000-0000-0000-000000000001';other uuid:='00000000-0000-0000-0000-000000000002';v jsonb;n bigint;
BEGIN
 BEGIN PERFORM public.ptg_import_catalog_dated('srp','denied','2026-01-01','[{"barcode":"00000101","srp":1}]',other);RAISE EXCEPTION 'Non-admin was allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.ptg_import_catalog_dated('srp','before-review','2026-01-01','[{"barcode":"00000101","srp":1}]',a);RAISE EXCEPTION 'Legacy review bypass';EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Review legacy source date%' THEN RAISE;END IF;END;
 PERFORM public.ptg_approve_legacy_source(a,'master','legacy-master.xlsx','2025-12-01');
 PERFORM public.ptg_approve_legacy_source(a,'srp','legacy-srp.xlsx','2025-12-01');
 v:=public.ptg_import_catalog_dated('master','master-new.xlsx','2026-01-05','[{"barcode":"00000101","description":"New model","brand":""},{"barcode":"00000103","description":"New item","brand":"New brand"}]',a);
 IF (v->>'inserted')::int<>1 OR (v->>'updated')::int<>1 THEN RAISE EXCEPTION 'Unexpected master import counts';END IF;
 IF (SELECT brand FROM public.product_master WHERE barcode='00000101')<>'Brand A' OR NOT EXISTS(SELECT 1 FROM public.product_master WHERE barcode='00000102') THEN RAISE EXCEPTION 'Master data lost';END IF;
 PERFORM public.ptg_import_catalog_dated('master','older.xlsx','2025-12-02','[{"barcode":"00000101","description":"Older model","brand":"Earlier brand"}]',a);
 IF (SELECT description FROM public.product_master WHERE barcode='00000101')<>'New model' THEN RAISE EXCEPTION 'Older description overwrote newest';END IF;
 PERFORM public.ptg_import_catalog_dated('srp','new-srp.xlsx','2026-01-05','[{"barcode":"101","model_description":"New description","srp":0},{"barcode":"00000103","model_description":"New item","srp":4500}]',a);
 IF (SELECT srp FROM public.product_srp WHERE barcode='00000101')<>1940 OR (SELECT srp FROM public.product_srp WHERE barcode='00000102')<>3200 THEN RAISE EXCEPTION 'Valid SRP lost or barcode altered';END IF;
 PERFORM public.ptg_import_catalog_dated('srp','later.xlsx','2026-01-07','[{"barcode":"101","model_description":"New description","srp":2100}]',a);
 PERFORM public.ptg_import_catalog_dated('srp','out-of-order.xlsx','2026-01-06','[{"barcode":"00000101","srp":1900}]',a);
 PERFORM public.ptg_import_catalog_dated('srp','blank.xlsx','2026-01-08','[{"barcode":"101","srp":null}]',a);
 IF (SELECT srp FROM public.product_srp WHERE barcode='00000101')<>2100 THEN RAISE EXCEPTION 'Newer valid SRP lost';END IF;
 SELECT count(*) INTO n FROM private.ptg_catalog_import_batches;
 BEGIN PERFORM public.ptg_import_catalog_dated('srp','bad-duplicate.xlsx','2026-01-09','[{"barcode":"00000101","srp":9999},{"barcode":"101","srp":8888}]',a);RAISE EXCEPTION 'Duplicate accepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Duplicate barcode:%' THEN RAISE;END IF;END;
 IF (SELECT count(*) FROM private.ptg_catalog_import_batches)<>n OR (SELECT srp FROM public.product_srp WHERE barcode='00000101')<>2100 THEN RAISE EXCEPTION 'Partial import committed';END IF;
 BEGIN PERFORM public.ptg_import_catalog_dated('srp','conflict.xlsx','2026-01-07','[{"barcode":"101","srp":999}]',a);RAISE EXCEPTION 'Same-date conflict accepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Conflicting same-date value:%' THEN RAISE;END IF;END;
 IF has_function_privilege('authenticated','public.ptg_import_catalog_dated(text,text,date,jsonb,uuid)','EXECUTE') OR has_table_privilege('authenticated','public.product_master','DELETE') OR has_function_privilege('service_role','public.ptg_import_srp(jsonb,text)','EXECUTE') THEN RAISE EXCEPTION 'Legacy writer bypass remains';END IF;
 v:=public.ptg_storage_review(a);
 IF (v->'policy'->>'enabled')::boolean OR (v->'buckets'->0->>'id')<>'ptg-branding' THEN RAISE EXCEPTION 'Unsafe storage overview';END IF;
 BEGIN PERFORM public.ptg_storage_review(other);RAISE EXCEPTION 'Non-admin storage access';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RAISE NOTICE 'PASS synthetic PostgreSQL catalog and storage review integration';
END $$;
