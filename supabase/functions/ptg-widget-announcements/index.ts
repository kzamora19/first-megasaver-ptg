import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const projectUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const allowedOrigins = new Set(
  (Deno.env.get("PTG_ALLOWED_ORIGINS") ?? "https://kzamora19.github.io,http://localhost:3000,http://127.0.0.1:3000")
    .split(",").map(value => value.trim()).filter(Boolean),
);
const admin = createClient(projectUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const respond = (origin: string, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-ptg-session-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  },
});
const fail = (message: string) => ({ ok: false, message });

type ActiveSession = { id: string; userId: string; role: string; branchId: string | null; username: string; mustChangePassword: boolean };

async function getSession(request: Request): Promise<ActiveSession | null> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const client = createClient(projectUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await client.auth.getUser(authorization.slice(7));
  if (authError || !authData.user) return null;
  const appSessionId = request.headers.get("x-ptg-session-id");
  if (!appSessionId || appSessionId.length > 100) return null;
  const { data: row, error: rowError } = await admin.from("app_sessions")
    .select("id,user_id,branch_id,session_version,remember_device,last_activity_at,expires_at,revoked_at")
    .eq("id", appSessionId).eq("user_id", authData.user.id).is("revoked_at", null).maybeSingle();
  if (rowError || !row) return null;
  const now = Date.now();
  const idleLimitMs = row.remember_device === true ? 7 * 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
  const activity = Date.parse(row.last_activity_at), expiry = Date.parse(row.expires_at);
  const idleExpired = !Number.isFinite(activity) || activity > now + 60000 || now - activity > idleLimitMs;
  const absoluteExpired = !Number.isFinite(expiry) || expiry <= now;
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("role_key,is_active,session_version,must_change_password")
    .eq("id", authData.user.id).maybeSingle();
  if (profileError || !profile || !profile.is_active || Number(profile.session_version) !== Number(row.session_version) || idleExpired || absoluteExpired) {
    return null;
  }
  if (row.branch_id) {
    const { data: branch } = await admin.from("branches").select("status,operational_status").eq("id", row.branch_id).maybeSingle();
    if (!branch || branch.status !== "ACTIVE" || branch.operational_status !== "ON") {
      return null;
    }
  }
  return {
    id: row.id,
    userId: authData.user.id,
    role: profile.role_key,
    branchId: row.branch_id,
    username: "",
    mustChangePassword: profile.must_change_password === true,
  };
}


import { safeMemoNotices } from "./projection.mjs";
import {remoteRetentionRequest,REMOTE_RETENTION_PROJECTS} from "../_shared/retention-relay.ts";
Deno.serve(async request => {
  const origin=request.headers.get("origin")??"";
  if(!allowedOrigins.has(origin))return new Response(JSON.stringify(fail("Request origin is not allowed.")),{status:403,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type, x-ptg-session-id","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"}});
  if(request.method!=="POST")return respond(origin,fail("Method not allowed."),405);
  try{
    const session=await getSession(request);
    if(!session)return respond(origin,fail("Please sign in again."),401);
    if(session.mustChangePassword||!["SYSTEM_ADMIN","BRANCH_ADMIN","BRANCH_USER"].includes(session.role)||(!session.branchId&&session.role!=="SYSTEM_ADMIN"))
      return respond(origin,fail("PTG access is not enabled for this account."),403);
    let retentionNotices:{id:string;title:string;body:string}[]=[];
    if(session.role==="SYSTEM_ADMIN"){
      const {data,error}=await admin.rpc("ptg_retention_notices",{p_actor_id:session.userId});
      if(!error&&Array.isArray(data))retentionNotices=data.filter(n=>n&&typeof n.id==="string"&&n.id.startsWith("retention:")&&typeof n.title==="string"&&typeof n.body==="string");
      const remote=await Promise.all(Object.entries(REMOTE_RETENTION_PROJECTS).map(async ([key,config])=>{
        try{const result=await remoteRetentionRequest(session,key,"notices");
          if(!Array.isArray(result.data))return [];
          return result.data.filter(n=>n&&typeof n.id==="string"&&n.id.startsWith("retention:")&&typeof n.title==="string"&&typeof n.body==="string")
            .map(n=>({id:key+":"+n.id,title:config.label+" · "+n.title,body:n.body}));
        }catch{return [];}
      }));
      retentionNotices.push(...remote.flat());
    }
    const since=new Date(Date.now()-14*86400000).toISOString();
    const {data:memos,error:memoError}=await admin.from("price_memos").select("id,memo_id,period,imported_at,memo_type,branch_id,product_count")
      .is("branch_id",null).in("memo_type",["MEMO_LIST","KIOSK_MEMO_LIST"]).gte("imported_at",since).order("imported_at",{ascending:false}).order("id",{ascending:false}).limit(15);
    if(memoError)throw Error("Memo metadata unavailable");
    if(!memos?.length)return respond(origin,{ok:true,notices:retentionNotices});
    const {data:campaigns,error:campaignError}=await admin.from("ptg_memo_campaigns").select("memo_number,campaign").in("memo_number",memos.map(m=>m.memo_id));
    if(campaignError)throw Error("Campaign scope unavailable");
    const blocked=new Set((campaigns||[]).filter(c=>String(c.campaign).trim().toUpperCase()==="SUBDEALER").map(c=>c.memo_number));
    const eligible=memos.filter(m=>!blocked.has(m.memo_id)&&!/^SUB(?:CON-|D?20\d{2}-)/i.test(m.memo_id)&&m.product_count>0&&m.product_count<=10000);
    if(!eligible.length)return respond(origin,{ok:true,notices:retentionNotices});
    const products=[];
    let complete=false;
    // Only brand and memo ID are read; never price, customer, or audit details.
    // Bounded paging fails closed rather than returning an incomplete brand list.
    for(let offset=0;offset<30000;offset+=1000){
      const {data,error}=await admin.from("memo_products").select("memo_id,brand").in("memo_id",eligible.map(m=>m.id)).order("id",{ascending:true}).range(offset,offset+999);
      if(error)throw Error("Memo brands unavailable");
      products.push(...(data||[]));
      if((data||[]).length<1000){complete=true;break;}
    }
    if(!complete)throw Error("Memo brand result exceeds safe bound");
    return respond(origin,{ok:true,notices:[...retentionNotices,...safeMemoNotices(eligible,campaigns||[],products)]});
  }catch{return respond(origin,fail("Memo announcements temporarily unavailable."),503);}
});
