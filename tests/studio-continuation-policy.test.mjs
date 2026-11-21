import test from "node:test";
import assert from "node:assert/strict";
import {validPublicKey,validProofRequest,proofMessage,STUDIO_PROOF_LIFETIME_SECONDS} from "../supabase/functions/_shared/studio-continuation-policy.mjs";
test("only public P-256 proof keys are accepted",()=>{
 const k={kty:"EC",crv:"P-256",x:"A".repeat(43),y:"B".repeat(43)};
 assert.equal(validPublicKey(k),true);
 for(const invalid of [{...k,d:"secret"},{...k,crv:"P-384"},{...k,x:"bad"},null,{}])
  assert.equal(validPublicKey(invalid),false);
});
test("signed check must include a bounded session, challenge and signature",()=>{
 const p={sessionId:"d151a9b1-4c42-4dd2-a20b-4b9cfef1a650",challenge:"C".repeat(43),signature:"S".repeat(86)};
 assert.equal(validProofRequest(p),true);
 for(const invalid of [{...p,sessionId:"bad"},{...p,challenge:"bad"},{...p,signature:"bad"},null])
  assert.equal(validProofRequest(invalid),false);
 assert.equal(proofMessage("flyer",p.sessionId,p.challenge),"ptg-studio-v1|flyer|"+p.sessionId+"|"+p.challenge);
 assert.equal(STUDIO_PROOF_LIFETIME_SECONDS,7200);
});
test("P-256 signatures cannot authenticate a changed studio or challenge",async()=>{
 const kp=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
 const msg=proofMessage("flyer","1234","q".repeat(43));
 const signed=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},kp.privateKey,new TextEncoder().encode(msg));
 assert.equal(await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},kp.publicKey,signed,new TextEncoder().encode(msg)),true);
 assert.equal(await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},kp.publicKey,signed,new TextEncoder().encode(proofMessage("megaframe","1234","q".repeat(43)))),false);
});
