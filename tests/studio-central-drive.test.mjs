import test from "node:test";
import assert from "node:assert/strict";
import {centralDriveConfigured,centralDriveOperation} from
 "../supabase/functions/_shared/studio-central-drive.mjs";

const env={clientId:"owner-google-client",clientSecret:"server-only-client-secret",
 refreshToken:"server-only-refresh-token"};
const owner="11111111-2222-4333-8444-555555555555";
const other="66666666-7777-4888-9999-aaaaaaaaaaaa";
const rec={studio:"megaframe",ownerId:owner,recordKey:"project_example",
 iv:"x".repeat(16),encrypted:"Q".repeat(64)};
function fakeGoogle({email="kennethalvinzamora19@gmail.com"}={}){
 let folderCreated=false,record=null,metadata=null,remoteCalls=0;
 function reply(data,{headers={},status=200}={}){
  return {ok:status>=200&&status<300,status,headers:{get:k=>headers[k]||null},
   json:async()=>data,text:async()=>typeof data==="string"?data:JSON.stringify(data)};
 }
 const request=async(url,opts={})=>{
  remoteCalls++;
  assert.equal(opts.redirect,"error");
  assert.equal(opts.credentials,"omit");
  const u=new URL(url);
  if(u.hostname==="oauth2.googleapis.com"){
   assert.equal(u.pathname,"/token");
   assert.equal(opts.body.get("client_secret"),env.clientSecret);
   assert.equal(opts.body.get("refresh_token"),env.refreshToken);
   assert.equal(opts.headers.Authorization,undefined);
   return reply({access_token:"temporary-google-access"});
  }
  assert.equal(u.origin,"https://www.googleapis.com");
  assert.equal(opts.headers.Authorization,"Bearer temporary-google-access");
  if(u.pathname==="/drive/v3/about")return reply({user:{emailAddress:email}});
  if(u.pathname==="/drive/v3/files"&&opts.method==="POST"){
   folderCreated=true;return reply({id:"folder123456"});
  }
  if(u.pathname==="/drive/v3/files"&&(!opts.method||opts.method==="GET")){
   const q=u.searchParams.get("q");
   if(q.includes("mimeType = 'application/vnd.google-apps.folder'"))
    return reply({files:folderCreated?[{id:"folder123456",
      name:"Branchline Central Studio Backups"}]:[]});
   return reply({files:record?[{id:"file123456",size:String(JSON.stringify(record).length),
    modifiedTime:"2026-11-21T00:00:00Z",appProperties:metadata.appProperties}]:[]});
  }
  if(u.pathname==="/upload/drive/v3/files"&&opts.method==="POST"){
   assert.match(opts.headers["Content-Type"],/^multipart\/related; boundary=/);
   assert.ok(!opts.body.includes(env.refreshToken));
   const start=opts.body.indexOf('{"name":');
   const stop=opts.body.indexOf("\r\n--",start);
   metadata=JSON.parse(opts.body.slice(start,stop));
   const content=opts.body.indexOf('{"format":"BranchlineCentralEncryptedBackupV1"');
   assert.ok(content>0);
   record=JSON.parse(opts.body.slice(content,opts.body.indexOf("\r\n--",content)));
   assert.equal(record.encrypted,rec.encrypted);
   return reply({id:"file123456"});
  }
  if(u.pathname==="/drive/v3/files/file123456"){
   if(u.searchParams.has("alt"))return reply(JSON.stringify(record));
   return reply({id:"file123456",trashed:false,mimeType:"application/json",
    size:JSON.stringify(record).length,parents:["folder123456"],
    appProperties:metadata.appProperties});
  }
  throw Error("Unexpected Google URL "+url);
 };
 return {request,calls:()=>remoteCalls,metadata:()=>metadata,record:()=>record};
}
test("central Drive is disabled without owner-only OAuth secrets",async()=>{
 assert.equal(centralDriveConfigured({}),false);
 const result=await centralDriveOperation({...rec,operation:"write",env:{}},
  ()=>{throw Error("Network must not run");});
 assert.deepEqual(result,{status:"not_configured"});
});
test("authorized PTG account writes and retrieves encrypted backup through owner Drive",async()=>{
 const g=fakeGoogle();
 const saved=await centralDriveOperation({...rec,env,operation:"write"},g.request);
 assert.deepEqual(saved,{status:"ok",fileId:"file123456"});
 assert.ok(g.calls()>=4);
 assert.match(g.metadata().name,/Branchline-megaframe/);
 assert.equal(g.record().iv,rec.iv);
 assert.equal(g.record().encrypted,rec.encrypted);
 assert.ok(!JSON.stringify(saved).includes(env.refreshToken));
 const list=await centralDriveOperation({...rec,env,operation:"list"},g.request);
 assert.equal(list.status,"ok");
 assert.equal(list.items[0].recordKey,"project_example");
 assert.match(list.items[0].fileId,/file123456/);
 const fetched=await centralDriveOperation({...rec,env,operation:"read",
  fileId:"file123456"},g.request);
 assert.deepEqual(fetched,{status:"ok",record:{iv:rec.iv,encrypted:rec.encrypted}});
 assert.equal((await centralDriveOperation({...rec,env,operation:"read",
  ownerId:other,fileId:"file123456"},g.request)).status,"denied",
  "Another PTG actor must not read the same file");
});
test("wrong Google owner email and malformed encrypted writes fail closed",async()=>{
 const wrong=fakeGoogle({email:"someone-else@example.com"});
 assert.deepEqual(await centralDriveOperation({...rec,env,operation:"write"},wrong.request),
  {status:"unavailable"});
 assert.equal(wrong.metadata(),null,"Do not upload into unauthorized Google account");
 const blocked=await centralDriveOperation({...rec,env,operation:"write",
  recordKey:"../private",encrypted:"PLAINTEXT"},()=>{throw Error("No request allowed");});
 assert.deepEqual(blocked,{status:"denied"});
});
