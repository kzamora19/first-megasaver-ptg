// Execute ONLY against the disposable postgres:16 GitHub Actions service.
// It exercises the real staged migration and PostgreSQL row-lock semantics.
// It does not assert that Supabase Edge HTTP end-to-end has passed.
import test from "node:test";
import assert from "node:assert/strict";
import {spawn,spawnSync} from "node:child_process";
import {allowedPtgStudioRole,sessionIsLive} from "../supabase/functions/_shared/studio-access-policy.mjs";

if(process.env.PTG_EPHEMERAL_DATABASE_TEST!=="1"||process.env.PGDATABASE!=="ptg_studio_test"||
   !["127.0.0.1","localhost"].includes(process.env.PGHOST)){
 throw Error("Refusing to run database security tests outside the disposable local test database.");
}
function psql(sql,{expectFailure=false}={}){
 const result=spawnSync("psql",["-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-c",sql],{
  encoding:"utf8",env:process.env,timeout:15000});
 if(expectFailure){assert.notEqual(result.status,0,"Query should have failed");return result.stderr;}
 assert.equal(result.status,0,result.stderr||result.stdout);
 return result.stdout.trim();
}
function psqlConcurrent(sql){
 return new Promise((resolve,reject)=>{
  const child=spawn("psql",["-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-c",sql],{env:process.env});
  let out="",err="";
  child.stdout.on("data",x=>out+=x);
  child.stderr.on("data",x=>err+=x);
  child.on("error",reject);
  child.on("close",c=>c===0?resolve(out.trim()):reject(Error("psql failed: "+err)));
 });
}
function claimedRows(stdout){
 const vals=stdout.split(/\s+/).filter(x=>x==="0"||x==="1").map(Number);
 assert.equal(vals.length,1,"Expected exactly one numeric affected-row result, got "+JSON.stringify(stdout));
 return vals[0];
}
const person=i=>"20000000-0000-4000-8000-"+String(i).padStart(12,"0");
const appSession=i=>"30000000-0000-4000-8000-"+String(i).padStart(12,"0");
const A="a".repeat(64),B="b".repeat(64),C="c".repeat(64),D="d".repeat(64),E="e".repeat(64);
function activeSource(i){
 const raw=psql(`SELECT row_to_json(x) FROM (
 SELECT row_to_json(p) AS profile,row_to_json(s) AS session,row_to_json(b) AS branch
 FROM public.app_sessions s JOIN public.user_profiles p ON p.id=s.user_id
 LEFT JOIN public.branches b ON b.id=s.branch_id
 WHERE s.id='${appSession(i)}'::uuid
 ) AS x`);
 const {profile,session,branch}=JSON.parse(raw);
 return allowedPtgStudioRole(profile)&&sessionIsLive(session,profile)&&
  (!session.branch_id||(branch?.status==="ACTIVE"&&branch?.operational_status==="ON"));
}

test("PTG-only encrypted backups cannot be read or written by Studio Auth sessions",()=>{
 const table="ptg_studio_cloud_backups";
 assert.equal(psql("SELECT relrowsecurity FROM pg_class WHERE oid='public."+table+"'::regclass"),"t");
 for(const role of ["anon","authenticated"]){
   for(const privilege of ["SELECT","INSERT","UPDATE","DELETE"])
     assert.equal(psql("SELECT has_table_privilege('"+role+"','public."+table+"','"+privilege+"')"),"f");
   assert.match(psql("SET ROLE "+role+"; SELECT * FROM public."+table+"",{expectFailure:true}),/permission denied/);
 }
 for(const privilege of ["SELECT","INSERT","UPDATE"])
   assert.equal(psql("SELECT has_table_privilege('service_role','public."+table+"','"+privilege+"')"),"t");
 const f="public.ptg_studio_cloud_write(text,uuid,text,text,text,integer)";
 for(const role of ["anon","authenticated"])
  assert.equal(psql("SELECT has_function_privilege('"+role+"','"+f+"','EXECUTE')"),"f");
 assert.equal(psql("SELECT has_function_privilege('service_role','"+f+"','EXECUTE')"),"t");
 assert.equal(psql("SELECT prosecdef FROM pg_proc WHERE oid='"+f+"'::regprocedure"),"f");
});
test("client-side encrypted cloud snapshots enforce per-PTG actor, Studio scope and revision CAS",async()=>{
 const fn=(studio,owner,key,iv,encrypted,version)=>`SELECT coalesce(
  public.ptg_studio_cloud_write('${studio}','${owner}'::uuid,'${key}','${iv}','${encrypted}',${version})::text,'null')`;
 const owner1=person(1),owner2=person(2),iv="I".repeat(16),cipher="Q".repeat(64),key="project_testABC";
 assert.equal(psql("SET ROLE service_role; "+fn("megaframe",owner1,key,iv,cipher,0)),"1");
 assert.equal(psql("SET ROLE service_role; "+fn("megaframe",owner1,key,iv,cipher,0)),"null",
   "Second device must not overwrite without an expected version");
 assert.equal(psql("SET ROLE service_role; "+fn("megaframe",owner1,key,iv,cipher,1)),"2");
 assert.equal(psql("SET ROLE service_role; "+fn("megaframe",owner1,key,iv,cipher,1)),"null",
   "Stale write denied");
 assert.equal(psql("SET ROLE service_role; "+fn("megaframe",owner2,key,iv,cipher,0)),"1",
   "Second PTG account receives separate encrypted backup");
 assert.equal(psql("SET ROLE service_role; "+fn("flyer",owner1,"p:current",iv,cipher,0)),"1",
   "Same PTG user has independent Studio namespace");
 const count=psql("SELECT count(*) FROM public.ptg_studio_cloud_backups WHERE owner_ptg_id='"+owner1+"'");
 assert.equal(count,"2");
 assert.match(psql("SET ROLE service_role; "+fn("flyer",owner1,"p:current",iv,"raw plaintext!",1),
   {expectFailure:true}),/check constraint/);
});

test("staging migration enforces RLS and forbids browser-table privileges",()=>{
 for(const table of ["ptg_studio_access_tickets","ptg_studio_proof_sessions"]){
  const security=JSON.parse(psql(`SELECT row_to_json(q) FROM (
   SELECT c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
     has_table_privilege('anon','public.${table}','SELECT') AS anon_select,
     has_table_privilege('anon','public.${table}','INSERT') AS anon_insert,
     has_table_privilege('authenticated','public.${table}','SELECT') AS auth_select,
     has_table_privilege('authenticated','public.${table}','UPDATE') AS auth_update,
     has_table_privilege('service_role','public.${table}','SELECT') AS service_select,
     has_table_privilege('service_role','public.${table}','UPDATE') AS service_update
   FROM pg_class c WHERE c.oid='public.${table}'::regclass
  ) q`));
  assert.equal(security.rls,true);
  for(const prop of ["anon_select","anon_insert","auth_select","auth_update"])assert.equal(security[prop],false,table+" "+prop);
  assert.equal(security.service_select,true);
  assert.equal(security.service_update,true);
  assert.match(psql(`SET ROLE anon; SELECT * FROM public.${table};`,{expectFailure:true}),/permission denied/);
 }
});
test("source policy evaluated against real disposable PTG profile/session/branch rows",()=>{
 const authorized=[1,2,3,13,14,15];
 const denied=[4,5,6,7,8,9,10,11,12];
 for(const i of authorized)assert.equal(activeSource(i),true,"allowed synthetic profile "+i);
 for(const i of denied)assert.equal(activeSource(i),false,"denied synthetic profile "+i);
 // Force logout immediately invalidates the source session.
 psql(`UPDATE public.app_sessions SET revoked_at=now() WHERE id='${appSession(14)}'`);
 assert.equal(activeSource(14),false);
 // Incremented session_version invalidates previously issued source sessions.
 psql(`UPDATE public.user_profiles SET session_version=2 WHERE id='${person(15)}'`);
 assert.equal(activeSource(15),false);
 // Downgrade an already-authorized TL and verify denial.
 psql(`UPDATE public.user_profiles SET legacy_role='BRANCH USER' WHERE id='${person(3)}'`);
 assert.equal(activeSource(3),false);
});
test("only one concurrent request can redeem a Studio ticket; cross-Studio use is rejected",async()=>{
 const uid=person(1),sid=appSession(1);
 psql(`INSERT INTO public.ptg_studio_access_tickets(ticket_hash,studio_id,user_id,app_session_id,expires_at)
 VALUES ('${A}','flyer','${uid}','${sid}',now()+interval '5 minutes')`);
 const redeem=(hash,studio)=>`BEGIN;
 WITH claimed AS (
  UPDATE public.ptg_studio_access_tickets SET redeemed_at=clock_timestamp()
  WHERE ticket_hash='${hash}' AND studio_id='${studio}'
    AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp()
  RETURNING ticket_hash
 ) SELECT COUNT(*) FROM claimed;
 SELECT pg_sleep(0.4); COMMIT;`;
 const wrong=claimedRows(psql(redeem(A,"megaframe")));
 assert.equal(wrong,0);
 const attempts=await Promise.all([psqlConcurrent(redeem(A,"flyer")),psqlConcurrent(redeem(A,"flyer"))]);
 assert.deepEqual(attempts.map(claimedRows).sort(),[0,1],"No double redemption under actual row locks");
 assert.equal(claimedRows(psql(redeem(A,"flyer"))),0,"Replay must be rejected");
 const count=psql(`SELECT COUNT(*) FROM public.ptg_studio_access_tickets WHERE ticket_hash='${A}' AND redeemed_at IS NOT NULL`);
 assert.equal(count,"1");
});
test("expired/revoked grants cannot be redeemed; SQL TTL cap rejects excessive expiry",()=>{
 psql(`INSERT INTO public.ptg_studio_access_tickets(ticket_hash,studio_id,user_id,app_session_id,expires_at)
 VALUES ('${B}','flyer','${person(2)}','${appSession(2)}',now()-interval '1 minute'),
        ('${C}','flyer','${person(2)}','${appSession(2)}',now()+interval '3 minutes')`);
 psql(`UPDATE public.ptg_studio_access_tickets SET revoked_at=now() WHERE ticket_hash='${C}'`);
 for(const hash of [B,C]){
  const count=psql(`WITH claimed AS (
   UPDATE public.ptg_studio_access_tickets SET redeemed_at=now()
   WHERE ticket_hash='${hash}' AND studio_id='flyer' AND redeemed_at IS NULL
    AND revoked_at IS NULL AND expires_at>now() RETURNING ticket_hash
  ) SELECT COUNT(*) FROM claimed`);
  assert.equal(count,"0",hash+" must not redeem");
 }
 assert.match(psql(`INSERT INTO public.ptg_studio_access_tickets(ticket_hash,studio_id,user_id,app_session_id,expires_at)
 VALUES ('${D}','flyer','${person(2)}','${appSession(2)}',now()+interval '11 minutes')`,
 {expectFailure:true}),/check constraint/);
});
test("signed challenge rotation uses real atomic compare-and-swap; old proof is rejected",async()=>{
 const sessionId=psql(`INSERT INTO public.ptg_studio_proof_sessions
 (studio_id,user_id,app_session_id,public_jwk,challenge_hash,challenge_expires_at,expires_at)
 VALUES ('flyer','${person(2)}','${appSession(2)}',
 '{"kty":"EC","crv":"P-256","x":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","y":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"}'::jsonb,
 '${D}',now()+interval '90 seconds',now()+interval '45 minutes') RETURNING id`);
 assert.match(sessionId,/^[0-9a-f-]{36}$/);
 const rotate=(oldHash,newHash)=>`BEGIN;
 WITH claimed AS (
  UPDATE public.ptg_studio_proof_sessions
    SET challenge_hash='${newHash}',challenge_expires_at=now()+interval '90 seconds'
  WHERE id='${sessionId}' AND studio_id='flyer' AND challenge_hash='${oldHash}'
    AND revoked_at IS NULL AND expires_at>now() AND challenge_expires_at>now()
  RETURNING id
 ) SELECT COUNT(*) FROM claimed;
 SELECT pg_sleep(0.4); COMMIT;`;
 const attempts=await Promise.all([psqlConcurrent(rotate(D,E)),psqlConcurrent(rotate(D,E))]);
 assert.deepEqual(attempts.map(claimedRows).sort(),[0,1]);
 assert.equal(claimedRows(psql(rotate(D,C))),0,"Previously consumed challenge must fail");
 assert.equal(claimedRows(psql(rotate(E,D))),1,"Current challenge may rotate once");
 psql(`UPDATE public.ptg_studio_proof_sessions SET revoked_at=now() WHERE id='${sessionId}'`);
 assert.equal(claimedRows(psql(rotate(D,E))),0,"Revoked session must fail proof");
});
test("expired proofs and grants cannot be extended beyond SQL limits",()=>{
 psql(`INSERT INTO public.ptg_studio_proof_sessions
 (studio_id,user_id,app_session_id,public_jwk,challenge_hash,challenge_expires_at,expires_at)
 VALUES ('flyer','${person(2)}','${appSession(2)}','{}'::jsonb,
 '${A}',now()-interval '1 minute',now()+interval '5 minutes')`);
 const old=psql(`WITH updated AS (UPDATE public.ptg_studio_proof_sessions
 SET challenge_hash='${C}' WHERE challenge_hash='${A}'
 AND challenge_expires_at>now() AND expires_at>now() RETURNING id)
 SELECT count(*) FROM updated`);
 assert.equal(old,"0");
 assert.match(psql(`INSERT INTO public.ptg_studio_proof_sessions
 (studio_id,user_id,app_session_id,public_jwk,challenge_hash,challenge_expires_at,expires_at)
 VALUES ('flyer','${person(2)}','${appSession(2)}','{}'::jsonb,
 '${B}',now()+interval '1 minute',now()+interval '3 hours')`,{expectFailure:true}),/check constraint/);
});

test("only service_role can reserve launch slots; 12/min atomic quota and reset",async()=>{
 const fn="public.ptg_studio_reserve_issue_slot(uuid)";
 assert.equal(psql("SELECT has_function_privilege('anon','"+fn+"','EXECUTE')"),"f");
 assert.equal(psql("SELECT has_function_privilege('authenticated','"+fn+"','EXECUTE')"),"f");
 assert.equal(psql("SELECT has_function_privilege('service_role','"+fn+"','EXECUTE')"),"t");
 assert.equal(psql("SELECT prosecdef FROM pg_proc WHERE oid='"+fn+"'::regprocedure"),"f",
   "Quota function must be SECURITY INVOKER, not SECURITY DEFINER");
 assert.match(psql("SET ROLE authenticated; SELECT public.ptg_studio_reserve_issue_slot('"+
   person(1)+"')",{expectFailure:true}),/permission denied/);
 const call=()=>psqlConcurrent("SET ROLE service_role; SELECT public.ptg_studio_reserve_issue_slot('"+
  person(1)+"'::uuid)");
 const replies=await Promise.all(Array.from({length:23},call));
 assert.equal(replies.filter(x=>x==="t").length,12,"Twelve concurrent launches accepted");
 assert.equal(replies.filter(x=>x==="f").length,11,"Excess requests denied atomically");
 const count=psql("SELECT attempts::text FROM public.ptg_studio_issue_limits WHERE user_id='"+
  person(1)+"'");
 assert.equal(count,"12");
 psql("UPDATE public.ptg_studio_issue_limits SET window_started_at=now()-interval '65 seconds' WHERE user_id='"+
  person(1)+"'");
 assert.equal(await call(),"t","One new launch allowed in the next window");
 assert.equal(psql("SELECT attempts::text FROM public.ptg_studio_issue_limits WHERE user_id='"+
  person(1)+"'"),"1");
});
