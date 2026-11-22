import test from "node:test";
import assert from "node:assert/strict";
import {STAGING_BUNDLES,requirePrivateUploadConfig,verifyBundle} from "./studio-staging-private-bundle-upload.mjs";
import {STAGING_URL} from "./studio-staging-synthetic-auth.mjs";

const config={
  STUDIO_HOSTED_STAGING_APPROVED:"1",
  STUDIO_STAGING_SUPABASE_URL:STAGING_URL,
  STUDIO_STAGING_ADMIN_SECRET_KEY:"sb_secret_"+"x".repeat(48),
  STUDIO_STAGING_MEGAFRAME_BUNDLE_FILE:"/isolated/private/frame.html",
  STUDIO_STAGING_FLYER_BUNDLE_FILE:"/isolated/private/flyer.html"
};
test("private editor releases are distinct and fully SHA-256 pinned",()=>{
  assert.equal(STAGING_BUNDLES.length,2);
  assert.equal(new Set(STAGING_BUNDLES.map(x=>x.bucket)).size,2);
  for(const b of STAGING_BUNDLES){
    assert.match(b.sha256,/^[a-f0-9]{64}$/);
    assert.equal(b.path,"releases/"+b.sha256.slice(0,16)+"/studio.html");
    assert.ok(b.bytes>1000000 && b.bytes<26000000);
  }
  assert.ok(requirePrivateUploadConfig(config).url===STAGING_URL);
});
test("uploads reject production/other projects and public API keys",()=>{
  assert.throws(()=>requirePrivateUploadConfig({...config,STUDIO_STAGING_SUPABASE_URL:"https://agknxlowackphvwyvxge.supabase.co"}),/Refused/);
  assert.throws(()=>requirePrivateUploadConfig({...config,STUDIO_STAGING_SUPABASE_URL:"https://abcdefghijklmnopqrst.supabase.co"}),/Refused/);
  assert.throws(()=>requirePrivateUploadConfig({...config,STUDIO_HOSTED_STAGING_APPROVED:"0"}),/Refused/);
  assert.throws(()=>requirePrivateUploadConfig({...config,STUDIO_STAGING_ADMIN_SECRET_KEY:"sb_publishable_"+"x".repeat(48)}),/admin secret/);
});
test("unmatched or truncated private editor source is always rejected before upload",()=>{
  for(const b of STAGING_BUNDLES){
    assert.throws(()=>verifyBundle(b,Buffer.from(b.header+"fake")),/pinned source hash/);
    assert.throws(()=>verifyBundle(b,Buffer.alloc(b.bytes)),/pinned source hash/);
  }
});
