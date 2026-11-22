// NONDESTRUCTIVE real-hosted deployment readiness check.
// Does not use a live login or produce any user sessions, tickets, backups,
// cloud revisions, or editor downloads. Never logs credentials or response bodies.
import assert from "node:assert/strict";
const issuer="https://kzamora19.github.io";
const endpoints={
 ptg:"https://agknxlowackphvwyvxge.supabase.co/functions/v1/ptg-studio-access",
 megaframe:"https://vmyoxoiygfcecgkbavgg.supabase.co/functions/v1/megaframe-editor-delivery",
 flyer:"https://tzklsscoiwnmeantcefw.supabase.co/functions/v1/flyer-editor-delivery",
};
async function post(name,body,origin=issuer){
 const response=await fetch(endpoints[name],{
  method:"POST",cache:"no-store",redirect:"error",
  headers:{"Content-Type":"application/json",Origin:origin},
  body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
 });
 const status=response.status;
 // Never print diagnostic bodies: they may accidentally contain internal data.
 await response.arrayBuffer();
 console.log(name+" "+(origin===issuer?"configured-origin":"forged-origin")+" HTTP "+status);
 return status;
}
async function probe(){
 const issue={action:"issue",studio:"flyer"};
 const unsigned=await post("ptg",issue);
 assert.equal(unsigned,401,
  "PTG Studio gateway must be configured and reject missing PTG bearer (401). A 503 means issuer/gateway secrets are still missing.");
 const forged=await post("ptg",issue,"https://untrusted.example");
 assert.equal(forged,403,"PTG must deny a forged origin.");
 for(const studio of ["megaframe","flyer"]){
  const forgedTicket=await post(studio,{action:"load",ticket:"A".repeat(43),
   publicKey:{kty:"EC",crv:"P-256",x:"A".repeat(43),y:"A".repeat(43),ext:true}});
  assert.equal(forgedTicket,403,
   studio+" must be configured, contact PTG securely, and deny forged ticket (403). A 503 indicates an incomplete Studio secret or private bundle configuration.");
  const wrongOrigin=await post(studio,{action:"load",ticket:"A".repeat(43),
   publicKey:{kty:"EC",crv:"P-256",x:"A".repeat(43),y:"A".repeat(43),ext:true}},
   "https://untrusted.example");
  assert.equal(wrongOrigin,403,studio+" must reject a spoofed request origin.");
 }
 console.log("PASS: Hosted PTG + both Studio gateways deny untrusted requests and report configured readiness. Real user login and private release delivery remain separately gated.");
}
await probe();
