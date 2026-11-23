// CI ONLY: real local Supabase Auth (GoTrue) + PostgREST + Postgres,
// and the actual PTG Deno Edge handler. No hosted project, no real accounts.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawn} from "node:child_process";
import {setTimeout as pause} from "node:timers/promises";
import {webcrypto} from "node:crypto";
import {createClient} from "@supabase/supabase-js";

assert.equal(process.env.CI,"true");
assert.equal(process.env.PTG_STUDIO_LOCAL_E2E,"1");
const path=process.env.PTG_STUDIO_LOCAL_STATUS_PATH;
assert.ok(path?.startsWith("/"),"Explicit local stack status path required");
const cfg={};
for(const line of readFileSync(path,"utf8").split(/\r?\n/)){
 const i=line.indexOf("=");
 if(i<1)continue;
 let v=line.slice(i+1).trim();
 if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);
 cfg[line.slice(0,i).trim()]=v;
}
assert.ok(cfg.API_URL&&cfg.DB_URL&&cfg.ANON_KEY&&cfg.SERVICE_ROLE_KEY);
const api=new URL(cfg.API_URL),db=new URL(cfg.DB_URL);
assert.equal(api.hostname,"127.0.0.1");assert.equal(api.protocol,"http:");
assert.equal(api.port,"54321");
assert.equal(db.hostname,"127.0.0.1");assert.equal(db.protocol,"postgresql:");
assert.equal(db.port,"54322");assert.equal(db.pathname,"/postgres");
const opt={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(cfg.API_URL,cfg.SERVICE_ROLE_KEY,opt);
const issuer="https://kzamora19.github.io",secret="ci-gateway-"+"G".repeat(48);
const uuid=n=>"30000000-0000-4000-8000-"+String(n).padStart(12,"0");
const branchA="10000000-0000-4000-8000-000000000001";
const branchOff="10000000-0000-4000-8000-000000000002";
const future=n=>new Date(Date.now()+n*60_000).toISOString();
const past=n=>new Date(Date.now()-n*60_000).toISOString();
const users=new Map();
let edge;
const ok=(r,label)=>assert.equal(r.error,null,label+" "+JSON.stringify(r.error));
const post=async(body,headers={})=>{
 const response=await fetch("http://127.0.0.1:8000/",{
  method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)
 });
 return {status:response.status,data:await response.json()};
};
const issue=(n,studio="flyer",origin=issuer,session=uuid(n))=>post(
 {action:"issue",studio},{origin,apikey:cfg.ANON_KEY,
  authorization:"Bearer "+users.get(n).token,"x-ptg-session-id":session});
const exchange=(ticket,key,studio="flyer")=>post(
 {action:"exchange",studio,ticket,publicKey:key},{"x-ptg-studio-secret":secret});
const prove=(session,signature,studio="flyer")=>post(
 {action:"prove",studio,sessionId:session.sessionId,challenge:session.challenge,signature},
 {"x-ptg-studio-secret":secret});
const keys=()=>webcrypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
const sign=async(key,studio,data)=>{
 const msg="ptg-studio-v1|"+studio+"|"+data.sessionId+"|"+data.challenge;
 return Buffer.from(await webcrypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},
  key,new TextEncoder().encode(msg))).toString("base64url");
};
async function fixture(){
 ok(await admin.from("branches").insert([
  {id:branchA,status:"ACTIVE",operational_status:"ON"},
  {id:branchOff,status:"ACTIVE",operational_status:"OFF"}
 ]),"local branches");
 for(let i=1;i<=9;i++){
  const email="ptg-studio-local-"+i+"@example.invalid",password="LocalPTG-Test2026-NotForProduction!";
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
  ok(created,"local GoTrue createUser "+i);
  const auth=createClient(cfg.API_URL,cfg.ANON_KEY,opt);
  const logged=await auth.auth.signInWithPassword({email,password});
  ok(logged,"local GoTrue login "+i);
  assert.equal(logged.data.user.id,created.data.user.id);
  users.set(i,{id:created.data.user.id,token:logged.data.session.access_token,auth});
  ok(await admin.from("user_profiles").insert({
   id:created.data.user.id,
   role_key:i===1?"SYSTEM_ADMIN":i===2?"BRANCH_ADMIN":"BRANCH_USER",
   legacy_role:i===4?"BRANCH USER":"TEAM LEADER",is_active:i!==5,
   must_change_password:i===9,session_version:i===8?2:1
  }),"local profile "+i);
  ok(await admin.from("app_sessions").insert({
   id:uuid(i),user_id:created.data.user.id,branch_id:i===7?branchOff:branchA,
   session_version:1,remember_device:false,
   expires_at:future(90),last_activity_at:past(1),revoked_at:i===6?past(1):null
  }),"local PTG source session "+i);
 }
}
async function startEdge(){
 edge=spawn("deno",["run","--allow-all","supabase/functions/ptg-studio-access/index.ts"],{
  env:{...process.env,SUPABASE_URL:cfg.API_URL,
   SUPABASE_SECRET_KEY:cfg.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:cfg.ANON_KEY,
   SUPABASE_SERVICE_ROLE_KEY:cfg.SERVICE_ROLE_KEY,SUPABASE_ANON_KEY:cfg.ANON_KEY,
   PTG_STUDIO_ISSUER_ORIGIN:issuer,PTG_STUDIO_GATEWAY_SECRET:secret,
   PTG_STUDIO_DRAFT_RECOVERY_SECRET:"ci-recovery-"+"R".repeat(48)
  },stdio:["ignore","pipe","pipe"]
 });
 let out="";
 edge.stderr.on("data",d=>out+=d.toString().slice(-1500));
 edge.stdout.on("data",d=>out+=d.toString().slice(-1500));
 for(let i=0;i<180;i++){
  if(edge.exitCode!==null||edge.signalCode!==null)throw Error("PTG Deno Edge failed: "+out.slice(-1500));
  try{const r=await fetch("http://127.0.0.1:8000/",{signal:AbortSignal.timeout(200)});
   if(r.status===405)return;}catch{}
  await pause(200);
 }
 throw Error("PTG Deno Edge timeout: "+out.slice(-1500));
}
try{
 await fixture();
 // Real browser JWTs cannot access private PTG tables directly.
 const blocked=await users.get(4).auth.from("user_profiles").select("id");
 assert.ok(blocked.error,"Authenticated branch user must not query protected profiles");
 const tickets=await users.get(3).auth.from("ptg_studio_access_tickets").select("ticket_hash");
 assert.ok(tickets.error,"Even TL cannot query server-only ticket table");
 await startEdge();
 for(const i of [1,2,3]){
  const r=await issue(i);
  assert.equal(r.status,200,"Real GoTrue eligible account "+i+": "+JSON.stringify(r.data));
  assert.match(r.data.ticket,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(r.data.draftKey,undefined);
 }
 for(const i of [4,5,6,7,8,9]){
  const r=await issue(i);
  assert.equal(r.status,403,"Denied user "+i+": "+JSON.stringify(r.data));
 }
 assert.equal((await issue(3,"flyer","https://untrusted.example")).status,403);
 assert.equal((await issue(1,"flyer",issuer,uuid(3))).status,403);
 assert.equal((await post({action:"issue",studio:"flyer"},{
  origin:issuer,apikey:cfg.ANON_KEY,
  authorization:"Bearer invalid-JWT","x-ptg-session-id":uuid(3)
 })).status,401);
 const pair=await keys(),publicKey=await webcrypto.subtle.exportKey("jwk",pair.publicKey);
 const t=await issue(3);
 assert.equal(t.status,200);
 const attempts=await Promise.all([exchange(t.data.ticket,publicKey),exchange(t.data.ticket,publicKey)]);
 assert.deepEqual(attempts.map(x=>x.status).sort(),[200,403],
  "Postgres must atomically redeem single-use ticket through actual PostgREST");
 const first=attempts.find(x=>x.status===200).data;
 assert.match(first.draftScope,/^[A-Za-z0-9_-]{43}$/);
 assert.match(first.draftKey,/^[A-Za-z0-9_-]{43}$/);
 assert.equal((await exchange(t.data.ticket,publicKey)).status,403);
 const forgedPair=await keys();
 assert.equal((await prove(first,await sign(forgedPair.privateKey,"flyer",first))).status,403);
 const signature=await sign(pair.privateKey,"flyer",first);
 const proofs=await Promise.all([prove(first,signature),prove(first,signature)]);
 assert.deepEqual(proofs.map(x=>x.status).sort(),[200,403],
  "Postgres must atomically consume signed challenge through actual PostgREST");
 assert.equal(proofs.find(x=>x.status===200).data.draftKey,undefined);
 const newTicket=await issue(3);
 assert.equal(newTicket.status,200);
 const restored=await exchange(newTicket.data.ticket,publicKey);
 assert.equal(restored.status,200);
 assert.equal(restored.data.draftKey,first.draftKey);
 assert.equal(restored.data.draftScope,first.draftScope);
 const account2=await issue(2);
 const other=await exchange(account2.data.ticket,publicKey);
 assert.equal(other.status,200);assert.notEqual(other.data.draftKey,first.draftKey);
 const frame=await issue(3,"megaframe");
 const frameAuth=await exchange(frame.data.ticket,publicKey,"megaframe");
 assert.equal(frameAuth.status,200);assert.notEqual(frameAuth.data.draftKey,first.draftKey);
 // Real PostgREST + PostgreSQL quota under concurrent requests, for both
 // MegaFrame and MegaFlyer: quota is per PTG user, not per browser or app.
 const burst=await Promise.all(Array.from({length:18},(_,i)=>
  issue(1,i%2?"flyer":"megaframe")));
 assert.equal(burst.filter(x=>x.status===200).length,11,
  "Eleven remaining slots after first issue for the System Admin");
 assert.equal(burst.filter(x=>x.status===429).length,7,
  "Atomic quota denies excess simultaneous requests across Studios");
 // PTG forced logout denies signed continuation even with a valid Auth JWT.
 ok(await admin.from("app_sessions").update({revoked_at:new Date().toISOString()})
  .eq("id",uuid(3)),"local forced logout");
 assert.equal((await prove(restored.data,await sign(pair.privateKey,"flyer",restored.data))).status,403);
 assert.equal((await issue(3)).status,403);
 console.log("PASS: genuine local GoTrue sign-in + PostgREST/RLS + PostgreSQL/Edge concurrency, roles, revocation and recovery isolation.");
 console.log("LIMIT: local disposable stack only; no hosted PTG users or production migration.");
}finally{
 if(edge){
  const finished=new Promise(resolve=>edge.once("exit",resolve));
  edge.kill("SIGTERM");
  await Promise.race([finished,pause(1000)]);
  if(edge.exitCode===null&&edge.signalCode===null)edge.kill("SIGKILL");
 }
}
