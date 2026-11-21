// STAGED: shared PTG entitlement authority for MegaFrame Studio and Flyer Studio.
// Must not be deployed or have its schema applied until explicit release approval.
import {createClient} from "npm:@supabase/supabase-js@2";
import {
  allowedPtgStudioRole, sessionIsLive, validStudioId,
  STUDIO_GRANT_LIFETIME_SECONDS,
} from "../_shared/studio-access-policy.mjs";
import {validPublicKey,validProofRequest,proofMessage,STUDIO_PROOF_LIFETIME_SECONDS,STUDIO_CHALLENGE_LIFETIME_SECONDS} from "../_shared/studio-continuation-policy.mjs";
import {studioIssuerOrigin} from "../_shared/studio-issuer-origin.mjs";
import {studioDraftMaterial} from "../_shared/studio-draft-scope.mjs";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const secret = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const pub = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const gatewaySecret = Deno.env.get("PTG_STUDIO_GATEWAY_SECRET") ?? "";
// Exact HTTPS origin set at deployment time. No implicit Vercel host or wildcard.
const issuerOrigin = studioIssuerOrigin(Deno.env.get("PTG_STUDIO_ISSUER_ORIGIN"));
const admin = createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const noStore = {"Cache-Control":"no-store, private","Pragma":"no-cache"};
function json(body:unknown,status=200,origin?:string,extraHeaders:Record<string,string>={}) {
  const headers:Record<string,string>={"Content-Type":"application/json; charset=utf-8",...noStore,...extraHeaders};
  if(origin===issuerOrigin){
    headers["Access-Control-Allow-Origin"]=issuerOrigin;
    headers["Vary"]="Origin";
    headers["Access-Control-Allow-Headers"]="authorization, apikey, x-client-info, content-type, x-ptg-session-id";
    headers["Access-Control-Allow-Methods"]="POST, OPTIONS";
  }
  return new Response(JSON.stringify(body),{status,headers});
}
const bytesToHex=(data:Uint8Array)=>Array.from(data,b=>b.toString(16).padStart(2,"0")).join("");
function randomToken(){const b=new Uint8Array(32);crypto.getRandomValues(b);return btoa(String.fromCharCode(...b)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");}
function decodeSignature(input:string){
 const b64=input.replaceAll("-","+").replaceAll("_","/");
 const raw=atob(b64+"=".repeat((4-b64.length%4)%4));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function digest(value:string){
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))));
}
function equalSecret(input:string, expected:string){
  if(input.length!==expected.length || expected.length<32) return false;
  let difference=0;
  for(let i=0;i<expected.length;i++) difference |= expected.charCodeAt(i)^input.charCodeAt(i);
  return difference===0;
}
async function validSourceSession(userId:string,sessionId:string){
  if(!/^[0-9a-f-]{36}$/i.test(userId) || !/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const [sessionResult,profileResult]=await Promise.all([
    admin.from("app_sessions").select("id,user_id,branch_id,session_version,remember_device,expires_at,last_activity_at,revoked_at")
      .eq("id",sessionId).eq("user_id",userId).maybeSingle(),
    admin.from("user_profiles").select("id,role_key,legacy_role,is_active,must_change_password,session_version")
      .eq("id",userId).maybeSingle(),
  ]);
  const row=sessionResult.data,profile=profileResult.data;
  if(sessionResult.error || profileResult.error || !row || !profile ||
     !sessionIsLive(row,profile) || !allowedPtgStudioRole(profile)) return null;
  if(row.branch_id){
    const {data:branch,error}=await admin.from("branches")
      .select("status,operational_status").eq("id",row.branch_id).maybeSingle();
    if(error || !branch || branch.status!=="ACTIVE" || branch.operational_status!=="ON")return null;
  }
  return {row,profile};
}
async function issue(request:Request,body:Record<string,unknown>){
  const origin=request.headers.get("origin");
  if(!issuerOrigin)return json({ok:false,message:"Studio issuer origin is not configured."},503);
  if(origin!==issuerOrigin)return json({ok:false,message:"Untrusted issuer origin."},403);
  const studio=body.studio;
  if(!validStudioId(studio))return json({ok:false,message:"Invalid studio."},400,origin);
  if(!gatewaySecret || gatewaySecret.length<32)return json({ok:false,message:"Studio access is not configured."},503,origin);
  const authorization=request.headers.get("authorization")??"";
  if(!authorization.startsWith("Bearer "))return json({ok:false,message:"Sign in to PTG first."},401,origin);
  const userClient=createClient(url,pub,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{headers:{Authorization:authorization}},
  });
  const {data:{user},error}=await userClient.auth.getUser();
  const id=request.headers.get("x-ptg-session-id")??"";
  if(error || !user || !id)return json({ok:false,message:"PTG login required."},401,origin);
  const active=await validSourceSession(user.id,id);
  if(!active)return json({ok:false,message:"PTG Team Leader or higher access required."},403,origin);
  // Atomic DB-backed quota: unlike an in-memory counter it works across Edge
  // instances and competing tabs. A missing RPC fails closed, never issues a ticket.
  const {data:reserved,error:quotaError}=await admin.rpc("ptg_studio_reserve_issue_slot",{
    p_user_id:user.id,
  });
  if(quotaError)return json({ok:false,message:"Studio access is temporarily unavailable."},503,origin);
  if(reserved!==true)return json({ok:false,message:"Too many Studio launches. Try again in one minute."},429,origin,{"Retry-After":"60"});
  const ticket=randomToken();
  const ticketHash=await digest(ticket);
  const expires=new Date(Date.now()+STUDIO_GRANT_LIFETIME_SECONDS*1000).toISOString();
  const {error:insertError}=await admin.from("ptg_studio_access_tickets").insert({
    ticket_hash:ticketHash,studio_id:studio,user_id:user.id,
    app_session_id:active.row.id,expires_at:expires,
  });
  if(insertError){
    console.error("Cannot store Studio ticket.",insertError.code);
    return json({ok:false,message:"Studio access could not be issued."},503,origin);
  }
  return json({ok:true,ticket,expiresAt:expires},200,origin);
}
async function verify(request:Request,body:Record<string,unknown>){
  const incoming=request.headers.get("x-ptg-studio-secret")??"";
  if(!equalSecret(incoming,gatewaySecret))return json({ok:false},403);
  const studio=body.studio,ticket=body.ticket;
  if(!validStudioId(studio)||typeof ticket!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(ticket))
    return json({ok:false},400);
  const hash=await digest(ticket);
  const {data:grant,error}=await admin.from("ptg_studio_access_tickets")
    .select("ticket_hash,studio_id,user_id,app_session_id,expires_at,revoked_at,redeemed_at")
    .eq("ticket_hash",hash).eq("studio_id",studio).maybeSingle();
  if(error||!grant||grant.revoked_at||grant.redeemed_at||Date.parse(grant.expires_at)<=Date.now())
    return json({ok:false},403);
  const active=await validSourceSession(grant.user_id,grant.app_session_id);
  if(!active)return json({ok:false},403);
  return json({ok:true,expiresAt:grant.expires_at},200);
}
// One-time exchange: the browser generates a non-extractable P-256 private key.
// Only the exported public JWK crosses to PTG; the launch bearer is then burned.
async function exchange(request:Request,body:Record<string,unknown>){
 const incoming=request.headers.get("x-ptg-studio-secret")??"";
 if(!equalSecret(incoming,gatewaySecret))return json({ok:false},403);
 const studio=body.studio,ticket=body.ticket,publicKey=body.publicKey;
 if(!validStudioId(studio)||typeof ticket!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(ticket)||!validPublicKey(publicKey))
  return json({ok:false},400);
 try{await crypto.subtle.importKey("jwk",publicKey as JsonWebKey,{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);}
 catch{return json({ok:false},400);}
 const hash=await digest(ticket as string),now=Date.now();
 const {data:grant,error}=await admin.from("ptg_studio_access_tickets")
  .select("ticket_hash,studio_id,user_id,app_session_id,expires_at,revoked_at,redeemed_at")
  .eq("ticket_hash",hash).eq("studio_id",studio).maybeSingle();
 if(error||!grant||grant.revoked_at||grant.redeemed_at||Date.parse(grant.expires_at)<=now)
  return json({ok:false},403);
 const active=await validSourceSession(grant.user_id,grant.app_session_id);
 if(!active)return json({ok:false},403);
 // An account-specific recovery key is available only after a redeemed proof
 // session. Missing stable server secret must fail closed BEFORE ticket burn.
 const draftRoot=Deno.env.get("PTG_STUDIO_DRAFT_RECOVERY_SECRET")??"";
 if((studio==="megaframe"||studio==="flyer") && draftRoot.length<32)return json({ok:false},503);
 // Compare-and-swap: only a single concurrent exchange can burn this launch ticket.
 const {data:burned,error:burnError}=await admin.from("ptg_studio_access_tickets")
  .update({redeemed_at:new Date(now).toISOString()}).eq("ticket_hash",hash)
  .eq("studio_id",studio).is("redeemed_at",null).is("revoked_at",null)
  .gt("expires_at",new Date(now).toISOString()).select("ticket_hash").maybeSingle();
 if(burnError||!burned)return json({ok:false},403);
 const challenge=randomToken();
 const expiry=Math.min(now+STUDIO_PROOF_LIFETIME_SECONDS*1000,Date.parse(active.row.expires_at));
 if(expiry<=now)return json({ok:false},403);
 const challengeDeadline=Math.min(expiry,now+STUDIO_CHALLENGE_LIFETIME_SECONDS*1000);
 const {data:session,error:sessionError}=await admin.from("ptg_studio_proof_sessions")
  .insert({studio_id:studio,user_id:grant.user_id,app_session_id:grant.app_session_id,
    public_jwk:publicKey,challenge_hash:await digest(challenge),
    challenge_expires_at:new Date(challengeDeadline).toISOString(),
    expires_at:new Date(expiry).toISOString()})
  .select("id").single();
 if(sessionError||!session)return json({ok:false},503);
 const recovery=(studio==="megaframe"||studio==="flyer")
  ? await studioDraftMaterial(draftRoot,studio,grant.user_id) : {};
 return json({ok:true,sessionId:session.id,challenge,expiresAt:new Date(expiry).toISOString(),...recovery});
}
// Each signed challenge is consumed exactly once; server rechecks PTG role,
// branch, forced logout and live session version before issuing the next challenge.
async function prove(request:Request,body:Record<string,unknown>){
 const incoming=request.headers.get("x-ptg-studio-secret")??"";
 if(!equalSecret(incoming,gatewaySecret))return json({ok:false},403);
 const studio=body.studio;
 if(!validStudioId(studio)||!validProofRequest(body))return json({ok:false},400);
 const now=Date.now();
 const {data:record,error}=await admin.from("ptg_studio_proof_sessions")
  .select("id,studio_id,user_id,app_session_id,public_jwk,challenge_hash,challenge_expires_at,expires_at,revoked_at")
  .eq("id",body.sessionId).eq("studio_id",studio).maybeSingle();
 if(error||!record||record.revoked_at||Date.parse(record.expires_at)<=now||
    Date.parse(record.challenge_expires_at)<=now||
    record.challenge_hash!==await digest(body.challenge as string))return json({ok:false},403);
 const active=await validSourceSession(record.user_id,record.app_session_id);
 if(!active)return json({ok:false},403);
 let verified=false;
 try{
  if(!validPublicKey(record.public_jwk))return json({ok:false},403);
  const key=await crypto.subtle.importKey("jwk",record.public_jwk,{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
  verified=await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},key,
   decodeSignature(body.signature as string),
   new TextEncoder().encode(proofMessage(studio as string,body.sessionId as string,body.challenge as string)));
 }catch{return json({ok:false},403);}
 if(!verified)return json({ok:false},403);
 const nextChallenge=randomToken(),nextHash=await digest(nextChallenge);
 const expiry=Math.min(Date.parse(record.expires_at),Date.parse(active.row.expires_at));
 if(expiry<=Date.now())return json({ok:false},403);
 const deadline=Math.min(expiry,Date.now()+STUDIO_CHALLENGE_LIFETIME_SECONDS*1000);
 // Atomic compare-and-swap prevents reuse of recorded proof from another tab/device.
 const {data:changed,error:changeError}=await admin.from("ptg_studio_proof_sessions")
  .update({challenge_hash:nextHash,challenge_expires_at:new Date(deadline).toISOString()})
  .eq("id",record.id).eq("challenge_hash",record.challenge_hash)
  .gt("challenge_expires_at",new Date().toISOString()).is("revoked_at",null)
  .select("id").maybeSingle();
 if(changeError||!changed)return json({ok:false},403);
 return json({ok:true,sessionId:record.id,challenge:nextChallenge,expiresAt:new Date(expiry).toISOString()});
}

Deno.serve(async request=>{
  const origin=request.headers.get("origin")??undefined;
  if(issuerOrigin && request.method==="OPTIONS"&&origin===issuerOrigin)
    return new Response(null,{status:204,headers:{
      "Access-Control-Allow-Origin":issuerOrigin,"Vary":"Origin",
      "Access-Control-Allow-Methods":"POST, OPTIONS",
      "Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type, x-ptg-session-id",
      ...noStore,
    }});
  if(request.method!=="POST")return json({ok:false},405);
  try{
    const raw=await request.text();
    if(raw.length>4096)return json({ok:false},413);
    const body=JSON.parse(raw);
    if(!body||typeof body!=="object"||Array.isArray(body))return json({ok:false},400);
    if(body.action==="issue")return issue(request,body);
    if(body.action==="verify")return verify(request,body);
    if(body.action==="exchange")return exchange(request,body);
    if(body.action==="prove")return prove(request,body);
    return json({ok:false},400);
  }catch(error){
    console.error("PTG Studio access internal failure:",error instanceof Error?error.name:"unknown");
    return json({ok:false,message:"Studio authorization unavailable."},503);
  }
});
