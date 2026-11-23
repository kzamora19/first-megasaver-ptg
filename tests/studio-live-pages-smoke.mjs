// Browser-equivalent public HTTP smoke test after controlled Pages deployment.
// No PTG login, account state, Drive file, or private data is touched.
import assert from "node:assert/strict";
const base="https://kzamora19.github.io";
const tasks=[
 {name:"PTG protected portal",path:"/first-megasaver-ptg/studios/",marker:"Creative Studios"},
 {name:"MegaFrame protected launcher",path:"/megaframe-studio/studio/",marker:"MEGAFRAME_STUDIO_PRIVATE_CONFIG"},
 {name:"MegaFlyer protected launcher",path:"/flyer-studio/studio/",marker:"STUDIO_ACCESS_CONFIG"},
 {name:"MegaFrame legacy editor preserved",path:"/megaframe-studio/",marker:"editor.js"},
 {name:"MegaFlyer legacy editor preserved",path:"/flyer-studio/",marker:"MegaFlyer Studio"},
 {name:"MegaFrame protected launcher script",path:"/megaframe-studio/studio/launch.js",marker:"ptg_studio_ticket"},
 {name:"MegaFlyer protected launcher script",path:"/flyer-studio/studio/launch.js",marker:"ptg_studio_ticket"},
];
for(const task of tasks){
 let ok=false,last="not requested";
 for(let attempt=0;attempt<6;attempt++){
  try{
   const response=await fetch(base+task.path,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(20000)});
   if(response.status!==200){last="HTTP "+response.status;continue;}
   const body=await response.text();
   if(!body.includes(task.marker)){last="expected page marker missing";continue;}
   if(task.name.includes("protected launcher")&&!task.path.endsWith(".js")){
    if(body.includes("<!-- PRIVATE EDITOR BUNDLE")||body.includes("<!-- PRIVATE MEGAFRAME EDITOR BUNDLE")){
      last="editor bytes found publicly";break;
    }
   }
   if(task.name.includes("legacy editor")&&/public (mega)?(?:frame|flyer) editor (?:is )?retired/i.test(body)){
    last="legacy editor unexpectedly retired";break;
   }
   ok=true;break;
  }catch(e){last=e instanceof Error?e.name:"connection error";}
  if(!ok&&attempt<5)await new Promise(resolve=>setTimeout(resolve,5000));
 }
 console.log(task.name+": "+(ok?"PASS":"FAIL "+last));
 assert.ok(ok,"Live route failed: "+task.name+" ("+last+")");
}
console.log("PASS: PTG portal + both protected Studio routes are publicly reachable; original editors preserved.");
