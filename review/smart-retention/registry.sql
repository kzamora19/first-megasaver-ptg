-- Review-only, project-local registry. No bucket creation, object deletion, or cron activation.
BEGIN;
CREATE TABLE private.ptg_retention_policy(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 retention_days integer NOT NULL DEFAULT 60 CHECK(retention_days BETWEEN 60 AND 3650),
 enabled boolean NOT NULL DEFAULT false,
 release_authorized boolean NOT NULL DEFAULT false,
 CHECK(NOT enabled OR release_authorized)
);
INSERT INTO private.ptg_retention_policy(singleton) VALUES(true);
CREATE TABLE private.ptg_retained_sources(
 id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN('product-master','product-srp','dataset','sales-report','promo-memo','temporary-asset')),
 scope text NOT NULL CHECK(length(scope) BETWEEN 1 AND 200),
 source_name text NOT NULL CHECK(length(source_name) BETWEEN 1 AND 240),
 source_date date NOT NULL,imported_at timestamptz NOT NULL,
 sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 object_path text UNIQUE NOT NULL CHECK(object_path~'^originals/[a-f0-9]{64}/[a-f0-9-]{36}\.(xlsx|xls|xlsm|csv|pdf|png|jpg|jpeg|webp)$'),
 byte_size bigint NOT NULL CHECK(byte_size>0),
 catalog_batch_id uuid UNIQUE REFERENCES private.ptg_catalog_import_batches(id),
 processing_reference text NOT NULL,
 validated boolean NOT NULL DEFAULT false,
 data_preserved boolean NOT NULL DEFAULT false,
 dependencies_verified boolean NOT NULL DEFAULT false,
 hold boolean NOT NULL DEFAULT false,
 state text NOT NULL DEFAULT 'registered' CHECK(state IN('registered','claimed','review','deleted')),
 claim_token uuid UNIQUE,claimed_at timestamptz,deleted_at timestamptz,removed_bytes bigint,
 CHECK(object_path LIKE 'originals/'||sha256||'/'||id::text||'.%'),
 CHECK((state='claimed')=(claim_token IS NOT NULL)),
 CHECK((state='deleted')=(deleted_at IS NOT NULL))
);
CREATE INDEX ptg_retention_scope_versions ON private.ptg_retained_sources(kind,scope,source_date,imported_at) WHERE state='registered';
CREATE TABLE private.ptg_retention_dependencies(file_id uuid NOT NULL REFERENCES private.ptg_retained_sources(id),dependency_key text NOT NULL,PRIMARY KEY(file_id,dependency_key));
CREATE TABLE private.ptg_retention_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),file_id uuid REFERENCES private.ptg_retained_sources(id),
 actor_id uuid,action text NOT NULL,details jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.ptg_retention_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ptg_retained_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ptg_retention_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ptg_retention_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ptg_retention_policy,private.ptg_retained_sources,private.ptg_retention_dependencies,private.ptg_retention_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON private.ptg_retention_policy TO service_role;
GRANT SELECT,INSERT,UPDATE ON private.ptg_retained_sources TO service_role;
GRANT SELECT,INSERT,DELETE ON private.ptg_retention_dependencies TO service_role;
GRANT SELECT,INSERT ON private.ptg_retention_events TO service_role;

-- All eligibility decisions use trusted DB metadata. Existing buckets can never enter this registry.
CREATE FUNCTION private.ptg_retention_decisions(p_now timestamptz)
RETURNS TABLE(file_id uuid,reason text,expires_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT f.id,CASE
 WHEN f.state NOT IN('registered','claimed') THEN f.state
 WHEN f.hold OR NOT f.validated OR NOT f.data_preserved OR NOT f.dependencies_verified THEN 'protected'
 WHEN EXISTS(SELECT 1 FROM private.ptg_retention_dependencies d WHERE d.file_id=f.id) THEN 'active dependency'
 WHEN NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='branchline-retained-imports' AND o.name=f.object_path AND o.metadata->>'size'=f.byte_size::text) THEN 'unverified object'
 WHEN f.kind IN('product-master','product-srp','dataset') AND (
 SELECT count(DISTINCT n.sha256) FROM private.ptg_retained_sources n
 WHERE n.kind=f.kind AND n.scope=f.scope AND n.id<>f.id AND n.sha256<>f.sha256 AND n.state='registered'
 AND n.validated AND n.data_preserved AND n.source_date>f.source_date AND n.imported_at>f.imported_at
 AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='branchline-retained-imports' AND o.name=n.object_path AND o.metadata->>'size'=n.byte_size::text)
 )<2 THEN 'latest two valid versions / no replacement'
 WHEN p_now<f.imported_at+make_interval(days=>p.retention_days-7) THEN 'within retention'
 WHEN p_now<f.imported_at+make_interval(days=>p.retention_days) THEN 'expiring'
 ELSE 'eligible' END,f.imported_at+make_interval(days=>p.retention_days)
 FROM private.ptg_retained_sources f CROSS JOIN private.ptg_retention_policy p WHERE p.singleton
$$;
REVOKE ALL ON FUNCTION private.ptg_retention_decisions(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.ptg_retention_decisions(timestamptz) TO service_role;

-- Only a successfully committed dated catalog batch can enroll an intentionally retained original.
-- The current import paths parse files locally and DO NOT upload redundant archives.
-- Future trusted upload adapters must use unique paths, upsert:false, SHA-256 verification, and this RPC.
CREATE FUNCTION public.ptg_retention_register_catalog(p_actor_id uuid,p_batch_id uuid,p_id uuid,p_sha text,p_path text,p_bytes bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b private.ptg_catalog_import_batches%ROWTYPE;
BEGIN
 PERFORM private.ptg_catalog_require_admin(p_actor_id);
 PERFORM pg_advisory_xact_lock(913413,1);
 SELECT * INTO b FROM private.ptg_catalog_import_batches WHERE id=p_batch_id AND actor_id=p_actor_id;
 IF NOT FOUND OR p_id IS NULL OR p_sha IS NULL OR p_path IS NULL OR p_bytes IS NULL OR p_bytes<=0 THEN RAISE EXCEPTION 'Unverified catalog batch or file';END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='branchline-retained-imports' AND o.name=p_path AND o.metadata->>'size'=p_bytes::text) THEN RAISE EXCEPTION 'Retained original not verified';END IF;
 INSERT INTO private.ptg_retained_sources(id,kind,scope,source_name,source_date,imported_at,sha256,object_path,byte_size,catalog_batch_id,processing_reference,validated,data_preserved,dependencies_verified)
 VALUES(p_id,CASE WHEN b.dataset='master' THEN 'product-master' ELSE 'product-srp' END,'global',b.source_file,b.effective_date,b.imported_at,p_sha,p_path,p_bytes,b.id,b.id::text,true,true,true);
 INSERT INTO private.ptg_retention_events(file_id,actor_id,action) VALUES(p_id,p_actor_id,'registered');
 RETURN p_id;
END $$;
CREATE FUNCTION public.ptg_retention_configure(p_actor_id uuid,p_days integer,p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM private.ptg_catalog_require_admin(p_actor_id);PERFORM pg_advisory_xact_lock(913413,1);
 IF p_days IS NULL OR p_days NOT BETWEEN 60 AND 3650 OR p_enabled IS NULL THEN RAISE EXCEPTION 'Retention must be at least 60 days';END IF;
 IF EXISTS(SELECT 1 FROM private.ptg_retained_sources WHERE state='claimed') THEN RAISE EXCEPTION 'Cleanup is in progress; policy is locked';END IF;
 IF p_enabled AND NOT (SELECT release_authorized FROM private.ptg_retention_policy WHERE singleton) THEN RAISE EXCEPTION 'Deletion release has not been authorized';END IF;
 UPDATE private.ptg_retention_policy SET retention_days=p_days,enabled=p_enabled WHERE singleton;
 INSERT INTO private.ptg_retention_events(actor_id,action,details) VALUES(p_actor_id,'policy',jsonb_build_object('days',p_days,'enabled',p_enabled));
END $$;
CREATE FUNCTION public.ptg_retention_hold(p_actor_id uuid,p_id uuid,p_hold boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM private.ptg_catalog_require_admin(p_actor_id);PERFORM pg_advisory_xact_lock(913413,1);
 IF p_hold IS NULL THEN RAISE EXCEPTION 'Invalid hold';END IF;
 UPDATE private.ptg_retained_sources SET hold=p_hold WHERE id=p_id AND state='registered';
 IF NOT FOUND THEN RAISE EXCEPTION 'File is not available for hold changes';END IF;
 INSERT INTO private.ptg_retention_events(file_id,actor_id,action) VALUES(p_id,p_actor_id,CASE WHEN p_hold THEN 'hold' ELSE 'release_hold' END);
END $$;
CREATE FUNCTION public.ptg_retention_dependency(p_id uuid,p_key text,p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(913413,1);
 IF p_key IS NULL OR btrim(p_key)='' OR p_active IS NULL OR NOT EXISTS(SELECT 1 FROM private.ptg_retained_sources WHERE id=p_id AND state='registered') THEN RAISE EXCEPTION 'File unavailable for dependency changes';END IF;
 IF p_active THEN INSERT INTO private.ptg_retention_dependencies VALUES(p_id,p_key) ON CONFLICT DO NOTHING;
 ELSE DELETE FROM private.ptg_retention_dependencies WHERE file_id=p_id AND dependency_key=p_key;END IF;
END $$;
-- NULL actor is reserved to the separately authenticated server-only scheduler.
CREATE FUNCTION public.ptg_retention_candidates(p_actor_id uuid)
RETURNS TABLE(id uuid) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_actor_id IS NOT NULL THEN PERFORM private.ptg_catalog_require_admin(p_actor_id);END IF;
 RETURN QUERY SELECT f.id FROM private.ptg_retained_sources f JOIN private.ptg_retention_decisions(now()) d ON d.file_id=f.id
 WHERE f.state='registered' AND d.reason='eligible' ORDER BY f.imported_at,f.id LIMIT 100;
END $$;
CREATE FUNCTION public.ptg_retention_claim(p_actor_id uuid,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE f private.ptg_retained_sources%ROWTYPE;
BEGIN
 IF p_actor_id IS NOT NULL THEN PERFORM private.ptg_catalog_require_admin(p_actor_id);END IF;
 PERFORM pg_advisory_xact_lock(913413,1);
 IF NOT EXISTS(SELECT 1 FROM private.ptg_retention_policy WHERE singleton AND enabled AND release_authorized) THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM private.ptg_retention_decisions(now()) WHERE file_id=p_id AND reason='eligible') THEN RETURN NULL;END IF;
 UPDATE private.ptg_retained_sources SET state='claimed',claim_token=gen_random_uuid(),claimed_at=now() WHERE id=p_id AND state='registered' RETURNING * INTO f;
 IF NOT FOUND THEN RETURN NULL;END IF;
 INSERT INTO private.ptg_retention_events(file_id,actor_id,action) VALUES(p_id,p_actor_id,'claimed');
 RETURN jsonb_build_object('id',f.id,'token',f.claim_token,'path',f.object_path,'sha256',f.sha256,'bytes',f.byte_size);
END $$;
CREATE FUNCTION public.ptg_retention_revalidate(p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(913413,1);
 RETURN EXISTS(SELECT 1 FROM private.ptg_retained_sources f JOIN private.ptg_retention_decisions(now()) d ON d.file_id=f.id WHERE f.claim_token=p_token AND f.state='claimed' AND d.reason='eligible')
 AND EXISTS(SELECT 1 FROM private.ptg_retention_policy WHERE singleton AND enabled AND release_authorized);
END $$;
CREATE FUNCTION public.ptg_retention_finish(p_token uuid,p_outcome text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE f private.ptg_retained_sources%ROWTYPE;v_present boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(913413,1);
 SELECT * INTO f FROM private.ptg_retained_sources WHERE claim_token=p_token AND state='claimed' FOR UPDATE;
 IF NOT FOUND OR p_outcome IS NULL OR p_outcome NOT IN('deleted','cancelled','review') THEN RAISE EXCEPTION 'Invalid cleanup claim';END IF;
 SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='branchline-retained-imports' AND name=f.object_path) INTO v_present;
 IF p_outcome='deleted' AND v_present THEN RAISE EXCEPTION 'Object absence not confirmed';END IF;
 IF p_outcome='cancelled' AND NOT v_present THEN p_outcome:='review';END IF;
 UPDATE private.ptg_retained_sources SET state=CASE p_outcome WHEN 'deleted' THEN 'deleted' WHEN 'cancelled' THEN 'registered' ELSE 'review' END,
 claim_token=NULL,deleted_at=CASE WHEN p_outcome='deleted' THEN now() ELSE NULL END,removed_bytes=CASE WHEN p_outcome='deleted' THEN f.byte_size ELSE NULL END,
 hold=CASE WHEN p_outcome='review' THEN true ELSE hold END WHERE id=f.id;
 INSERT INTO private.ptg_retention_events(file_id,action,details) VALUES(f.id,p_outcome,jsonb_build_object('verifiedBytes',CASE WHEN p_outcome='deleted' THEN f.byte_size ELSE 0 END));
END $$;

CREATE FUNCTION public.ptg_retention_notices(p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
 -- Read-only role recheck. No row locks in a STABLE function.
 IF NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=p_actor_id AND role_key='SYSTEM_ADMIN' AND is_active AND NOT must_change_password) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id),'[]'::jsonb) INTO v_result FROM(
 SELECT 'retention:expiring:'||f.id::text||':'||d.expires_at::date::text AS id,'Imported source expiring' AS title,
 f.source_name||' · eligible from '||to_char(d.expires_at AT TIME ZONE 'Asia/Manila','YYYY-MM-DD') AS body
 FROM private.ptg_retained_sources f JOIN private.ptg_retention_decisions(now()) d ON d.file_id=f.id
 WHERE f.state='registered' AND d.reason='expiring' AND EXISTS(SELECT 1 FROM private.ptg_retention_policy WHERE singleton AND enabled AND release_authorized)
 UNION ALL
 SELECT 'retention:deleted:'||f.id::text,'Automatic file cleanup completed',f.source_name||' · '||f.removed_bytes::text||' bytes released. Business data preserved.'
 FROM private.ptg_retained_sources f WHERE f.state='deleted' AND f.deleted_at>=now()-interval '14 days'
 ORDER BY id LIMIT 25
 ) n;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.ptg_retention_register_catalog(uuid,uuid,uuid,text,text,bigint),public.ptg_retention_configure(uuid,integer,boolean),public.ptg_retention_hold(uuid,uuid,boolean),public.ptg_retention_dependency(uuid,text,boolean),public.ptg_retention_candidates(uuid),public.ptg_retention_claim(uuid,uuid),public.ptg_retention_revalidate(uuid),public.ptg_retention_finish(uuid,text),public.ptg_retention_notices(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ptg_retention_register_catalog(uuid,uuid,uuid,text,text,bigint),public.ptg_retention_configure(uuid,integer,boolean),public.ptg_retention_hold(uuid,uuid,boolean),public.ptg_retention_dependency(uuid,text,boolean),public.ptg_retention_candidates(uuid),public.ptg_retention_claim(uuid,uuid),public.ptg_retention_revalidate(uuid),public.ptg_retention_finish(uuid,text),public.ptg_retention_notices(uuid) TO service_role;
COMMIT;
