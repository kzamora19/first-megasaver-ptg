// Actual Auth + HTTP endpoint integration, loopback-only disposable Supabase.
// Run after real-storage-tests.mjs on the same disposable stack. No live URLs or secrets.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync,spawn} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import {once} from "node:events";
import {createClient} from "@supabase/supabase-js";
const settings=Object.fromEntries(readFileSync(process.argv[2],"utf8").split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const at=l.indexOf("=");return [l.slice(0,at),l.slice(at+1).replace(/^"(.*)"$/,"$1")];}));
const api=settings.API_URL??settings.SUPABASE_URL,db=settings.DB_URL,key=settings.SERVICE_ROLE_KEY??settings.SECRET_KEY,anon=settings.ANON_KEY??settings.PUBLISHABLE_KEY;
const local=url=>["127.0.0.1","localhost","::1","[::1]"].includes(new URL(url).hostname);
assert.ok(api&&db&&key&&anon&&local(api)&&local(db),"Refuse all non-loopback URLs");
const sql=query=>execFileSync("psql",[db,"-v","ON_ERROR_STOP=1","-c",query],{stdio:"inherit"});
const opts={auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}};
const admin=createClient(api,key,opts);
function ok(result,label){if(result.error)throw Error(label+": "+result.error.message);return result.data;}
sql("ALTER TABLE public.user_profiles ADD COLUMN legacy_role text NOT NULL DEFAULT '',ADD COLUMN session_version integer NOT NULL DEFAULT 1; CREATE TABLE public.branches(id uuid PRIMARY KEY,status text NOT NULL,operational_status text NOT NULL); CREATE TABLE public.app_sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL,branch_id uuid,session_version int NOT NULL DEFAULT 1,remember_device boolean NOT NULL DEFAULT false,last_activity_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour',revoked_at timestamptz,revoke_reason text); CREATE TABLE public.role_permissions(role_key text,permission_key text,access_level text,PRIMARY KEY(role_key,permission_key)); CREATE TABLE public.price_memos(id uuid PRIMARY KEY,memo_id text,period text,imported_at timestamptz,memo_type text,branch_id uuid,product_count int); CREATE FUNCTION public.get_ptg_login_username(p_user_id uuid) RETURNS text LANGUAGE sql AS $$SELECT 'synthetic'::text$$; REVOKE ALL ON FUNCTION public.get_ptg_login_username(uuid) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.get_ptg_login_username(uuid) TO service_role; GRANT SELECT,INSERT,UPDATE ON public.branches,public.app_sessions,public.role_permissions,public.price_memos TO service_role; INSERT INTO public.role_permissions VALUES('SYSTEM_ADMIN','IMPORT_SRP','FULL');");
const branch=crypto.randomUUID();
sql("INSERT INTO public.branches VALUES('"+branch+"','ACTIVE','ON');");
async function identity(role,legacy,branchId){
 const email=crypto.randomUUID()+"@fixture.invalid",password="Fixture!"+crypto.randomUUID();
 const created=ok(await admin.auth.admin.createUser({email,password,email_confirm:true}),"Create local test identity");
 const id=created.user.id,session=crypto.randomUUID();
 assert.match(id,/^[a-f0-9-]{36}$/i);
 sql("INSERT INTO public.user_profiles(id,role_key,is_active,must_change_password,legacy_role,session_version) VALUES('"+id+"','"+role+"',true,false,'"+legacy+"',1); INSERT INTO public.app_sessions(id,user_id,branch_id) VALUES('"+session+"','"+id+"',"+(branchId?"'"+branchId+"'":"NULL")+");");
 const client=createClient(api,anon,opts),auth=ok(await client.auth.signInWithPassword({email,password}),"Sign in local test identity");
 return {id,session,token:auth.session.access_token};
}
const sys=await identity("SYSTEM_ADMIN","SYSTEM ADMIN",null);
const manager=await identity("BRANCH_ADMIN","BRANCH MANAGER",branch);
const user=await identity("BRANCH_USER","BRANCH USER",branch);
const origin="http://127.0.0.1:3000",endpoint="http://127.0.0.1:8000";
const net=[new URL(api).host,"0.0.0.0:8000","127.0.0.1:8000"].join(",");
async function serve(name,fn){
 const child=spawn("deno",["run","--no-prompt","--node-modules-dir=auto","--allow-env","--allow-read","--allow-sys","--allow-net="+net,"supabase/functions/"+name+"/index.ts"],{env:{PATH:process.env.PATH,HOME:process.env.HOME,DENO_DIR:process.env.DENO_DIR??"",SUPABASE_URL:api,SUPABASE_SERVICE_ROLE_KEY:key,SUPABASE_ANON_KEY:anon,PTG_ALLOWED_ORIGINS:origin},stdio:["ignore","pipe","pipe"]});
 let output="";for(const stream of [child.stdout,child.stderr])stream.on("data",v=>{output=(output+String(v)).slice(-4000);});
 const exited=once(child,"exit");
 try{
  let ready=false;
  for(let i=0;i<90;i++){if(child.exitCode!==null)break;try{const res=await fetch(endpoint,{method:"OPTIONS",headers:{Origin:origin},signal:AbortSignal.timeout(1000)});if(res.status===204){ready=true;break;}}catch{}await delay(1000);}
  if(!ready)throw Error(name+" local HTTP handler did not start: "+output);
  await fn();
 }finally{child.kill("SIGTERM");await Promise.race([exited,delay(5000)]);if(child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");}
}
async function call(body,identity,expected,sessionId=identity?.session){
 const headers={Origin:origin,"Content-Type":"application/json"};
 if(identity)headers.Authorization="Bearer "+identity.token;
 if(sessionId)headers["x-ptg-session-id"]=sessionId;
 const res=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const json=await res.json();
 assert.equal(res.status,expected,JSON.stringify({action:body.action,status:res.status,response:json}));
 return json;
}
await serve("ptg-accounts",async()=>{
 const action={action:"securityStorageOverview",project:"ptg"};
 assert.ok((await call(action,sys,200)).storage.registryReady);
 await call(action,null,401);await call(action,manager,403);await call(action,user,403);await call(action,sys,401,manager.session);
 await call({action:"securityStorageOverview",project:"untrusted-project"},sys,400);
 await call({action:"securityRetentionConfigure",days:60,enabled:false,confirmed:true},manager,403);
 await call({action:"securityRetentionCleanup",project:"ptg",dryRun:false,confirmed:true},sys,403);
 const result=await call({action:"securityRetentionCleanup",project:"ptg",dryRun:true},sys,200);assert.equal(result.cleanup.deleted,0);
 const row={barcode:"00000801",description:"Fixture SRP",srp:1940};
 await call({action:"securityImportSrp",source:"fixture-new.xlsx",sourceDate:"2026-01-06",verified:true,rows:[row,{barcode:"00000802",description:"Omitted later",srp:3200}]},sys,200);
 await call({action:"securityImportSrp",source:"fixture-zero.xlsx",sourceDate:"2026-01-07",verified:true,rows:[{...row,srp:0}]},sys,200);
 await call({action:"securityImportSrp",source:"fixture-older.xlsx",sourceDate:"2026-01-05",verified:true,rows:[{...row,srp:1200}]},sys,200);
 await call({action:"securityImportSrp",source:"denied.xlsx",sourceDate:"2026-01-08",verified:true,rows:[row]},manager,403);
 const srps=ok(await admin.from("product_srp").select("barcode,srp").in("barcode",["00000801","00000802"]).order("barcode"),"Inspect test SRP");
 assert.deepEqual(srps,[{barcode:"00000801",srp:1940},{barcode:"00000802",srp:3200}]);
});
await serve("ptg-products",async()=>{
 const base={action:"master-import",sourceFile:"fixture-master.xlsx",sourceDate:"2026-01-06",rows:[{barcode:"00000701",description:"Fixture A",brand:"Brand A",category:"TV",sub_category:"LED"},{barcode:"00000702",description:"Fixture B",brand:"Brand B",category:"TV",sub_category:"LED"}]};
 await call(base,sys,200);await call(base,manager,403);await call(base,user,403);
 await call({...base,sourceFile:"fixture-master-later.xlsx",sourceDate:"2026-01-07",rows:[{barcode:"00000701",description:"Updated model",brand:"",category:"TV",sub_category:"LED"}]},sys,200);
 const rows=ok(await admin.from("product_master").select("barcode,description,brand").in("barcode",["00000701","00000702"]).order("barcode"),"Inspect test Master");
 assert.deepEqual(rows,[{barcode:"00000701",description:"Updated model",brand:"Brand A"},{barcode:"00000702",description:"Fixture B",brand:"Brand B"}]);
});
await serve("ptg-widget-announcements",async()=>{
 const a=await call({},sys,200);
 assert.ok(a.notices.some(n=>n.id.startsWith("retention:deleted:")),"System Admin deletion notice missing");
 for(const i of [manager,user]){const r=await call({},i,200);assert.ok(!r.notices.some(n=>n.id.includes("retention:")),"Retention information leaked");}
 await call({},null,401);
});
console.log("PASS real Auth, System Admin-only HTTP access, session isolation, Master/SRP preservation and private floating notices; loopback only.");
