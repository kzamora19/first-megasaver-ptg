-- Review-only SQL. Apply as a coordinated migration only after explicit release approval.
BEGIN;
CREATE TABLE private.ptg_catalog_legacy_sources(
 dataset text NOT NULL CHECK(dataset IN('master','srp')),
 source_file text NOT NULL,
 upper_date date NOT NULL,
 approved_by uuid NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(dataset,source_file)
);
CREATE TABLE private.ptg_catalog_import_batches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dataset text NOT NULL CHECK(dataset IN('master','srp')),
 source_file text NOT NULL CHECK(length(btrim(source_file)) BETWEEN 1 AND 240),
 effective_date date NOT NULL,actor_id uuid NOT NULL,imported_at timestamptz NOT NULL DEFAULT now(),
 row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 10000)
);
CREATE TABLE private.ptg_catalog_field_versions(
 dataset text NOT NULL CHECK(dataset IN('master','srp')),
 record_id uuid NOT NULL,field_name text NOT NULL,effective_date date NOT NULL,
 batch_id uuid REFERENCES private.ptg_catalog_import_batches(id),
 source_file text NOT NULL,legacy_upper_bound boolean NOT NULL DEFAULT false,
 field_value jsonb NOT NULL,
 PRIMARY KEY(dataset,record_id,field_name,effective_date),
 CHECK((legacy_upper_bound AND batch_id IS NULL) OR (NOT legacy_upper_bound AND batch_id IS NOT NULL))
);
ALTER TABLE private.ptg_catalog_legacy_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ptg_catalog_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ptg_catalog_field_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ptg_catalog_legacy_sources,private.ptg_catalog_import_batches,private.ptg_catalog_field_versions FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT,INSERT ON private.ptg_catalog_legacy_sources,private.ptg_catalog_import_batches,private.ptg_catalog_field_versions TO service_role;
CREATE FUNCTION private.ptg_catalog_require_admin(p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.user_profiles WHERE id=p_actor AND role_key='SYSTEM_ADMIN' AND is_active AND NOT must_change_password FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.ptg_catalog_require_admin(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.ptg_catalog_require_admin(uuid) TO service_role;

CREATE FUNCTION public.ptg_approve_legacy_source(p_actor_id uuid,p_dataset text,p_source text,p_upper_date date)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM private.ptg_catalog_require_admin(p_actor_id);
 IF p_dataset IS NULL OR p_dataset NOT IN('master','srp') OR p_source IS NULL OR p_upper_date IS NULL OR p_upper_date>(now() AT TIME ZONE 'Asia/Manila')::date THEN RAISE EXCEPTION 'Invalid confirmed source date';END IF;
 PERFORM pg_advisory_xact_lock(913412,CASE WHEN p_dataset='master' THEN 1 ELSE 2 END);
 IF NOT ((p_dataset='master' AND EXISTS(SELECT 1 FROM public.product_master WHERE source_file=p_source)) OR (p_dataset='srp' AND EXISTS(SELECT 1 FROM public.product_srp WHERE source_file=p_source))) THEN RAISE EXCEPTION 'Legacy source not found';END IF;
 IF EXISTS(SELECT 1 FROM private.ptg_catalog_legacy_sources WHERE dataset=p_dataset AND source_file=p_source) THEN RAISE EXCEPTION 'Source already approved; changes require audited reconciliation';END IF;
 INSERT INTO private.ptg_catalog_legacy_sources(dataset,source_file,upper_date,approved_by) VALUES(p_dataset,p_source,p_upper_date,p_actor_id);
 INSERT INTO public.security_audit_logs(actor_user_id,branch_id,event_category,action,target_identifier,outcome,message,metadata)
 VALUES(p_actor_id,NULL,'CATALOG_RETENTION','APPROVE_LEGACY_SOURCE',p_source,'SUCCESS','System Admin confirmed a conservative upper bound for legacy source chronology.',jsonb_build_object('dataset',p_dataset,'upperDate',p_upper_date));
END $$;
REVOKE ALL ON FUNCTION public.ptg_approve_legacy_source(uuid,text,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ptg_approve_legacy_source(uuid,text,text,date) TO service_role;

CREATE FUNCTION public.ptg_import_catalog_dated(p_dataset text,p_source_file text,p_effective_date date,p_rows jsonb,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
 v_batch uuid;v_row jsonb;v_barcode text;v_id uuid;v_field text;v_fields text[];v_values jsonb;
 v_incoming jsonb;v_before jsonb;v_latest date;v_historical jsonb;v_legacy boolean;v_upper date;v_old_source text;
 v_seen text[]:=ARRAY[]::text[];v_key text;v_new boolean;v_changed boolean;
 v_inserted int:=0;v_updated int:=0;v_unchanged int:=0;
BEGIN
 PERFORM private.ptg_catalog_require_admin(p_actor_id);
 IF p_dataset IS NULL OR p_dataset NOT IN('master','srp') OR p_source_file IS NULL OR length(btrim(p_source_file)) NOT BETWEEN 1 AND 240
 OR p_effective_date IS NULL OR p_effective_date>(now() AT TIME ZONE 'Asia/Manila')::date OR p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' THEN RAISE EXCEPTION 'Invalid catalog import';END IF;
 IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid row count';END IF;
 PERFORM pg_advisory_xact_lock(913412,CASE WHEN p_dataset='master' THEN 1 ELSE 2 END);
 v_fields:=CASE WHEN p_dataset='master' THEN ARRAY['description','brand','category','sub_category'] ELSE ARRAY['model_description','srp'] END;
 INSERT INTO private.ptg_catalog_import_batches(dataset,source_file,effective_date,actor_id,row_count)
 VALUES(p_dataset,btrim(p_source_file),p_effective_date,p_actor_id,jsonb_array_length(p_rows)) RETURNING id INTO v_batch;
 FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(v_row)<>'object' OR jsonb_typeof(v_row->'barcode') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Barcode must be text';END IF;
  v_barcode:=btrim(v_row->>'barcode');
  IF length(v_barcode) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid barcode';END IF;
  v_key:=CASE WHEN p_dataset='srp' THEN public.ptg_srp_barcode_key(v_barcode) ELSE v_barcode END;
  IF v_key=ANY(v_seen) THEN RAISE EXCEPTION 'Duplicate barcode: %',v_barcode;END IF;
  v_seen:=array_append(v_seen,v_key);v_id:=NULL;v_values:='{}'::jsonb;v_changed:=false;v_old_source:=NULL;
  IF p_dataset='master' THEN
   SELECT id,jsonb_build_object('description',description,'brand',brand,'category',category,'sub_category',sub_category),source_file
   INTO v_id,v_values,v_old_source FROM public.product_master WHERE barcode=v_barcode FOR UPDATE;
  ELSE
   SELECT id,jsonb_build_object('model_description',model_description,'srp',srp),source_file
   INTO v_id,v_values,v_old_source FROM public.product_srp WHERE public.ptg_srp_barcode_key(barcode)=v_key FOR UPDATE;
  END IF;
  v_new:=v_id IS NULL;
  IF v_new THEN v_id:=gen_random_uuid();v_values:='{}'::jsonb;
  ELSE
   -- Seed all populated legacy fields before ANY field update can change the row's source_file.
   FOREACH v_field IN ARRAY v_fields LOOP
    v_before:=v_values->v_field;
    IF v_before IS NULL OR v_before IN('null'::jsonb,'""'::jsonb,'0'::jsonb) OR EXISTS(SELECT 1 FROM private.ptg_catalog_field_versions WHERE dataset=p_dataset AND record_id=v_id AND field_name=v_field) THEN CONTINUE;END IF;
    SELECT upper_date INTO v_upper FROM private.ptg_catalog_legacy_sources WHERE dataset=p_dataset AND source_file=v_old_source;
    IF NOT FOUND THEN RAISE EXCEPTION 'Review legacy source date in Storage Management: %',v_old_source;END IF;
    INSERT INTO private.ptg_catalog_field_versions(dataset,record_id,field_name,effective_date,source_file,legacy_upper_bound,field_value)
    VALUES(p_dataset,v_id,v_field,v_upper,v_old_source,true,v_before);
   END LOOP;
  END IF;
  FOREACH v_field IN ARRAY v_fields LOOP
   v_incoming:=v_row->v_field;
   IF v_incoming IS NULL OR v_incoming='null'::jsonb THEN CONTINUE;END IF;
   IF v_field='srp' THEN
    IF v_incoming='""'::jsonb THEN CONTINUE;END IF;
    IF jsonb_typeof(v_incoming)<>'number' OR (v_incoming#>>'{}')::numeric<0 THEN RAISE EXCEPTION 'Invalid SRP';END IF;
    IF (v_incoming#>>'{}')::numeric=0 THEN CONTINUE;END IF;
   ELSE
    IF jsonb_typeof(v_incoming)<>'string' THEN RAISE EXCEPTION 'Invalid field %',v_field;END IF;
    IF btrim(v_incoming#>>'{}')='' THEN CONTINUE;END IF;
    IF length(btrim(v_incoming#>>'{}')) > (CASE v_field WHEN 'brand' THEN 100 WHEN 'category' THEN 160 WHEN 'sub_category' THEN 160 WHEN 'model_description' THEN 1000 ELSE 500 END) THEN RAISE EXCEPTION 'Field too long';END IF;
    v_incoming:=to_jsonb(btrim(v_incoming#>>'{}'));
   END IF;
   SELECT max(effective_date) INTO v_latest FROM private.ptg_catalog_field_versions WHERE dataset=p_dataset AND record_id=v_id AND field_name=v_field;
   SELECT field_value,legacy_upper_bound INTO v_historical,v_legacy FROM private.ptg_catalog_field_versions WHERE dataset=p_dataset AND record_id=v_id AND field_name=v_field AND effective_date=p_effective_date;
   IF FOUND THEN
    IF v_historical IS DISTINCT FROM v_incoming AND NOT v_legacy THEN RAISE EXCEPTION 'Conflicting same-date value: % %',v_barcode,v_field;END IF;
    CONTINUE;
   END IF;
   INSERT INTO private.ptg_catalog_field_versions(dataset,record_id,field_name,effective_date,batch_id,source_file,field_value)
   VALUES(p_dataset,v_id,v_field,p_effective_date,v_batch,btrim(p_source_file),v_incoming);
   IF v_latest IS NULL OR p_effective_date>v_latest THEN
    v_values:=jsonb_set(v_values,ARRAY[v_field],v_incoming,true);v_changed:=true;
   END IF;
  END LOOP;
  IF v_new THEN
   IF p_dataset='master' THEN
    IF coalesce(v_values->>'description','')='' THEN RAISE EXCEPTION 'Missing description for %',v_barcode;END IF;
    INSERT INTO public.product_master(id,barcode,description,brand,category,sub_category,source_file)
    VALUES(v_id,v_barcode,v_values->>'description',coalesce(v_values->>'brand',''),coalesce(v_values->>'category',''),coalesce(v_values->>'sub_category',''),btrim(p_source_file));
   ELSE
    IF coalesce(v_values->>'model_description','')='' THEN RAISE EXCEPTION 'Missing description for %',v_barcode;END IF;
    INSERT INTO public.product_srp(id,barcode,model_description,srp,source_file)
    VALUES(v_id,v_barcode,v_values->>'model_description',coalesce((v_values->>'srp')::numeric,0),btrim(p_source_file));
   END IF;
   v_inserted:=v_inserted+1;
  ELSIF v_changed THEN
   IF p_dataset='master' THEN UPDATE public.product_master SET description=v_values->>'description',brand=v_values->>'brand',category=v_values->>'category',sub_category=v_values->>'sub_category',source_file=btrim(p_source_file),updated_at=now() WHERE id=v_id;
   ELSE UPDATE public.product_srp SET model_description=v_values->>'model_description',srp=(v_values->>'srp')::numeric,source_file=btrim(p_source_file),import_date=now() WHERE id=v_id;END IF;
   v_updated:=v_updated+1;
  ELSE v_unchanged:=v_unchanged+1;END IF;
 END LOOP;
 INSERT INTO public.security_audit_logs(actor_user_id,branch_id,event_category,action,target_identifier,outcome,message,metadata)
 VALUES(p_actor_id,NULL,CASE WHEN p_dataset='master' THEN 'PRODUCT_MASTER' ELSE 'PRODUCT_SRP' END,'IMPORT',btrim(p_source_file),'SUCCESS','Dated catalog import completed.',jsonb_build_object('batchId',v_batch,'sourceDate',p_effective_date,'inserted',v_inserted,'updated',v_updated,'unchanged',v_unchanged));
 RETURN jsonb_build_object('batchId',v_batch,'received',jsonb_array_length(p_rows),'uniqueValid',jsonb_array_length(p_rows),'inserted',v_inserted,'updated',v_updated,'unchanged',v_unchanged,'invalidRows',0,'duplicateRows',0);
END $$;
REVOKE ALL ON FUNCTION public.ptg_import_catalog_dated(text,text,date,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ptg_import_catalog_dated(text,text,date,jsonb,uuid) TO service_role;
-- Coordinated cutover only: the verified Edge gateways are the sole normal catalog writers.
-- Older clients fail closed, rather than silently bypassing effective-date protection.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.product_master,public.product_srp FROM anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.ptg_import_srp(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
