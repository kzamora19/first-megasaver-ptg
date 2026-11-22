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
 const issues=[];
 const issue={action:"issue",studio:"flyer"};
 const unsigned=await post("ptg",issue);
 if(unsigned!==401)issues.push("PTG must reject missing bearer with 401. Received "+unsigned+"; check PTG Studio issuer and gateway secrets.");
 const forged=await post("ptg",issue,"https://untrusted.example");
 if(forged!==403)issues.push("PTG must deny forged origin with 403. Received "+forged);
 for(const studio of ["megaframe","flyer"]){
  const fake={action:"load",ticket:"A".repeat(43),
   publicKey:{kty:"EC",crv:"P-256",x:"A".repeat(43),y:"A".repeat(43),ext:true}};
  const forgedTicket=await post(studio,fake);
  if(forgedTicket!==403)issues.push(studio+" must reject forged ticket with 403; received "+forgedTicket+
   (forgedTicket===503?" (private bundle path/SHA or other Studio delivery secret likely missing).":""));
  const wrongOrigin=await post(studio,fake,"https://untrusted.example");
  if(wrongOrigin!==403)issues.push(studio+" must reject forged origin with 403; got "+wrongOrigin);
 }
 if(issues.length){
  console.error("CONFIGURATION BLOCKERS:\n- "+issues.join("\n- "));
  process.exitCode=1;
 }else console.log("PASS: all three live gateways are configured and reject untrusted requests. Full authenticated and editor recovery tests remain separate release gates.");
}

await probe();
