import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const out=join("artifacts","official-navigation");
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const failures=[];
const root="http://127.0.0.1:4173/first-megasaver-ptg/studios/";
const account={
  username:"reviewer",displayName:"Synthetic QA reviewer",role:"SYSTEM_ADMIN",
  legacyRole:"SYSTEM ADMIN",branchCode:null,branchName:null,mustChangePassword:false
};
try {
  const context=await browser.newContext({locale:"en-US"});
  await context.route("**/functions/v1/ptg-auth",async route=>{
    const payload=route.request().postDataJSON();
    if(payload?.action==="session" || payload?.action==="session-status")
      return route.fulfill({status:200,contentType:"application/json",
        headers:{"access-control-allow-origin":"*"},
        body:JSON.stringify({ok:true,account})});
    return route.fulfill({status:403,contentType:"application/json",
      headers:{"access-control-allow-origin":"*"},
      body:JSON.stringify({ok:false,message:"Synthetic preview refuses writes"})});
  });
  // The synthetic screenshot test never accesses production Supabase, real
  // accounts, or third-party credentials.
  await context.route("**/*.supabase.co/**",async route=>{
    if (route.request().url().includes("/functions/v1/ptg-auth")) return route.fallback();
    return route.fulfill({status:403,contentType:"application/json",
      headers:{"access-control-allow-origin":"*"},
      body:JSON.stringify({ok:false,message:"Staging screenshot only"})});
  });
  const page=await context.newPage();
  page.setDefaultTimeout(35000);
  page.on("pageerror",error=>failures.push(error.message));
  await page.setViewportSize({width:1440,height:900});
  await page.goto(root,{waitUntil:"domcontentloaded"});
  await page.locator(".ptg-universal-app-rail").waitFor({state:"visible"}).catch(async error=>{
    console.log("SYNTHETIC_LOGIN_DIAG:",await page.locator("body").innerText().catch(()=>""),errors=failures);
    await page.screenshot({path:join(out,"ptg-screenshot-diagnostic.png"),fullPage:true});
    throw error;
  });
  assert.equal(await page.locator(".ptg-universal-app-rail .ptg-official-app-choice").count(),4);
  const desktopNames=await page.locator(".ptg-universal-drawer-link").allTextContents();
  assert.deepEqual(desktopNames,["Price Tag Generator","Sales Tracker","MegaFrame Studio","MegaFlyer Studio"]);
  const studioLinks=await page.locator(".ptg-universal-drawer-link").evaluateAll(nodes=>
    nodes.slice(2).map(x=>x.getAttribute("href")));
  assert.ok(studioLinks.every(href=>href?.startsWith("/first-megasaver-ptg/studios/?studio=")),
    "Studio choices must be PTG gated");
  assert.equal(await page.locator(".ptg-sidebar").isVisible(),true,
    "System Administrator retains the PTG workspace sidebar");
  await page.screenshot({path:join(out,"ptg-desktop.png"),fullPage:true});
  await page.locator(".ptg-official-brand-logo").click();
  assert.equal(await page.locator("#ptg-universal-app-drawer").isVisible(),true);
  await page.screenshot({path:join(out,"ptg-desktop-menu.png"),fullPage:true});
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#ptg-universal-app-drawer").isVisible(),false);

  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator(".ptg-universal-app-rail").isVisible(),false);
  assert.equal(await page.locator(".ptg-official-mobile-logo").isVisible(),true);
  await page.screenshot({path:join(out,"ptg-mobile.png"),fullPage:true});
  await page.locator(".ptg-official-mobile-logo").click();
  assert.equal(await page.locator("#ptg-universal-app-drawer").isVisible(),true);
  await page.screenshot({path:join(out,"ptg-mobile-apps.png"),fullPage:true});
  await page.locator(".ptg-menu-toggle").click();
  assert.equal(await page.locator("#ptg-universal-app-drawer").isVisible(),false);
  assert.equal(await page.locator(".ptg-sidebar").getAttribute("data-menu-open"),"true");
  await page.locator(".ptg-official-mobile-logo").click();
  assert.equal(await page.locator(".ptg-sidebar").getAttribute("data-menu-open"),"false");
  await page.locator(".ptg-official-mobile-logo").click();
  assert.equal(await page.locator("#ptg-universal-app-drawer").isVisible(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
  assert.deepEqual(failures,[]);
  console.log("PASS: PTG authorized synthetic preview four-app rail, independent drawers, Studio destinations and screenshots");
}finally{await browser.close();}
