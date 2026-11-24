"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const {inspect,restartPath}=require("../public/updates/check.js");
const release=JSON.parse(read("public/updates/release.json"));
test("module release is production-only, scoped and monotonic",()=>{
 assert.equal(inspect(release,release.sequence),"current");
 assert.equal(inspect({...release,sequence:release.sequence+1},release.sequence),"available");
 for(const data of [null,{}, {...release,app:"sales"}, {...release,channel:"staging"}, {...release,sequence:release.sequence-1}, {...release,sequence:""+release.sequence}])assert.equal(inspect(data,release.sequence),"invalid");
 assert.equal(restartPath("/branchline/"),null);
 assert.equal(restartPath("/first-megasaver-ptg/products/"),"/first-megasaver-ptg/products/");
});
test("existing installation identity and secure mobile launch routes",()=>{
 const m=JSON.parse(read("public/workspace-mobile.webmanifest"));
 assert.equal(m.id,"./workspace/mobile/");
 assert.equal(m.start_url,"./workspace/mobile/");
 assert.equal(m.scope,"./workspace/mobile/");
 const mobile=read("app/workspace/mobile/workspace.tsx");
 assert.ok(mobile.includes("/studios/?studio=megaframe"));assert.ok(mobile.includes("/studios/?studio=flyer"));
 assert.ok(mobile.includes("<WebRelease />"));
 assert.ok(!mobile.includes('<nav aria-label="Workspace apps">'));
 assert.ok(mobile.includes("markEmbedded"));
 assert.ok(mobile.includes("aria-expanded={listOpen}"));
 assert.ok(mobile.includes('/icons/official/branchline.png'));
 const css=read("app/official-navigation.css");
 assert.ok(css.includes(".ptg-unified-host .ptg-brand-lockup img{display:none!important}"));
 assert.ok(css.includes("html.bl-mobile-embedded .ptg-official-mobile-logo"));
 assert.ok(read("app/layout.tsx").includes('"branchline-web-release": String(release.sequence)'));
 assert.ok(read("components/workspace-layout.tsx").includes("<WebRelease />"));
 assert.ok(read("components/web-release.tsx").includes('release.sequence'));
 assert.equal(restartPath("/first-megasaver-ptg/login/"),null);
});

test("desktop and mobile device layout corrections preserve verified direct Studio launch",()=>{
 const css=read("app/official-navigation.css"),portal=read("app/studios/page.tsx");
 assert.ok(css.includes(".ptg-nav-item .ptg-nav-text{width:auto;flex:1 1 auto"));
 assert.ok(css.includes(".ptg-web-r6 .ptg-universal-app-rail"));
 assert.ok(portal.includes("attempted.current=requestedStudio"));
 assert.ok(portal.includes('const check=await invokePtgAuth("session")'));
 assert.ok(portal.includes('if(!check.account||!allowedRole(check.account))'));
 assert.ok(portal.includes('JSON.stringify({action:"issue",studio})'));
});

 test("R6 status polls refresh verified identity without extending idle sessions",()=>{
 const gate=read("components/client-session-gate.tsx"),auth=read("supabase/functions/ptg-auth/index.ts"),layout=read("components/workspace-layout.tsx");
 assert.ok(auth.includes('activeSession(request, action !== "session-status")'));
 assert.ok(auth.includes('if (action === "session-status" || action === "session")'));
 assert.ok(auth.includes('role: session.role'));
 assert.ok(gate.includes('const result = await invokePtgAuth("session-status")'));
 assert.ok(gate.includes('if (stopped || !result.account) return'));
 assert.ok(gate.includes('setSession(current => current && JSON.stringify(current) === JSON.stringify(account) ? current : account)'));
 assert.ok(gate.includes('if (account.mustChangePassword)'));
 assert.ok(gate.includes('!allowedRoles.split("|").includes(account.role)'));
 assert.equal((layout.match(/session\.displayName\.trim\(\) \|\| session\.username/g)||[]).length,3);
 assert.equal((layout.match(/session\.legacyRole\.trim\(\) \|\| session\.role/g)||[]).length,2);
 });
