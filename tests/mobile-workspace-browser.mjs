import assert from "node:assert/strict";
import {readFile,stat} from "node:fs/promises";
import path from "node:path";
import {chromium} from "playwright";
const host="https://kzamora19.github.io", base="/first-megasaver-ptg/";
const dir=path.resolve("out");
const browser=await chromium.launch({headless:true});
try{
 for(const viewport of [{width:390,height:844},{width:844,height:390}]){
  const ctx=await browser.newContext({viewport,serviceWorkers:"block"});
  await ctx.route("**/*",async route=>{
   const u=new URL(route.request().url());
   if(u.origin!==host)return route.abort();
   if(u.pathname===base+"login/"||u.pathname===base+"studios/"||u.pathname==="/branchline/"){
    return route.fulfill({contentType:"text/html",body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><input aria-label="Draft"><button class="ptg-menu-toggle">Internal menu</button>'});
   }
   if(!u.pathname.startsWith(base))return route.fulfill({status:404,body:""});
   let name=path.resolve(dir,u.pathname.slice(base.length));
   if(!name.startsWith(dir+path.sep))return route.fulfill({status:404,body:""});
   try{if((await stat(name)).isDirectory())name=path.join(name,"index.html");const body=await readFile(name);
    const type=name.endsWith(".html")?"text/html":name.endsWith(".js")?"application/javascript":name.endsWith(".css")?"text/css":name.endsWith(".json")?"application/json":name.endsWith(".png")?"image/png":"application/octet-stream";
    return route.fulfill({contentType:type,body});
   }catch{return route.fulfill({status:404,body:""});}
  });
  const page=await ctx.newPage();
  await page.goto(host+base+"workspace/mobile/");
  const brand=page.locator(".mobile-workspace-brand");
  await brand.waitFor();
  assert.ok(await page.locator(".mobile-workspace-home .mobile-workspace-choice").count()===4);
  // Open PTG; no permanent shortcut grid; only one parent app switcher.
  await page.locator(".mobile-workspace-home").getByRole("button",{name:/Price Tag Generator/}).click();
  await page.frameLocator('iframe[title="Price Tag Generator"]').getByRole("textbox",{name:"Draft"}).fill("unsaved");
  assert.equal(await page.locator("header nav").count(),0);
  assert.equal(await page.locator(".mobile-workspace-brand").count(),1);
  assert.equal(await page.frameLocator('iframe[title="Price Tag Generator"]').locator("html.bl-mobile-embedded").count(),1);
  for(const name of ["Sales Tracker","MegaFrame Studio","MegaFlyer Studio","Price Tag Generator"]){
   await brand.click();
   await page.locator("#mobile-app-list").getByRole("button",{name:new RegExp(name)}).click();
   await page.locator('iframe[title="'+name+'"]').waitFor({state:"visible"});
   assert.equal(await page.locator("#mobile-app-list").count(),0);
   assert.equal(await page.locator("header nav").count(),0);
  }
  assert.equal(await page.frameLocator('iframe[title="Price Tag Generator"]').getByRole("textbox",{name:"Draft"}).inputValue(),"unsaved");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const header=await page.locator(".mobile-workspace-header").boundingBox();
  assert.ok(header.height<=64,"Compact primary header");
  assert.equal(await page.locator(".mobile-workspace").evaluate(e=>getComputedStyle(e).position),"fixed");
  assert.equal(await page.locator(".mobile-workspace-header").evaluate(e=>Math.round(e.getBoundingClientRect().top)),0);
  console.log("PASS actual exported mobile workspace",viewport.width,"four app choices, single switcher, no shortcuts, frame draft retained");
  await ctx.close();
 }
 // Exercise the actual PTG CSS against the sidebar/header DOM contract. These
 // fixtures are not a live authenticated device or a private Studio session.
 const globalCss=await readFile("app/globals.css","utf8");
 const officialCss=await readFile("app/official-navigation.css","utf8");
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:820}});
  await page.route("**/*",route=>route.abort());
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+globalCss+'\n'+officialCss+'</style><div class="ptg-unified-host ptg-web-r6"><nav class="ptg-universal-app-rail"><button class="ptg-official-brand-logo">Brand</button><span class="ptg-r6-wordmark">Branchline.</span><div class="ptg-r6-megasaver">1st Megasaver</div><a class="ptg-official-app-choice">PTG</a><a class="ptg-official-app-choice">Sales</a><a class="ptg-official-app-choice">Frame</a><a class="ptg-official-app-choice">Flyer</a><details class="ptg-r6-account"><summary>Account</summary></details></nav><div class="ptg-app"><aside class="ptg-sidebar" data-menu-open="true"><div class="ptg-sidebar-header"><a class="ptg-brand"><span class="ptg-brand-lockup"><img class="ptg-brand-wide-logo" alt=""><small>PRICE TAG GENERATOR</small></span></a><button class="ptg-menu-toggle">☰</button></div><div class="ptg-sidebar-content"><div class="ptg-sidebar-menu"><nav><a class="ptg-nav-item active"><span class="ptg-nav-icon">⌕</span><span class="ptg-nav-text">Product Search &amp; Queue</span></a></nav></div></div></aside><div class="ptg-workspace-content">Workspace</div></div></div>');
  const text=page.locator(".ptg-nav-text");const bounds=await text.boundingBox();
  assert.ok(bounds.width>100,"Menu text uses available width rather than icon dimensions");
  if(width===1440){
   const rail=page.locator(".ptg-universal-app-rail");
   assert.equal(await rail.evaluate(e=>getComputedStyle(e).flexDirection),"row");
   assert.ok((await rail.boundingBox()).width>=1400,"Desktop R6 header spans the window");
   assert.equal(await page.locator(".ptg-brand-wide-logo").isVisible(),false);
  }else assert.equal(await page.locator(".ptg-universal-app-rail").isVisible(),false);
  await page.close();
 }
 console.log("PASS PTG menu text dimensions and desktop browser R6 top bar");
}finally{await browser.close();}
