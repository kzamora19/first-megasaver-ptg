-- REVIEW ONLY. Never run as part of normal schema installation.
-- After separate explicit release approval, create project-local Vault secrets:
-- branchline_retention_worker_url (exact HTTPS endpoint) and branchline_retention_cron_token.
-- The token must match the project's server-only RETENTION_CRON_TOKEN.
-- The function runtime flag and database release_authorized must be independently approved.
-- This script installs the daily schedule only in the currently connected project.
-- Use SET LOCAL branchline.retention_schedule_approved = 'YES' inside an explicit,
-- separately approved transaction before executing this DO block.
DO $schedule$
DECLARE policy_table regclass;worker_url text;cron_token text;approved boolean;command text;
BEGIN
 IF current_setting('branchline.retention_schedule_approved',true) IS DISTINCT FROM 'YES' THEN RAISE EXCEPTION 'Explicit schedule approval required';END IF;
 policy_table:=coalesce(to_regclass('private.ptg_retention_policy'),to_regclass('private.branchline_retention_policy'));
 IF policy_table IS NULL THEN RAISE EXCEPTION 'Registry missing';END IF;
 EXECUTE format('SELECT release_authorized FROM %s WHERE singleton',policy_table) INTO approved;
 IF approved IS DISTINCT FROM true THEN RAISE EXCEPTION 'Deletion release not authorized';END IF;
 SELECT decrypted_secret INTO worker_url FROM vault.decrypted_secrets WHERE name='branchline_retention_worker_url';
 SELECT decrypted_secret INTO cron_token FROM vault.decrypted_secrets WHERE name='branchline_retention_cron_token';
 IF worker_url IS NULL OR worker_url!~'^https://[a-z0-9]+\.supabase\.co/functions/v1/(ptg-retention-worker|branchline-retention)$' OR cron_token IS NULL OR length(cron_token)<32 THEN RAISE EXCEPTION 'Verified project-local Vault secrets required';END IF;
 -- Verify the Vault URL matches the exact current project's reviewed endpoint before approval.
 command:=format($job$
 SELECT net.http_post(url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='branchline_retention_worker_url'),
 headers:=jsonb_build_object('Content-Type','application/json','x-retention-cron-token',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='branchline_retention_cron_token')),
 body:='{}'::jsonb,timeout_milliseconds:=120000)
 WHERE EXISTS(SELECT 1 FROM %s WHERE singleton AND enabled AND release_authorized)
 $job$,policy_table);
 PERFORM cron.schedule('branchline-retention-midnight-pht','0 16 * * *',command);
END $schedule$;
