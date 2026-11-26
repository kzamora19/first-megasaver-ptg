import assert from "node:assert/strict";
import {readFile,stat} from "node:fs/promises";
import path from "node:path";
import {chromium} from "playwright";
const host="https://kzamora19.github.io",base="/first-megasaver-ptg/",dir=path.resolve("out"),fakeApi="https://example.supabase.co";
const browser=await chromium.launch({headless:true});
const calls=[];
const response=(project)=>({policy:{retentionDays:60,enabled:false,releaseAuthorized:false},buckets:[{id:project+"-protected-assets",objects:1,bytes:1048576,unknownSizes:0}],legacySources:project==="ptg"?[{dataset:"srp",source:"Fixture workbook.xlsx",records:13,lastImport:"2026-11-23",approvedDate:null}]:[],eligible:0,expiring:0,registryReady:true,total:0,reclaimedBytes:0,files:[]});
async function open(role,viewport){
 const ctx=await browser.newContext({viewport,serviceWorkers:"block"});
 await ctx.addInitScript(()=>sessionStorage.setItem("ptg_app_session_id","synthetic-browser-session"));
 const account={username:"fixture",displayName:"Fixture User",role,legacyRole:role==="SYSTEM_ADMIN"?"SYSTEM ADMIN":"BRANCH MANAGER",branchCode:role==="SYSTEM_ADMIN"?null:"TEST",branchName:role==="SYSTEM_ADMIN"?null:"Synthetic branch",mustChangePassword:false};
 await ctx.route("**/*",async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.origin===fakeApi){
   const cors={"access-control-allow-origin":host,"access-control-allow-methods":"GET, POST, PATCH, OPTIONS","access-control-allow-headers":"authorization,apikey,content-type,x-ptg-session-id,x-client-info"};
   if(req.method()==="OPTIONS")return route.fulfill({status:204,headers:cors});
   const reply=(obj,status=200)=>route.fulfill({status,headers:cors,contentType:"application/json",body:JSON.stringify(obj)});
   if(u.pathname.endsWith("/ptg-auth"))return reply({ok:true,account});
   if(u.pathname.endsWith("/ptg-widget-announcements"))return reply({ok:true,notices:[]});
   if(u.pathname.endsWith("/ptg-accounts")){
    const body=req.postDataJSON()??{};
    if(req.method()==="GET")return reply({ok:true,accounts:[],branches:[]});
    calls.push({role,...body});
    if(body.action?.startsWith("security")&&role!=="SYSTEM_ADMIN")return reply({ok:false,message:"Forbidden"},403);
    if(body.action==="securityStorageOverview"){
     if(body.project==="flyer")return reply({ok:false,message:"This project's signed storage connection is not configured or unavailable."},503);
     return reply({ok:true,storage:response(body.project??"ptg")});
    }
    if(body.action==="securityRetentionCleanup"){
     assert.equal(body.dryRun,true,"No deletion in this browser fixture");
     return reply({ok:true,cleanup:{candidates:0,deleted:0,skipped:0,review:0}});
    }
    if(body.action==="securityRetentionConfigure")return reply({ok:true});
    return reply({ok:true,controls:[],branches:[],catalog:[],grants:[],sessions:[],events:[]});
   }
   return reply({});
  }
  if(u.origin!==host)return route.abort();
  if(!u.pathname.startsWith(base))return route.fulfill({status:404,body:""});
  let name=path.resolve(dir,decodeURIComponent(u.pathname.slice(base.length)));
  if(!name.startsWith(dir+path.sep))return route.fulfill({status:404,body:""});
  try{
   if((await stat(name)).isDirectory())name=path.join(name,"index.html");
   const data=await readFile(name);
   const type=name.endsWith(".html")?"text/html":name.endsWith(".js")?"application/javascript":name.endsWith(".css")?"text/css":name.endsWith(".json")?"application/json":name.endsWith(".svg")?"image/svg+xml":name.endsWith(".png")?"image/png":"application/octet-stream";
   return route.fulfill({contentType:type,body:data});
  }catch{return route.fulfill({status:404,body:""});}
 });
 const page=await ctx.newPage();
 await page.goto(host+base+"admin/accounts/?section=storage");
 return {ctx,page};
}
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const {ctx,page}=await open("SYSTEM_ADMIN",viewport);
  await page.getByRole("heading",{name:"Storage Management",exact:true}).waitFor({timeout:30000});
  await page.getByText("ptg-protected-assets",{exact:true}).waitFor();
  const section=page.locator("section.admin-card").filter({has:page.getByRole("heading",{name:"Storage Management",exact:true})}).first();
  const picker=section.getByLabel("Project",{exact:true});
  assert.equal(await picker.inputValue(),"ptg");
  assert.equal(await section.getByLabel("Enable automatic cleanup").isDisabled(),true);
  assert.equal(await section.getByRole("button",{name:"Run eligible cleanup"}).isDisabled(),true);
  assert.equal(await section.getByRole("button",{name:"Confirm date",exact:true}).isDisabled(),true);
  await section.getByRole("button",{name:"Dry run",exact:true}).click();
  await page.getByRole("status").filter({hasText:"Nothing deleted"}).waitFor();
  await picker.selectOption("sales");await page.getByText("sales-protected-assets",{exact:true}).waitFor();
  assert.equal(await page.getByRole("heading",{name:"Review legacy catalog source dates"}).count(),0);
  await picker.selectOption("megaframe");await page.getByText("megaframe-protected-assets",{exact:true}).waitFor();
  await picker.selectOption("flyer");await page.getByRole("alert").filter({hasText:"signed storage connection"}).waitFor();
  assert.equal(await page.getByText("megaframe-protected-assets",{exact:true}).count(),0);
  assert.equal(await page.getByRole("button",{name:"Run eligible cleanup"}).count(),0);
  await picker.selectOption("ptg");await page.getByText("ptg-protected-assets",{exact:true}).waitFor();
  console.log("PASS exported Storage Management browser UI",viewport.width,"project switching, dry-run, locked cleanup and disconnected target isolation");
  await ctx.close();
 }
 const before=calls.length,{ctx,page}=await open("BRANCH_ADMIN",{width:1440,height:900});
 await page.getByRole("heading",{name:"Administration",exact:true}).waitFor({timeout:30000});
 assert.equal(await page.getByRole("heading",{name:"Storage Management",exact:true}).count(),0);
 assert.equal(await page.getByRole("link",{name:"Storage Management",exact:true}).count(),0);
 assert.equal(calls.slice(before).filter(c=>c.action==="securityStorageOverview").length,0);
 await ctx.close();
 console.log("PASS branch manager browser role has no storage administration surface");
}finally{await browser.close();}
