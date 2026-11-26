import assert from "node:assert/strict";
import {remoteRetentionRequest,REMOTE_RETENTION_PROJECTS} from "../../supabase/functions/_shared/retention-relay.ts";
import {createRetentionHandler} from "./remote-gateway-fixture/branchline-retention/handler.ts";
const actor={userId:"00000000-0000-0000-0000-000000000001",role:"SYSTEM_ADMIN",mustChangePassword:false};
Deno.test("central relay routes real signed HTTP requests to three isolated receiver instances",async()=>{
 const originalFetch=globalThis.fetch,servers:Deno.HttpServer[]=[];
 const routes=new Map<string,string>(),secrets=new Map<string,string>(),states=new Map<string,{days:number;seen:Set<string>}>();
 const sent:{url:string;headers:Headers;body:string}[]=[];
 try{
  for(const [name,config] of Object.entries(REMOTE_RETENTION_PROJECTS)){
   const secret="fixture-only-"+name+"-"+crypto.randomUUID(),state={days:60,seen:new Set<string>()};
   Deno.env.set(config.secret,secret);secrets.set(name,secret);states.set(name,state);
   const handler=createRetentionHandler({project:config.ref,getEnv:n=>n==="BRANCHLINE_RETENTION_RELAY_SECRET"?secret:undefined,createAdmin:()=>({rpc:async(method:string,p:Record<string,unknown>)=>{
    if(method==="branchline_retention_consume_request"){const id=String(p.p_request_id);if(state.seen.has(id))return {data:false};state.seen.add(id);return {data:true};}
    if(method==="branchline_storage_review")return {data:{project:name,policy:{retentionDays:state.days,enabled:false}}};
    if(method==="branchline_retention_configure"){state.days=Number(p.p_days);return {data:null};}
    if(method==="branchline_retention_candidates")return {data:[]};
    if(method==="branchline_retention_notices")return {data:[{id:name+":fixture"}]};
    throw Error("Unexpected RPC "+method);
   }})});
   const server=Deno.serve({hostname:"127.0.0.1",port:0,onListen:()=>{}},handler);servers.push(server);
   routes.set("https://"+config.ref+".supabase.co/functions/v1/branchline-retention","http://127.0.0.1:"+(server.addr as Deno.NetAddr).port);
  }
  globalThis.fetch=async (input,init)=>{
   const url=String(input),local=routes.get(url);if(!local)throw Error("Unexpected network route");
   assert.equal(init?.redirect,"error");
   const headers=new Headers(init?.headers),body=String(init?.body);
   assert.equal(headers.has("authorization"),false);assert.equal(headers.has("apikey"),false);
   sent.push({url,headers,body});
   return await originalFetch(local,init);
  };
  for(const name of Object.keys(REMOTE_RETENTION_PROJECTS)){
   const r=await remoteRetentionRequest(actor,name,"overview");
   assert.equal((r.data as {project:string}).project,name);
  }
  await remoteRetentionRequest(actor,"sales","configure",{days:90,enabled:false,confirmed:true,actorId:"forged",action:"hold",requestId:"forged"});
  const saved=sent.at(-1)!;
  assert.equal(JSON.parse(saved.body).actorId,actor.userId);
  assert.equal(JSON.parse(saved.body).action,"configure");
  assert.notEqual(JSON.parse(saved.body).requestId,"forged");
  assert.equal(states.get("sales")!.days,90);
  assert.equal(states.get("megaframe")!.days,60);assert.equal(states.get("flyer")!.days,60);
  const replay=await originalFetch(routes.get(saved.url)!,{method:"POST",headers:saved.headers,body:saved.body});assert.equal(replay.status,409);await replay.text();
  const target=REMOTE_RETENTION_PROJECTS.megaframe.ref;
  const wrong=await originalFetch(routes.get("https://"+target+".supabase.co/functions/v1/branchline-retention")!,{method:"POST",headers:saved.headers,body:saved.body});assert.equal(wrong.status,403);await wrong.text();
  const edited=await originalFetch(routes.get(saved.url)!,{method:"POST",headers:saved.headers,body:saved.body.replace('"days":90','"days":120')});assert.equal(edited.status,403);await edited.text();
  const count=sent.length;
  await assert.rejects(()=>remoteRetentionRequest({...actor,role:"BRANCH_ADMIN"},"sales","overview"),/Forbidden/);
  await assert.rejects(()=>remoteRetentionRequest({...actor,mustChangePassword:true},"sales","overview"),/Forbidden/);
  await assert.rejects(()=>remoteRetentionRequest(actor,"untrusted","overview"),/Forbidden/);
  Deno.env.delete(REMOTE_RETENTION_PROJECTS.flyer.secret);
  await assert.rejects(()=>remoteRetentionRequest(actor,"flyer","overview"),/not configured/);
  assert.equal(sent.length,count);
  await assert.rejects(()=>remoteRetentionRequest(actor,"sales","cleanup",{dryRun:false,confirmed:true}),/not confirmed/);
  const dry=await remoteRetentionRequest(actor,"sales","cleanup",{dryRun:true});assert.equal((dry.cleanup as {deleted:number}).deleted,0);
 }finally{
  globalThis.fetch=originalFetch;
  for(const config of Object.values(REMOTE_RETENTION_PROJECTS))Deno.env.delete(config.secret);
  await Promise.all(servers.map(s=>s.shutdown()));
 }
});
