-- Fresh disposable local Supabase only. Existing storage tables are NOT modified via SQL.
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,role_key text,is_active boolean,must_change_password boolean);
CREATE TABLE public.security_audit_logs(actor_user_id uuid,branch_id uuid,event_category text,action text,target_identifier text,outcome text,message text,metadata jsonb);
CREATE TABLE public.product_master(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),barcode text UNIQUE NOT NULL,description text NOT NULL,brand text NOT NULL DEFAULT '',category text NOT NULL DEFAULT '',sub_category text NOT NULL DEFAULT '',source_file text NOT NULL DEFAULT '',imported_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.product_srp(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),barcode text UNIQUE NOT NULL,model_description text NOT NULL,srp numeric NOT NULL DEFAULT 0,source_file text NOT NULL DEFAULT '',import_date timestamptz DEFAULT now());
CREATE FUNCTION public.ptg_srp_barcode_key(barcode text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$SELECT CASE WHEN btrim(barcode)~'^[0-9]+$' THEN coalesce(nullif(ltrim(btrim(barcode),'0'),''),'0') ELSE upper(btrim(barcode)) END$$;
CREATE UNIQUE INDEX product_srp_barcode_key_unique ON public.product_srp(public.ptg_srp_barcode_key(barcode));
CREATE FUNCTION public.ptg_import_srp(jsonb,text) RETURNS int LANGUAGE sql AS $$SELECT 0$$;
GRANT USAGE ON SCHEMA public,private,storage TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.user_profiles,public.product_master,public.product_srp,public.security_audit_logs TO service_role;
GRANT SELECT ON storage.buckets,storage.objects TO service_role;
INSERT INTO public.user_profiles VALUES('00000000-0000-0000-0000-000000000001','SYSTEM_ADMIN',true,false),('00000000-0000-0000-0000-000000000002','BRANCH_ADMIN',true,false);
INSERT INTO public.product_master(barcode,description,brand,category,sub_category,source_file) VALUES('00000528','Permanent business record','Brand A','TV','LED','synthetic.xlsx');
