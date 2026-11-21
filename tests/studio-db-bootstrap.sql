-- Ephemeral CI fixture only. Never apply to a Supabase or production project.
-- Stub only the PTG tables required by the staged Studio migration.
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.branches (
 id uuid PRIMARY KEY,
 status text NOT NULL,
 operational_status text NOT NULL
);
CREATE TABLE public.user_profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id),
 role_key text NOT NULL,
 legacy_role text,
 is_active boolean NOT NULL DEFAULT true,
 must_change_password boolean NOT NULL DEFAULT false,
 session_version integer NOT NULL DEFAULT 1
);
CREATE TABLE public.app_sessions (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id),
 branch_id uuid REFERENCES public.branches(id),
 session_version integer NOT NULL,
 remember_device boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL,
 last_activity_at timestamptz NOT NULL,
 revoked_at timestamptz
);
INSERT INTO public.branches(id,status,operational_status) VALUES
 ('10000000-0000-4000-8000-000000000001','ACTIVE','ON'),
 ('10000000-0000-4000-8000-000000000002','ACTIVE','OFF'),
 ('10000000-0000-4000-8000-000000000003','INACTIVE','ON');
INSERT INTO auth.users(id)
SELECT ('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid
FROM generate_series(1,15) AS i;
INSERT INTO public.user_profiles(id,role_key,legacy_role,is_active,must_change_password,session_version)
SELECT ('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 CASE WHEN i=1 THEN 'SYSTEM_ADMIN'
      WHEN i=2 THEN 'BRANCH_ADMIN'
      ELSE 'BRANCH_USER' END,
 CASE WHEN i=4 OR i=12 THEN 'BRANCH USER' ELSE 'TEAM LEADER' END,
 i<>5,
 i=11,
 CASE WHEN i=8 THEN 2 ELSE 1 END
FROM generate_series(1,15) AS i;
INSERT INTO public.app_sessions(id,user_id,branch_id,session_version,remember_device,expires_at,last_activity_at,revoked_at)
SELECT ('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 ('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 CASE WHEN i=9 THEN '10000000-0000-4000-8000-000000000002'::uuid
 ELSE '10000000-0000-4000-8000-000000000001'::uuid END,
 1,
 i=13,
 CASE WHEN i=7 THEN now()-interval '1 minute' ELSE now()+interval '3 hours' END,
 CASE WHEN i=10 THEN now()-interval '31 minutes'
      WHEN i=13 THEN now()-interval '6 days'
      ELSE now()-interval '1 minute' END,
 CASE WHEN i=6 THEN now()-interval '1 minute' ELSE null END
FROM generate_series(1,15) AS i;
