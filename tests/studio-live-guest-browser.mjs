import assert from "node:assert/strict";
import {chromium} from "playwright";
const domain="https://kzamora19.github.io";
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({
    viewport:{width:1280,height:800},serviceWorkers:"block",
    ignoreHTTPSErrors:false,acceptDownloads:false
  });
  for(const [studio,path] of [
    ["MegaFrame","/megaframe-studio/studio/"],
    ["MegaFlyer","/flyer-studio/studio/"]
  ]){
    const page=await context.newPage();
    const result=await page.goto(domain+path,{waitUntil:"domcontentloaded",timeout:30000});
    assert.equal(result?.status(),200,studio+" protected page must load");
    await page.getByText("A valid PTG authorization is required.",{exact:false}).waitFor({timeout:10000});
    assert.equal(await page.locator("#studio-editor-frame").count(),0,
      studio+" cannot render private editor to an unsigned user");
    console.log("PASS: unsigned "+studio+" private Studio rejected directly");
    await page.close();
  }
  {
    const page=await context.newPage();
    const result=await page.goto(domain+"/first-megasaver-ptg/studios/",{
      waitUntil:"domcontentloaded",timeout:30000
    });
    assert.equal(result?.status(),200);
    await page.getByText("Your current PTG account is not authorized for Creative Studios.",{
      exact:false
    }).waitFor({timeout:30000});
    assert.equal(await page.locator('button:has-text("Open MegaFrame Studio")').count(),0);
    assert.equal(await page.locator('button:has-text("Open MegaFlyer Studio")').count(),0);
    console.log("PASS: signed-out PTG portal denies launch and offers login route");
    await page.close();
  }
  await context.close();
}finally{
  await browser.close();
}
