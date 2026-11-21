import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const mobile=read("app/workspace/mobile/workspace.tsx");
const css=read("app/workspace/mobile/workspace.css");
const portal=read("app/studios/page.tsx");
const nav=read("components/workspace-nav.tsx");
const layout=read("components/workspace-layout.tsx");
const products=read("app/products/product-search.tsx");
test("one Workspace has four distinct app modules using existing Supabase backends",()=>{
 for(const name of ["Sales Tracker","Price Tag Generator","MegaFrame Studio","MegaFlyer Studio"])
  assert.ok(mobile.includes('name: "'+name+'"'));
 assert.match(mobile,/withBasePath\("\/studios\/\?studio=megaframe"\)/);
 assert.match(mobile,/withBasePath\("\/studios\/\?studio=flyer"\)/);
 assert.match(mobile,/\/megaframe-studio\/icons\/icon-192.png/);
 assert.match(mobile,/\/flyer-studio\/icons\/flyer-studio-192.png/);
 assert.doesNotMatch(mobile,/ptg_studio_ticket|service_role|refresh_token/);
 assert.match(css,/overflow-x: auto/);
 assert.match(css,/#1d2836/);
 assert.match(css,/#355ee8/);
});
test("Studio selection is contextual, not a bypass or automatic ticket",()=>{
 assert.match(portal,/new URLSearchParams\(window.location.search\).get\("studio"\)/);
 assert.match(portal,/requested==="megaframe"\|\|requested==="flyer"/);
 assert.match(portal,/requestedStudio===studio/);
 assert.match(portal,/async function launch\(studio:Studio\)/);
 assert.match(portal,/invokePtgAuth\("session"\)/);
 assert.match(portal,/ptg-studio-access/);
 assert.doesNotMatch(portal,/window.location.assign\([^;]*new URLSearchParams/);
});
test("Creative Studios menu is limited to PTG Team Leader and higher roles",()=>{
 assert.match(nav,/legacyRole\.trim\(\)\.toUpperCase\(\)==="TEAM LEADER"/);
 assert.match(nav,/studiosAllowed&&<Link href="\/studios\/"/);
 assert.match(layout,/legacyRole=\{session\.legacyRole\}/);
 assert.match(layout,/"\/studios"/);
 assert.match(products,/canOpenCreativeStudios/);
 assert.match(products,/canOpenCreativeStudios && <a href=\{withBasePath\("\/studios\/"\)\}>/);
 assert.doesNotMatch(products,/\/megaframe-studio\/studio\/|\/flyer-studio\/studio\//);
});
