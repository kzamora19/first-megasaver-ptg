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
 assert.ok(read("app/layout.tsx").includes('"branchline-web-release": String(release.sequence)'));
 assert.ok(read("components/workspace-layout.tsx").includes("<WebRelease />"));
 assert.ok(read("components/web-release.tsx").includes('release.sequence'));
 assert.equal(restartPath("/first-megasaver-ptg/login/"),null);
});
