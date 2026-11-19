// STAGED: shared PTG entitlement authority for MegaFrame Studio and Flyer Studio.
// Must not be deployed or have its schema applied until explicit release approval.
import {createClient} from "npm:@supabase/supabase-js@2";
import {
  allowedPtgStudioRole, sessionIsLive, validStudioId,
  STUDIO_GRANT_LIFETIME_SECONDS,
} from "../_shared/studio-access-policy.mjs";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const secret = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const pub = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const gatewaySecret = Deno.env.get("PTG_STUDIO_GATEWAY_SECRET") ?? "";
// Issuance from the PTG hostname only. Never use a wildcard/github.io origin.
const issuerOrigin = "https://first-megasaver-ptg.vercel.app";
const admin = createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const noStore = {"Cache-Control":"no-store, private","Pragma":"no-cache"};
function json(body:unknown,status=200,origin?:string) {
  const headers:Record<string,string>={"Content-Type":"application/json; charset=utf-8",...noStore};
  if(origin===issuerOrigin){
    headers["Access-Control-Allow-Origin"]=issuerOrigin;
    headers["Vary"]="Origin";
    headers["Access-Control-Allow-Headers"]="authorization, apikey, x-client-info, content-type, x-ptg-session-id";
    headers["Access-Control-Allow-Methods"]="POST, OPTIONS";
  }
  return new Response(JSON.stringify(body),{status,headers});
}
const bytesToHex=(data:Uint8Array)=>Array.from(data,b=>b.toString(16).padStart(2,"0")).join("");
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
  const random=new Uint8Array(32);
  crypto.getRandomValues(random);
  const ticket=btoa(String.fromCharCode(...random)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
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
    .select("ticket_hash,studio_id,user_id,app_session_id,expires_at,revoked_at")
    .eq("ticket_hash",hash).eq("studio_id",studio).maybeSingle();
  if(error||!grant||grant.revoked_at||Date.parse(grant.expires_at)<=Date.now())
    return json({ok:false},403);
  const active=await validSourceSession(grant.user_id,grant.app_session_id);
  if(!active)return json({ok:false},403);
  return json({ok:true,expiresAt:grant.expires_at},200);
}
Deno.serve(async request=>{
  const origin=request.headers.get("origin")??undefined;
  if(request.method==="OPTIONS"&&origin===issuerOrigin)
    return new Response(null,{status:204,headers:{
      "Access-Control-Allow-Origin":issuerOrigin,"Vary":"Origin",
      "Access-Control-Allow-Methods":"POST, OPTIONS",
      "Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type, x-ptg-session-id",
      ...noStore,
    }});
  if(request.method!=="POST")return json({ok:false},405);
  try{
    const body=await request.json();
    if(!body||typeof body!=="object"||Array.isArray(body))return json({ok:false},400);
    if(body.action==="issue")return issue(request,body);
    if(body.action==="verify")return verify(request,body);
    return json({ok:false},400);
  }catch(error){
    console.error("PTG Studio access internal failure:",error instanceof Error?error.name:"unknown");
    return json({ok:false,message:"Studio authorization unavailable."},503);
  }
});
