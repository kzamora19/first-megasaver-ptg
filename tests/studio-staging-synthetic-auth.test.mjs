import test from "node:test";
import assert from "node:assert/strict";
import {STAGING_URL,FIXTURE_BRANCH,validateFixtureConfig} from "./studio-staging-synthetic-auth.mjs";

const valid = {
  STUDIO_HOSTED_STAGING_APPROVED:"1",
  STUDIO_HOSTED_TEST_MODE:"full",
  STUDIO_STAGING_SUPABASE_URL:STAGING_URL,
  STUDIO_STAGING_ISSUER_ORIGIN:"https://kzamora19.github.io",
  STUDIO_STAGING_PUBLISHABLE_KEY:"sb_publishable_"+"a".repeat(48),
  STUDIO_STAGING_ADMIN_SECRET_KEY:"sb_secret_"+"b".repeat(48)
};
test("only our dedicated staging ref can hold disposable GoTrue identities",()=>{
  assert.equal(FIXTURE_BRANCH,"STG001");
  assert.equal(validateFixtureConfig(valid).base.url,STAGING_URL);
  const forProd={...valid,STUDIO_STAGING_SUPABASE_URL:"https://agknxlowackphvwyvxge.supabase.co"};
  assert.throws(()=>validateFixtureConfig(forProd),/Refused|dedicated/);
  const forOther={...valid,STUDIO_STAGING_SUPABASE_URL:"https://abcdefghijklmnopqrst.supabase.co"};
  assert.throws(()=>validateFixtureConfig(forOther),/dedicated/);
});
test("staging fixture requires explicit full-mode approval and protected admin secret",()=>{
  assert.throws(()=>validateFixtureConfig({...valid,STUDIO_HOSTED_STAGING_APPROVED:"0"}),/approval/);
  assert.throws(()=>validateFixtureConfig({...valid,STUDIO_HOSTED_TEST_MODE:"preflight"}),/full-mode/);
  assert.throws(()=>validateFixtureConfig({...valid,STUDIO_STAGING_ADMIN_SECRET_KEY:""}),/admin key/);
  assert.throws(()=>validateFixtureConfig({...valid,STUDIO_STAGING_ADMIN_SECRET_KEY:"sb_publishable_"+"a".repeat(48)}),/admin key/);
});
