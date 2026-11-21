import test from "node:test";
import assert from "node:assert/strict";
import {stagingProjectOrigin,requireStageConfig,PRODUCTION_REFS}
 from "./studio-hosted-staging-policy.mjs";
const env={
 STUDIO_HOSTED_STAGING_APPROVED:"1",STUDIO_HOSTED_TEST_MODE:"preflight",
 STUDIO_STAGING_SUPABASE_URL:"https://gmrnzcrxysafqwertyui.supabase.co",
 STUDIO_STAGING_ISSUER_ORIGIN:"https://staging.example",
 STUDIO_STAGING_PUBLISHABLE_KEY:"K".repeat(48)
};
test("production project references cannot be treated as hosted staging",()=>{
 for(const ref of PRODUCTION_REFS){
  const url="https://"+ref+".supabase.co";
  assert.equal(stagingProjectOrigin(url),"");
  assert.throws(()=>requireStageConfig({...env,STUDIO_STAGING_SUPABASE_URL:url}),/production or invalid/);
 }
 assert.throws(()=>requireStageConfig({...env,STUDIO_HOSTED_STAGING_APPROVED:"0"}),/approval/);
});
test("hosted acceptance requires exact isolated project and issuer URLs",()=>{
 assert.equal(requireStageConfig(env).mode,"preflight");
 for(const bad of ["http://gmrnzcrxysafqwertyui.supabase.co",
  "https://gmrnzcrxysafqwertyui.supabase.co/other",
  "https://gmrnzcrxysafqwertyui.supabase.co?x=1",
  "https://u:p@gmrnzcrxysafqwertyui.supabase.co",
  "https://kzamora19.github.io"]){
  assert.throws(()=>requireStageConfig({...env,STUDIO_STAGING_SUPABASE_URL:bad}),/production or invalid/);
 }
});
test("full hosted tests require explicit synthetic account identity and app sessions",()=>{
 assert.throws(()=>requireStageConfig({...env,STUDIO_HOSTED_TEST_MODE:"full"}),/synthetic/);
 const full={...env,STUDIO_HOSTED_TEST_MODE:"full"};
 for(const [name,index] of [["ALLOWED","1"],["DENIED","2"]]){
  full["STUDIO_STAGING_"+name+"_EMAIL"]="studio-ci-"+name.toLowerCase()+"@example.invalid";
  full["STUDIO_STAGING_"+name+"_PASSWORD"]="Synthetic-Only-2026!abcdef";
  full["STUDIO_STAGING_"+name+"_APP_SESSION_ID"]="60000000-0000-4000-8000-00000000000"+index;
 }
 assert.equal(requireStageConfig(full).mode,"full");
 assert.throws(()=>requireStageConfig({...full,STUDIO_STAGING_ALLOWED_EMAIL:"customer@gmail.com"}),/synthetic/);
});
