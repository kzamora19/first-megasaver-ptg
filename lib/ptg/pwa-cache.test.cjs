"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const read=name=>fs.readFileSync(path.resolve(__dirname,"..","..","public",name),"utf8");
test("PTG activation removes only its own old shell and claims after cleanup",async()=>{
 const callbacks={},removed=[];
 const own="first-megasaver-ptg-shell-v3-r6-isolation",old="first-megasaver-ptg-shell-v2";
 const self={registration:{scope:"https://kzamora19.github.io/first-megasaver-ptg/"},location:{origin:"https://kzamora19.github.io"},addEventListener:(n,cb)=>callbacks[n]=cb,clients:{claim:async()=>{assert.deepEqual(removed,[old]);}}};
 const caches={keys:async()=>[own,old,"branchline-shell-v197","megaframe-shell-fixture","flyer-shell-fixture","unrelated-cache"],delete:async key=>{removed.push(key);return true;}};
 vm.runInNewContext(read("sw.js"),{self,caches,URL,Promise});
 let done;callbacks.activate({waitUntil:p=>done=p});await done;
 assert.deepEqual(removed,[old]);
});
test("existing PTG and mobile Workspace installation identities unchanged",()=>{
 const p=JSON.parse(read("manifest.webmanifest")),m=JSON.parse(read("workspace-mobile.webmanifest"));
 assert.equal(p.id,"/first-megasaver-ptg/");
 assert.equal(p.scope,"/first-megasaver-ptg/");
 assert.equal(p.start_url,"/first-megasaver-ptg/login/");
 assert.equal(m.id,"./workspace/mobile/");
 assert.equal(m.start_url,"./workspace/mobile/");
 assert.equal(m.scope,"./workspace/mobile/");
});
