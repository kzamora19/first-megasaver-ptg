import test from "node:test";
import assert from "node:assert/strict";
import {cloudKeyAllowed,cloudActionValid,validateCloudMutation,STUDIO_CLOUD_CIPHERTEXT_LIMIT}
 from "../supabase/functions/_shared/studio-cloud-policy.mjs";
const good={recordKey:"project_20261121_abc",iv:"a".repeat(16),
 encrypted:"x".repeat(32),expectedVersion:0};
test("cloud record keys must remain in the authorized Studio",()=>{
 assert.ok(cloudKeyAllowed("megaframe",good.recordKey));
 assert.ok(cloudKeyAllowed("flyer","p:current"));
 for(const key of ["p:current","../other","project__","project_a/b","recovery_123",""]){
  assert.equal(cloudKeyAllowed("megaframe",key),false,key);
 }
 for(const key of ["project_20261121_abc","p:other","p:../user"]){
  assert.equal(cloudKeyAllowed("flyer",key),false,key);
 }
 assert.equal(cloudKeyAllowed("other","p:current"),false);
});
test("PTG cloud accepts only exact encrypted AES-GCM envelope and CAS version",()=>{
 assert.deepEqual(validateCloudMutation("megaframe",good),good);
 for(const mutation of [
  {iv:"a".repeat(15)}, {iv:"../invalid"}, {encrypted:"x".repeat(23)},
  {encrypted:"x".repeat(STUDIO_CLOUD_CIPHERTEXT_LIMIT+1)},
  {encrypted:"photo.jpeg"}, {expectedVersion:-1},{expectedVersion:1.5},
  {expectedVersion:2_000_000_001}, {recordKey:"../other"},
  {recordKey:"p:current"}
 ]){
  assert.equal(validateCloudMutation("megaframe",{...good,...mutation}),null,JSON.stringify(mutation).slice(0,100));
 }
 assert.equal(validateCloudMutation("flyer",{...good,recordKey:"p:current"}).recordKey,"p:current");
});
test("operations are an explicit, read-only-by-default allowlist",()=>{
 for(const action of ["list","read","write"]) assert.ok(cloudActionValid({operation:action}));
 for(const action of ["delete","drop","upsert","migrate",null])assert.equal(cloudActionValid({operation:action}),false);
});
