// PTG Studio HTTP acceptance: actual Deno Edge entrypoint + real supabase-js.
// Supabase Auth and PostgREST are emulated on localhost. NO production connections,
// tokens, Supabase projects, or database writes. PostgreSQL locking is tested separately.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {setTimeout as pause} from "node:timers/promises";
import {webcrypto} from "node:crypto";

if(process.env.PTG_STUDIO_EDGE_HTTP_TEST!=="1" || process.env.CI!=="true")
 throw Error("This edge harness is for isolated CI only.");

const issuer="https://kzamora19.github.io";
const serviceKey="local-service-only-"+"K".repeat(40);
const publishableKey="local-publishable-"+"P".repeat(40);
const gatewaySecret="test-gateway-secret-"+"G".repeat(40);
const userId=i=>"20000000-0000-4000-8000-"+String(i).padStart(12,"0");
const sessionId=i=>"30000000-0000-4000-8000-"+String(i).padStart(12,"0");
const branchId="10000000-0000-4000-8000-000000000001";
const now=()=>new Date().toISOString();
const future=(minutes)=>new Date(Date.now()+minutes*60_000).toISOString();
const ago=(minutes)=>new Date(Date.now()-minutes*60_000).toISOString();
const tables={
 branches:[{id:branchId,status:"ACTIVE",operational_status:"ON"}],
 user_profiles:[],
 app_sessions:[],
 ptg_studio_access_tickets:[],
 ptg_studio_proof_sessions:[],
};
for(let i=1;i<=9;i++){
 tables.user_profiles.push({
  id:userId(i),role_key:i===1?"SYSTEM_ADMIN":i===2?"BRANCH_ADMIN":"BRANCH_USER",
  legacy_role:i===4?"BRANCH USER":"TEAM LEADER",is_active:i!==5,
  must_change_password:i===8,session_version:i===9?2:1
 });
 tables.app_sessions.push({
  id:sessionId(i),user_id:userId(i),branch_id:branchId,
  session_version:1,remember_device:false,
  expires_at:future(90),last_activity_at:ago(1),revoked_at:i===6?now():null
 });
}
const authTokens=new Map([...Array(9)].map((_,i)=>["mock-access-"+(i+1),userId(i+1)]));
const json=(res,value,status=200,headers={})=>{
 res.writeHead(status,{"Content-Type":"application/json",...headers});
 res.end(JSON.stringify(value));
};
const trace=[];
function matches(row,params){
 for(const [key,value] of params){
  if(key==="select"||key==="order"||key==="limit"||key==="offset")continue;
  if(value.startsWith("eq.") && String(row[key])!==value.slice(3))return false;
  if(value==="is.null" && row[key]!=null)return false;
  if(value.startsWith("gt.") && !(Date.parse(row[key])>Date.parse(value.slice(3))))return false;
 }
 return true;
}
const fakeBackend=createServer(async(req,res)=>{
 const pathname=new URL(req.url,"http://127.0.0.1").pathname;
 const url=new URL(req.url,"http://127.0.0.1");
 if(pathname==="/auth/v1/user" && req.method==="GET"){
  const auth=(req.headers.authorization||"").replace(/^Bearer /,"");
  const id=authTokens.get(auth);
  return id?json(res,{id,email:"tester@example.invalid"}):json(res,{message:"invalid jwt"},401);
 }
 if(!pathname.startsWith("/rest/v1/"))return json(res,{message:"Unknown local route"},404);
 // The server-only API key is mandatory for every PTG table mutation/read.
 if(req.headers.apikey!==serviceKey)return json(res,{message:"Service role required"},403);
 const table=pathname.split("/").at(-1);
 const rows=tables[table];
 if(!rows)return json(res,{message:"Unknown table"},404);
 const found=rows.filter(r=>matches(r,url.searchParams));
 const selected=url.searchParams.get("select");
 const wantsOne=String(req.headers.accept||"").includes("application/vnd.pgrst.object+json");
 const respond=(data,status)=>{
  const result=Array.isArray(data)?data.map(r=>({...r})):{...data};
  return json(res,wantsOne?(Array.isArray(result)?result[0]??null:result):result,status);
 };
 trace.push({method:req.method,table,match:found.length});
 if(req.method==="GET")return respond(found,200);
 let raw="";for await(const part of req)raw+=part;
 let body;
 try{body=JSON.parse(raw||"{}");}catch{return json(res,{message:"bad json"},400);}
 if(req.method==="POST"){
  const item={...body};
  if(table==="ptg_studio_access_tickets")item.redeemed_at??=null;
  if(table==="ptg_studio_proof_sessions")item.id??="40000000-0000-4000-8000-"+String(rows.length+1).padStart(12,"0");
  rows.push(item);
  return respond([item],201);
 }
 if(req.method==="PATCH"){
  for(const row of found)Object.assign(row,body);
  return respond(found,200);
 }
 return json(res,{message:"Not implemented"},405);
});
const listen=()=>new Promise(resolve=>fakeBackend.listen(0,"127.0.0.1",resolve));
const run=(method,body,headers={})=>fetch("http://127.0.0.1:8000/",{
 method,headers:{"Content-Type":"application/json",...headers},
 body:method==="POST"?JSON.stringify(body):undefined
});
const asJson=async(response)=>({status:response.status,data:await response.json()});
const issue=(i,studio="flyer",origin=issuer)=>run("POST",{action:"issue",studio},{
 origin,apikey:publishableKey,authorization:"Bearer mock-access-"+i,
 "x-ptg-session-id":sessionId(i)
}).then(asJson);
const exchange=(ticket,publicKey,studio="flyer",secret=gatewaySecret)=>run("POST",
 {action:"exchange",studio,ticket,publicKey},{"x-ptg-studio-secret":secret}).then(asJson);
const prove=(studio,data,signature)=>run("POST",{
 action:"prove",studio,sessionId:data.sessionId,challenge:data.challenge,signature
},{"x-ptg-studio-secret":gatewaySecret}).then(asJson);
const pair=()=>webcrypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
const signature=async(privateKey,studio,challengeData)=>{
 const message="ptg-studio-v1|"+studio+"|"+challengeData.sessionId+"|"+challengeData.challenge;
 const bytes=await webcrypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},privateKey,new TextEncoder().encode(message));
 return Buffer.from(bytes).toString("base64url");
};
let deno;
try{
 await listen();
 const backendPort=fakeBackend.address().port;
 deno=spawn("deno",["run","--allow-all","supabase/functions/ptg-studio-access/index.ts"],{
  env:{
   ...process.env,
   SUPABASE_URL:"http://127.0.0.1:"+backendPort,
   SUPABASE_SECRET_KEY:serviceKey,
   SUPABASE_PUBLISHABLE_KEY:publishableKey,
   PTG_STUDIO_GATEWAY_SECRET:gatewaySecret,
   PTG_STUDIO_ISSUER_ORIGIN:issuer,
  },stdio:["ignore","pipe","pipe"]
 });
 let errors="";
 deno.stderr.on("data",v=>{errors+=v.toString();});
 deno.stdout.on("data",v=>{errors+=v.toString();});
 let up=false;
 for(let i=0;i<160;i++){
  if(deno.exitCode!==null)throw Error("Deno exited: "+errors.slice(-1600));
  try{const res=await fetch("http://127.0.0.1:8000/",{signal:AbortSignal.timeout(150)});if(res.status===405){up=true;break;}}
  catch{}
  await pause(200);
 }
 assert.ok(up,"Actual Edge HTTP server should start: "+errors.slice(-1600));
 const badOrigin=await issue(3,"flyer","https://malicious.example");
 assert.equal(badOrigin.status,403,"Other origin cannot issue launch ticket");
 const noSession=await run("POST",{action:"issue",studio:"flyer"},{
  origin:issuer,authorization:"Bearer mock-access-3"
 }).then(asJson);
 assert.equal(noSession.status,401,"Missing PTG app session denied");
 for(const i of [1,2,3]){
  const authorized=await issue(i);
  assert.equal(authorized.status,200,"System/Branch Admin and Team Leader must issue: "+i+" "+JSON.stringify(authorized.data));
  assert.match(authorized.data.ticket,/^[A-Za-z0-9_-]{43}$/);
 }
 for(const i of [4,5,6,8,9]){
  const denied=await issue(i);
  assert.equal(denied.status,403,"Ordinary, disabled, revoked, reset-required and stale user must be denied: "+i);
 }
 const wrongAudience=await issue(1,"../../admin");
 assert.equal(wrongAudience.status,400);
 const issued=await issue(3);
 assert.equal(issued.status,200);
 const cryptoPair=await pair();
 const publicKey=await webcrypto.subtle.exportKey("jwk",cryptoPair.publicKey);
 assert.equal(publicKey.d,undefined,"Private key never transmitted");
 assert.equal((await exchange(issued.data.ticket,publicKey,"flyer","wrong-secret")).status,403);
 assert.equal((await exchange(issued.data.ticket,publicKey,"megaframe")).status,403,"Studio audience isolation");
 const first=await exchange(issued.data.ticket,publicKey);
 assert.equal(first.status,200,"Expected one-time launch exchange: "+JSON.stringify(first.data));
 assert.match(first.data.challenge,/^[A-Za-z0-9_-]{43}$/);
 assert.equal((await exchange(issued.data.ticket,publicKey)).status,403,"Consumed ticket cannot exchange twice");
 const tampered=await prove("flyer",first.data,"A".repeat(86));
 assert.equal(tampered.status,403,"Tampered signature denied");
 const crossStudio=await prove("megaframe",first.data,await signature(cryptoPair.privateKey,"megaframe",first.data));
 assert.equal(crossStudio.status,403);
 const sig=await signature(cryptoPair.privateKey,"flyer",first.data);
 const accepted=await prove("flyer",first.data,sig);
 assert.equal(accepted.status,200,"Valid signed challenge must rotate: "+JSON.stringify(accepted.data));
 assert.notEqual(accepted.data.challenge,first.data.challenge);
 assert.equal((await prove("flyer",first.data,sig)).status,403,"Old signed challenge is a replay");
 // Revoking the PTG source account must invalidate a valid outstanding proof.
 const original=tables.user_profiles.find(p=>p.id===userId(3));
 original.is_active=false;
 const revokedProof=await prove("flyer",accepted.data,await signature(cryptoPair.privateKey,"flyer",accepted.data));
 assert.equal(revokedProof.status,403,"Revoked user must be denied on next proof");
 original.is_active=true;
 // Source PTG session forced logout also blocks signed renewal.
 const freshIssue=await issue(3);
 assert.equal(freshIssue.status,200);
 const renewed=await exchange(freshIssue.data.ticket,publicKey);
 assert.equal(renewed.status,200);
 tables.app_sessions.find(s=>s.id===sessionId(3)).revoked_at=now();
 assert.equal((await prove("flyer",renewed.data,await signature(cryptoPair.privateKey,"flyer",renewed.data))).status,403);
 assert.ok(trace.some(t=>t.method==="PATCH"&&t.table==="ptg_studio_access_tickets"));
 assert.ok(trace.some(t=>t.method==="PATCH"&&t.table==="ptg_studio_proof_sessions"));
 console.log("PASS: actual Deno PTG Edge HTTP entrypoint + real supabase-js requests against isolated local Auth/PostgREST emulator.");
 console.log("PASS: TL/Admin eligibility, ordinary/disabled/forced logout denial, wrong origin/studio/secret, one-time redemption, signed proof, challenge replay, account revocation.");
 console.log("LIMIT: Local Auth/PostgREST is emulated, not a real Supabase staging project or live PTG accounts.");
} finally {
 if(deno){deno.kill("SIGTERM");await Promise.race([new Promise(resolve=>deno.once("exit",resolve)),pause(2000)]);}
 await new Promise(resolve=>fakeBackend.close(resolve));
}
