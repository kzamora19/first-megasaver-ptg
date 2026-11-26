// Manual, opt-in hosted staging acceptance. Never use a production project or customer.
// Three Edge Functions and private bundle objects must be present in a single
// isolated Supabase staging project with synthetic, pre-provisioned PTG users.
import assert from "node:assert/strict";
import {createHash,webcrypto,randomBytes} from "node:crypto";
import {pathToFileURL} from "node:url";
import {requireStageConfig} from "./studio-hosted-staging-policy.mjs";
const studios=[
 {name:"megaframe",route:"megaframe-editor-delivery",prefix:"<!-- PRIVATE MEGAFRAME EDITOR BUNDLE"},
 {name:"flyer",route:"flyer-editor-delivery",prefix:"<!-- PRIVATE EDITOR BUNDLE"}
];
export async function hostedAcceptance(env,send=fetch){
 const config=requireStageConfig(env); // Explicit prod rejection BEFORE all requests.
 const base=config.url,headers={
  "Content-Type":"application/json",apikey:config.key,Origin:config.issuer
 };
 async function post(route,body,extra={}){
  const result=await send(base+"/functions/v1/"+route,{
   method:"POST",cache:"no-store",redirect:"error",
   headers:{...headers,...extra},body:JSON.stringify(body),
   signal:AbortSignal.timeout(12000)
  });
  return {status:result.status,data:await result.json().catch(()=>({}))};
 }
 const issue=(studio,extra={})=>post("ptg-studio-access",{action:"issue",studio},extra);
 const noBearer=await issue("flyer");
 assert.equal(noBearer.status,401,"Live STAGING PTG must deny unsigned issuance");
 const forgedOrigin=await issue("flyer",{Origin:"https://untrusted.example"});
 assert.equal(forgedOrigin.status,403,"STAGING PTG must enforce exact allowed origin");
 for(const studio of studios){
  const fake=await post(studio.route,{
   action:"load",ticket:"A".repeat(43),
   publicKey:{kty:"EC",crv:"P-256",x:"A".repeat(43),y:"A".repeat(43),ext:true}
  });
  assert.equal(fake.status,403,"Configured Studio must reject forged tickets: "+studio.name);
  const raw=await send(base+"/functions/v1/"+studio.route,{
   method:"GET",redirect:"error",headers:{apikey:config.key},signal:AbortSignal.timeout(12000)
  });
  assert.notEqual(raw.status,200,"Editor must never be served by a direct public GET");
 }
 if(config.mode==="preflight"){
  console.log("PASS: hosted staging PTG and both Studio functions reject unsigned, cross-origin and forged launch requests.");
  return;
 }
 // Synthetic accounts must exist on the staging instance and have genuine PTG
 // app_sessions/user_profiles created there — never cloned from production.
 async function authenticate(person){
  const r=await send(base+"/auth/v1/token?grant_type=password",{
   method:"POST",redirect:"error",headers:{"Content-Type":"application/json",apikey:config.key},
   body:JSON.stringify({email:person.email,password:person.password}),
   signal:AbortSignal.timeout(12000)
  });
  const data=await r.json().catch(()=>({}));
  assert.equal(r.status,200,"Synthetic STAGING GoTrue sign-in expected");
  assert.match(data.access_token||"",/^[A-Za-z0-9_.-]{60,}$/);
  return data.access_token;
 }
 const allowedBearer=await authenticate(config.allowed),deniedBearer=await authenticate(config.denied);
 const denied=await issue("flyer",{Authorization:"Bearer "+deniedBearer,
   "x-ptg-session-id":config.denied.sessionId});
 assert.equal(denied.status,403,"Ordinary staging PTG account must not issue a Studio ticket");
 for(const studio of studios){
  const grant=await issue(studio.name,{Authorization:"Bearer "+allowedBearer,
    "x-ptg-session-id":config.allowed.sessionId});
  assert.equal(grant.status,200,"Allowed TL+ staging PTG grant for "+studio.name);
  assert.match(grant.data.ticket||"",/^[A-Za-z0-9_-]{43}$/);
  const keys=await webcrypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
  const publicKey=await webcrypto.subtle.exportKey("jwk",keys.publicKey);
  const request={action:"load",ticket:grant.data.ticket,publicKey};
  const real=await post(studio.route,request);
  assert.equal(real.status,200,"Private bundle must be actually delivered only after PTG issuance");
  assert.equal(real.data.ok,true);
  assert.ok(typeof real.data.html==="string"&&real.data.html.startsWith(studio.prefix));
  assert.match(real.data.sha256||"",/^[a-f0-9]{64}$/);
  assert.equal(createHash("sha256").update(real.data.html).digest("hex"),real.data.sha256);
  assert.match(real.data.draftScope||"",/^[A-Za-z0-9_-]{43}$/);
  assert.match(real.data.draftKey||"",/^[A-Za-z0-9_-]{43}$/);
  const reused=await post(studio.route,request);
  assert.equal(reused.status,403,"One-time Studio grant cannot be replayed");
  const {sessionId,challenge}=real.data;
  const statement="ptg-studio-v1|"+studio.name+"|"+sessionId+"|"+challenge;
  const signature=Buffer.from(await webcrypto.subtle.sign(
    {name:"ECDSA",hash:"SHA-256"},keys.privateKey,new TextEncoder().encode(statement)
  )).toString("base64url");
  const signed={action:"check",sessionId,challenge,signature};
  const renewed=await post(studio.route,signed);
  assert.equal(renewed.status,200,"Real ECDSA continuation must succeed");
  assert.match(renewed.data.challenge||"",/^[A-Za-z0-9_-]{43}$/);
  const replay=await post(studio.route,signed);
  assert.equal(replay.status,403,"Signed challenge must be single-use");

  // Verify actual hosted encrypted cloud Save/Retrieve with SYNTHETIC data only.
  // AES-GCM keys and plaintext stay in the test client; the server stores opaque
  // IV/ciphertext and each operation uses the next one-use P-256 challenge.
  const recordKey=studio.name==="megaframe"?"project_staging-ci-synthetic":"p:current";
  const plaintext=Buffer.from(JSON.stringify({
    source:"isolated-staging-only",studio:studio.name,kind:"synthetic-project",
    revision:1,nonce:randomBytes(12).toString("base64url"),
    ...(studio.name==="flyer"?{reviewScope:"front",campaign:{sectionLayout:{front:{backgroundMode:"watermark",backgroundOpacity:25,backgroundRotation:15,cardOpacity:0}},footerDesign:{front:{mode:"imageText",left:"Synthetic terms",right:"Synthetic contact",height:42},back:{mode:"none"}},headerDesign:{front:{extraHeight:12}}},offers:[{sku:"STAGING-ONLY",section:"front",freebieAppearance:{size:65,scale:120,x:80,y:20,fit:"fill",aspect:true,font:12}}]}:{})
  }),"utf8");
  const aesKey=await webcrypto.subtle.generateKey({name:"AES-GCM",length:256},
    false,["encrypt","decrypt"]);
  const iv=randomBytes(12);
  const encrypted=Buffer.from(await webcrypto.subtle.encrypt(
    {name:"AES-GCM",iv},aesKey,plaintext));
  let currentChallenge=renewed.data.challenge;
  assert.match(currentChallenge||"",/^[A-Za-z0-9_-]{43}$/);
  async function cloudOperation(operation,payload={}){
    const cloudStatement="ptg-studio-v1|"+studio.name+"|"+sessionId+"|"+currentChallenge;
    const cloudSignature=Buffer.from(await webcrypto.subtle.sign(
      {name:"ECDSA",hash:"SHA-256"},keys.privateKey,
      new TextEncoder().encode(cloudStatement))).toString("base64url");
    const response=await post(studio.route,{
      action:"cloud",operation,sessionId,challenge:currentChallenge,
      signature:cloudSignature,...payload
    });
    assert.equal(response.status,200,"Protected cloud "+operation+" must be authorized for "+studio.name);
    assert.equal(response.data.ok,true);
    assert.match(response.data.challenge||"",/^[A-Za-z0-9_-]{43}$/);
    currentChallenge=response.data.challenge;
    return response.data.cloud;
  }
  const written=await cloudOperation("write",{
    recordKey,iv:iv.toString("base64url"),
    encrypted:encrypted.toString("base64url"),expectedVersion:0
  });
  assert.equal(written.status,"ok","Synthetic encrypted cloud Save must succeed");
  assert.ok(Number.isSafeInteger(written.version)&&written.version>=1);
  const restored=await cloudOperation("read",{recordKey});
  assert.equal(restored.status,"ok","Synthetic encrypted cloud Retrieve must succeed");
  assert.equal(restored.record?.iv,iv.toString("base64url"));
  const recoveredBytes=Buffer.from(restored.record?.encrypted??"","base64url");
  const recoveredPlaintext=Buffer.from(await webcrypto.subtle.decrypt(
    {name:"AES-GCM",iv},aesKey,recoveredBytes));
  assert.equal(recoveredPlaintext.toString("utf8"),plaintext.toString("utf8"),
    "Decrypted synthetic project must match the original exactly");
  const inventory=await cloudOperation("list");
  assert.equal(inventory.status,"ok");
  assert.ok(Array.isArray(inventory.items)&&inventory.items.some(
    item=>item.record_key===recordKey),"Only PTG-owned synthetic project may appear in cloud list");
  console.log("PASS: "+studio.name+" AES-GCM encrypted cloud Save/Retrieve/List with signed challenge");
  console.log("PASS: "+studio.name+" actual staged private bundle, integrity, account key, ECDSA continuation and replay denial");
 }
 console.log("PASS: hosted PTG + MegaFrame + MegaFlyer protocol with isolated synthetic accounts.");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 await hostedAcceptance(process.env);
