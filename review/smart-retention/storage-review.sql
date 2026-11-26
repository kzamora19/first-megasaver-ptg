-- Review-only SQL. Existing asset buckets are excluded. No storage metadata mutations or schedules.
BEGIN;
CREATE FUNCTION public.ptg_storage_review(p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_buckets jsonb;v_sources jsonb;
BEGIN
 PERFORM private.ptg_catalog_require_admin(p_actor_id);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]'::jsonb) INTO v_buckets FROM (
  SELECT b.id,count(o.id) AS objects,coalesce(sum(CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,18}$' THEN (o.metadata->>'size')::bigint ELSE 0 END),0) AS bytes,
  count(o.id) FILTER(WHERE coalesce(o.metadata->>'size','') !~ '^[0-9]{1,18}$') AS "unknownSizes"
  FROM storage.buckets b LEFT JOIN storage.objects o ON b.id=o.bucket_id GROUP BY b.id
 ) q;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.dataset,q.source),'[]'::jsonb) INTO v_sources FROM (
  SELECT s.dataset,s.source,s.records,s."lastImport",b.upper_date AS "approvedDate"
  FROM (
   SELECT 'master'::text AS dataset,m.source_file AS source,count(*) AS records,max(m.updated_at)::date AS "lastImport"
   FROM public.product_master m WHERE NOT EXISTS(SELECT 1 FROM private.ptg_catalog_field_versions v WHERE v.dataset='master' AND v.record_id=m.id) GROUP BY m.source_file
   UNION ALL
   SELECT 'srp',m.source_file,count(*),max(m.import_date)::date FROM public.product_srp m WHERE NOT EXISTS(SELECT 1 FROM private.ptg_catalog_field_versions v WHERE v.dataset='srp' AND v.record_id=m.id) GROUP BY m.source_file
  ) s LEFT JOIN private.ptg_catalog_legacy_sources b ON b.dataset=s.dataset AND b.source_file=s.source
 ) q;
 RETURN jsonb_build_object('scope','PTG','policy',jsonb_build_object('retentionDays',60,'enabled',false),'buckets',v_buckets,'legacySources',v_sources,'eligible',null,'expiring',null,'registryReady',false);
END $$;
REVOKE ALL ON FUNCTION public.ptg_storage_review(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ptg_storage_review(uuid) TO service_role;
COMMIT;
