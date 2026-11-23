// Dedicated Branchline staging only. No existing staff, customer, or production identities.
// Admin token stays inside a protected Actions job, never in Pages or logs.
// After the functional HTTP test, delete all synthetic users (cascade sessions/tickets).
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {pathToFileURL} from "node:url";
import {hostedAcceptance} from "./studio-hosted-staging-acceptance.mjs";
import {requireStageConfig} from "./studio-hosted-staging-policy.mjs";

export const STAGING_URL="https://rlfdvmiqkbitetatxkju.supabase.co";
export const FIXTURE_BRANCH="STG001";
const randomPassword=()=>randomBytes(32).toString("base64url");

export function validateFixtureConfig(env) {
  const base=requireStageConfig({...env,STUDIO_HOSTED_TEST_MODE:"preflight"});
  if(base.url!==STAGING_URL)throw Error("Only the dedicated isolated staging project is permitted");
  if(env.STUDIO_HOSTED_STAGING_APPROVED!=="1")throw Error("Explicit staging approval required");
  if(env.STUDIO_HOSTED_TEST_MODE!=="full")throw Error("Synthetic account provisioning is full-mode only");
  const secret=env.STUDIO_STAGING_ADMIN_SECRET_KEY;
  if(typeof secret!=="string"||secret.length<32||
     secret.startsWith("sb_publishable_"))throw Error("Protected staging admin key missing");
  return {base,secret};
}

export async function runFixtureAcceptance(env,createClient,checkBrowser) {
  const {base,secret}=validateFixtureConfig(env);
  const admin=createClient(base.url,secret,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  });
  const {data:branch,error:branchError}=await admin.from("branches")
    .select("id").eq("branch_code",FIXTURE_BRANCH)
    .eq("status","ACTIVE").eq("operational_status","ON").single();
  if(branchError||!branch?.id)throw Error("Synthetic test branch STG001 must already be ACTIVE");
  const nonce=randomBytes(8).toString("hex");
  const created=[];
  const roles=[
    {label:"allowed",role:"BRANCH_USER",title:"TEAM LEADER",branchId:branch.id},
    {label:"denied",role:"BRANCH_USER",title:"BRANCH USER",branchId:branch.id},
    {label:"branch-admin",role:"BRANCH_ADMIN",title:"BRANCH MANAGER",branchId:branch.id},
    {label:"system-admin",role:"SYSTEM_ADMIN",title:"",branchId:null}
  ];
  async function provision(row){
    const email=`studio-ci-${row.label}-${nonce}@example.invalid`;
    const password=randomPassword();
    const {data,error}=await admin.auth.admin.createUser({
      email,password,email_confirm:true
    });
    if(error||!data?.user?.id)throw Error("Cannot create isolated synthetic auth identity: "+(error?.code??"unknown"));
    created.push(data.user.id); // recorded immediately so failures still clean up
    const {error:profileError}=await admin.rpc("provision_ptg_user_profile",{
      p_user_id:data.user.id,
      p_username:`studio-ci-${row.label}-${nonce}`,
      p_display_name:`Synthetic ${row.label} (staging only)`,
      p_role_key:row.role,
      p_legacy_role:row.title,
      p_branch_id:row.branchId,
      p_auth_email:email
    });
    if(profileError)throw Error("Cannot create synthetic PTG profile: "+profileError.code);
    // The production provisioning RPC deliberately starts at PENDING/inactive.
    // A synthetic CI user must explicitly complete activation, without altering
    // any production onboarding or bypassing Studio authorization checks.
    const {data:activated,error:activationError}=await admin.from("user_profiles")
      .update({
        is_active:true,
        must_change_password:false,
        invitation_status:"ACTIVATED",
        activated_at:new Date().toISOString()
      }).eq("id",data.user.id)
      .select("is_active,must_change_password,invitation_status").single();
    if(activationError||activated?.is_active!==true||
       activated?.must_change_password!==false||
       activated?.invitation_status!=="ACTIVATED")
      throw Error("Cannot complete isolated synthetic profile activation: "+(activationError?.code??"state mismatch"));
    const now=Date.now();
    const {data:appSession,error:sessionError}=await admin.from("app_sessions")
      .insert({
        user_id:data.user.id,branch_id:row.branchId,
        session_version:1,remember_device:false,
        last_activity_at:new Date(now).toISOString(),
        expires_at:new Date(now+45*60000).toISOString(),
        device_label:"STAGING CI synthetic acceptance"
      }).select("id").single();
    if(sessionError||!appSession?.id)throw Error("Cannot create synthetic PTG session: "+(sessionError?.code??"unknown"));
    return {email,password,sessionId:appSession.id,userId:data.user.id};
  }
  async function signIn(person){
    const r=await fetch(base.url+"/auth/v1/token?grant_type=password",{
      method:"POST",headers:{"Content-Type":"application/json",apikey:base.key},
      body:JSON.stringify({email:person.email,password:person.password}),
      signal:AbortSignal.timeout(12000)
    });
    const data=await r.json().catch(()=>({}));
    assert.equal(r.status,200,"Synthetic staging login must succeed");
    assert.ok(typeof data.access_token==="string"&&data.access_token.length>60);
    return data.access_token;
  }
  async function issue(person,studio="megaframe"){
    const jwt=await signIn(person);
    const r=await fetch(base.url+"/functions/v1/ptg-studio-access",{
      method:"POST",headers:{
        "Content-Type":"application/json",apikey:base.key,
        Origin:base.issuer,Authorization:"Bearer "+jwt,
        "x-ptg-session-id":person.sessionId
      },
      body:JSON.stringify({action:"issue",studio}),signal:AbortSignal.timeout(12000)
    });
    return r.status;
  }
  let cleanupFailed=false;
  try {
    const accounts={};
    for(const row of roles)accounts[row.label]=await provision(row);
    if(checkBrowser) await checkBrowser(accounts.allowed);
    else await hostedAcceptance({
      ...env,
      STUDIO_HOSTED_STAGING_APPROVED:"1",STUDIO_HOSTED_TEST_MODE:"full",
      STUDIO_STAGING_ALLOWED_EMAIL:accounts.allowed.email,
      STUDIO_STAGING_ALLOWED_PASSWORD:accounts.allowed.password,
      STUDIO_STAGING_ALLOWED_APP_SESSION_ID:accounts.allowed.sessionId,
      STUDIO_STAGING_DENIED_EMAIL:accounts.denied.email,
      STUDIO_STAGING_DENIED_PASSWORD:accounts.denied.password,
      STUDIO_STAGING_DENIED_APP_SESSION_ID:accounts.denied.sessionId
    });
    assert.equal(await issue(accounts["branch-admin"]),200,
      "Synthetic Branch Admin must be allowed");
    assert.equal(await issue(accounts["system-admin"]),200,
      "Synthetic System Admin must be allowed");
    assert.equal(await issue(accounts.denied),403,
      "Synthetic ordinary Branch User must be denied");
    // Force logout is checked against the real source PTG session, not JWT age.
    const {error:revokeError}=await admin.from("app_sessions")
      .update({revoked_at:new Date().toISOString(),revoke_reason:"STAGING_TEST"})
      .eq("id",accounts.allowed.sessionId);
    if(revokeError)throw Error("Synthetic force-logout test cannot revoke session");
    assert.equal(await issue(accounts.allowed),403,
      "Previously permitted Team Leader must be rejected after forced logout");
    const {error:disableError}=await admin.from("user_profiles")
      .update({is_active:false}).eq("id",accounts["branch-admin"].userId);
    if(disableError)throw Error("Cannot simulate synthetic account disablement");
    assert.equal(await issue(accounts["branch-admin"]),403,
      "Disabled Branch Admin must be rejected despite valid JWT");
    console.log("PASS: isolated four-role login, Studio launch, forced logout and account disablement");
  } finally {
    // NEVER delete any account that this specific run did not create.
    for(const id of created.reverse()){
      const {error}=await admin.auth.admin.deleteUser(id);
      if(error){cleanupFailed=true;console.error("Synthetic staging account cleanup failed:",error.code);}
    }
    if(created.length)console.log("Synthetic staging account cleanup completed or reported above");
  }
  if(cleanupFailed)throw Error("Synthetic test account cleanup incomplete: inspect staging Auth users");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {createClient}=await import("@supabase/supabase-js");
  await runFixtureAcceptance(process.env,createClient);
}
