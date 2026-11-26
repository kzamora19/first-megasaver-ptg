import {createClient} from "npm:@supabase/supabase-js@2.95.0";
import {runCleanup} from "../_shared/retention-cleanup.mjs";
const encoder=new TextEncoder();
async function sameSecret(a:string,b:string){
 const x=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(a))),y=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(b)));let v=0;for(let i=0;i<x.length;i++)v|=x[i]^y[i];return v===0;
}
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async request=>{
 if(request.method!=="POST")return reply({ok:false},405);
 const expected=Deno.env.get("RETENTION_CRON_TOKEN")??"",actual=request.headers.get("x-retention-cron-token")??"";
 if(Deno.env.get("RETENTION_RUNTIME_ENABLED")!=="true"||expected.length<32||actual.length>512||!await sameSecret(expected,actual))return reply({ok:false},403);
 try{
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SECRET_KEY")??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)throw Error("Missing server configuration");
  const admin=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  return reply({ok:true,cleanup:await runCleanup({admin,actorId:null,dryRun:false,fileId:null})});
 }catch{return reply({ok:false,message:"Cleanup not confirmed. Review the registry."},503);}
});
