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

export async function runFixtureAcceptance(env,createClient) {
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

  // Actual hosted review RPC through ordinary Studio ticket issuance and a fresh
  // signed challenge for every request. Only disposable staging identities.
  async function reviewAcceptance(accounts){
    const {webcrypto,randomUUID}=await import("node:crypto");
    async function post(route,body,extra={}){
      const response=await fetch(base.url+"/functions/v1/"+route,{
        method:"POST",redirect:"error",cache:"no-store",
        headers:{"Content-Type":"application/json",apikey:base.key,Origin:base.issuer,...extra},
        body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
      return {status:response.status,data:await response.json().catch(()=>({}))};
    }
    async function session(person){
      const bearer=await signIn(person);
      const issueResult=await post("ptg-studio-access",{action:"issue",studio:"flyer"},{Authorization:"Bearer "+bearer,"x-ptg-session-id":person.sessionId});
      assert.equal(issueResult.status,200,"Review fixture ticket issuance");
      const keys=await webcrypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
      const publicKey=await webcrypto.subtle.exportKey("jwk",keys.publicKey);
      const loaded=await post("flyer-editor-delivery",{action:"load",ticket:issueResult.data.ticket,publicKey});
      assert.equal(loaded.status,200,"Review fixture private editor delivery");
      const sessionId=loaded.data.sessionId;let challenge=loaded.data.challenge,lastRequest;
      return {
        async request(fields,expected=200){
          const signature=Buffer.from(await webcrypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},keys.privateKey,new TextEncoder().encode("ptg-studio-v1|flyer|"+sessionId+"|"+challenge))).toString("base64url");
          lastRequest={...fields,studioProof:{sessionId,challenge,signature}};
          const r=await post("flyer-studio-operations",lastRequest);
          assert.equal(r.status,expected,"Review RPC "+fields.action+" expected "+expected);
          assert.equal(r.data.studioProof?.sessionId,sessionId);
          assert.match(r.data.studioProof?.challenge||"",/^[A-Za-z0-9_-]{43}$/);
          assert.notEqual(r.data.studioProof.challenge,challenge);
          challenge=r.data.studioProof.challenge;
          return r.data.result;
        },
        async replay(){const r=await post("flyer-studio-operations",lastRequest);assert.equal(r.status,401,"Consumed proof must be rejected");}
      };
    }
    const unsigned=await post("flyer-studio-operations",{action:"permissions"});
    assert.equal(unsigned.status,400,"Unsigned protected operations must be denied");
    const tl=await session(accounts.allowed),ba=await session(accounts["branch-admin"]),sa=await session(accounts["system-admin"]);
    assert.deepEqual(await tl.request({action:"permissions"}),{canApprove:false,canOverride:false});
    assert.deepEqual(await ba.request({action:"permissions"}),{canApprove:true,canOverride:false});
    assert.deepEqual(await sa.request({action:"permissions"}),{canApprove:true,canOverride:true});
    await tl.replay();

    // Protected shared assets: upload a disposable transparent PNG, verify
    // actual list/read via fresh signed proof, then clean only that fixture.
    const assetId=randomUUID(),assetPath="staging-ci/"+assetId+".png";
    const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD/oAAAAASUVORK5CYII=","base64");
    let uploaded=false,inserted=false;
    try{
      const upload=await admin.storage.from("flyer-shared-assets").upload(assetPath,png,{contentType:"image/png",upsert:false});
      assert.equal(upload.error,null,"Upload isolated artwork fixture");uploaded=true;
      const insert=await admin.from("flyer_shared_assets").insert({id:assetId,name:"Synthetic staging footer artwork",category:"backgrounds",storage_path:assetPath,mime_type:"image/png",byte_size:png.length,created_by:accounts["system-admin"].userId,updated_by:accounts["system-admin"].userId});
      assert.equal(insert.error,null,"Insert isolated artwork metadata");inserted=true;
      const listed=await tl.request({action:"assets-list",category:"backgrounds"});
      assert.ok(listed.assets.some(a=>a.id===assetId),"Protected listing includes synthetic background");
      const fetched=await tl.request({action:"asset-image",assetId});
      assert.equal(fetched.mime,"image/png");
      assert.deepEqual(Buffer.from(fetched.base64,"base64"),png,"Protected download preserves artwork bytes");
      console.log("PASS: protected shared asset listing and private PNG retrieval");
    }finally{
      if(inserted){const removed=await admin.from("flyer_shared_assets").delete().eq("id",assetId);assert.equal(removed.error,null,"Remove only test metadata");}
      if(uploaded){const removed=await admin.storage.from("flyer-shared-assets").remove([assetPath]);assert.equal(removed.error,null,"Remove only test artwork");}
    }

    const projectId=randomUUID(),digest=randomBytes(32).toString("hex");
    const common={projectId,digest,scope:"front",warnings:[],blocking:[]};
    await tl.request({...common,action:"approve",format:"approval"},403);
    await ba.request({...common,action:"override",format:"png",reason:"Synthetic staging exception",acknowledged:true},403);
    const approval=await ba.request({...common,action:"approve",format:"approval"});
    assert.equal(approval.authorized,true);
    const final=await tl.request({...common,action:"final",format:"png",approvalId:approval.receiptId});
    assert.equal(final.authorized,true);
    await tl.request({...common,digest:randomBytes(32).toString("hex"),action:"final",format:"pdf",approvalId:approval.receiptId},403);
    const override=await sa.request({...common,action:"override",format:"pdf",reason:"Synthetic staging exception",acknowledged:true,blocking:["Synthetic warning"]});
    assert.equal(override.authorized,true);
    const {data:audit,error:auditError}=await admin.from("flyer_review_audit").select("id,actor_ptg,actor_role,action,scope,reason,approval_id").eq("project_id",projectId);
    assert.equal(auditError,null,"Staging audit readable only by service account");
    assert.equal(audit.length,3,"Only successful authorized operations create audit records");
    assert.ok(audit.some(r=>r.id===approval.receiptId&&r.actor_ptg===accounts["branch-admin"].userId&&r.actor_role==="BRANCH_ADMIN"&&r.action==="approve"));
    assert.ok(audit.some(r=>r.id===final.receiptId&&r.actor_ptg===accounts.allowed.userId&&r.approval_id===approval.receiptId&&r.action==="final"));
    assert.ok(audit.some(r=>r.id===override.receiptId&&r.actor_ptg===accounts["system-admin"].userId&&r.actor_role==="SYSTEM_ADMIN"&&r.action==="override"&&r.reason==="Synthetic staging exception"));
    console.log("PASS: live hosted MegaFlyer role permissions, P-256 replay denial, approval receipt, mismatched digest denial, override and immutable audit");
    // Audit is intentionally retained, marked by synthetic identities and reason.
  }

  let cleanupFailed=false;
  try {
    const accounts={};
    for(const row of roles)accounts[row.label]=await provision(row);
    await hostedAcceptance({
      ...env,
      STUDIO_HOSTED_STAGING_APPROVED:"1",STUDIO_HOSTED_TEST_MODE:"full",
      STUDIO_STAGING_ALLOWED_EMAIL:accounts.allowed.email,
      STUDIO_STAGING_ALLOWED_PASSWORD:accounts.allowed.password,
      STUDIO_STAGING_ALLOWED_APP_SESSION_ID:accounts.allowed.sessionId,
      STUDIO_STAGING_DENIED_EMAIL:accounts.denied.email,
      STUDIO_STAGING_DENIED_PASSWORD:accounts.denied.password,
      STUDIO_STAGING_DENIED_APP_SESSION_ID:accounts.denied.sessionId
    });
    await reviewAcceptance(accounts);
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
