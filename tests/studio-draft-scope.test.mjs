import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {studioDraftMaterial} from "../supabase/functions/_shared/studio-draft-scope.mjs";
const userA="11111111-1111-4111-8111-111111111111";
const userB="22222222-2222-4222-8222-222222222222";
const secret="independent-ptg-server-only-recovery-root-2026";
test("recovery keys are deterministic, account-scoped, studio-scoped and never plaintext identity",async()=>{
 const a=await studioDraftMaterial(secret,"megaframe",userA);
 const b=await studioDraftMaterial(secret,"megaframe",userA);
 const other=await studioDraftMaterial(secret,"megaframe",userB);
 const flyer=await studioDraftMaterial(secret,"flyer",userA);
 assert.deepEqual(a,b,"Same verified PTG account must be able to reopen its local draft");
 for(const field of ["draftScope","draftKey"])assert.match(a[field],/^[A-Za-z0-9_-]{43}$/);
 assert.notEqual(a.draftScope,a.draftKey);
 assert.notEqual(a.draftScope,other.draftScope);
 assert.notEqual(a.draftKey,other.draftKey);
 assert.notEqual(a.draftScope,flyer.draftScope);
 assert.notEqual(a.draftKey,flyer.draftKey);
 assert.ok(!Object.values(a).some(x=>x.includes(userA)));
});
test("no short recovery secret, invalid account or unrecognized studio can derive access",async()=>{
 for(const params of [
  ["abc","megaframe",userA],[secret,"megaframe","bad"],
  [secret,"wrong",userA],["","flyer",userA]
 ])await assert.rejects(()=>studioDraftMaterial(...params));
});
test("PTG sends draft secret only after single-use exchange, never on ticket verify or issue",()=>{
 const code=readFileSync(new URL("../supabase/functions/ptg-studio-access/index.ts",import.meta.url),"utf8");
 const exchange=code.slice(code.indexOf("async function exchange("),code.indexOf("async function prove("));
 const verify=code.slice(code.indexOf("async function verify("),code.indexOf("async function exchange("));
 const issue=code.slice(code.indexOf("async function issue("),code.indexOf("async function verify("));
 assert.match(exchange,/draftRoot\.length<32/);
 assert.ok(exchange.indexOf("draftRoot.length<32")<exchange.indexOf(".update({redeemed_at:"));
 assert.match(exchange,/studioDraftMaterial\(draftRoot,studio,grant\.user_id\)/);
 assert.match(exchange,/return json\(\{ok:true,sessionId:session\.id,challenge,expiresAt:.*\.\.\.recovery\}\)/);
 assert.doesNotMatch(verify,/studioDraftMaterial|draftKey|draftScope/);
 assert.doesNotMatch(issue,/studioDraftMaterial|draftKey|draftScope/);
});
