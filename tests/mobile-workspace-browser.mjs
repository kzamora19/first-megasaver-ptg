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
  console.log("PASS actual exported mobile workspace",viewport.width,"four app choices, single switcher, no shortcuts, frame draft retained");
  await ctx.close();
 }
}finally{await browser.close();}
