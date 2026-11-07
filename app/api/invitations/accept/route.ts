import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
export const runtime="nodejs";
export async function POST(request:Request){
 if(request.headers.get("origin")!==new URL(request.url).origin)return NextResponse.json({ok:false,message:"Request origin is not allowed."},{status:403});
 let body:{token?:string};try{body=await request.json();}catch{return NextResponse.json({ok:false,message:"Invalid request."},{status:400});}
 const token=String(body.token??"");
 if(token.length<30||token.length>200)return NextResponse.json({ok:false,message:"This invitation is invalid or expired."},{status:400});
 const hash=createHash("sha256").update(token).digest("hex"),admin=createAdminClient(),now=new Date().toISOString();
 const {data:invite,error}=await admin.schema("private").from("account_invitations").select("id,user_id,expires_at,accepted_at").eq("token_hash",hash).maybeSingle();
 if(error||!invite||invite.accepted_at||new Date(invite.expires_at).getTime()<=Date.now())return NextResponse.json({ok:false,message:"This invitation is invalid, expired, or already used."},{status:400});
 const {data:consumed,error:consumeError}=await admin.schema("private").from("account_invitations").update({accepted_at:now}).eq("id",invite.id).is("accepted_at",null).gt("expires_at",now).select("id").maybeSingle();
 if(consumeError||!consumed)return NextResponse.json({ok:false,message:"This invitation has already been used or expired."},{status:409});
 const {data:profile,error:profileError}=await admin.from("user_profiles").update({is_active:true,invitation_status:"ACCEPTED",invitation_accepted_at:now,updated_at:now}).eq("id",invite.user_id).eq("invitation_status","SENT").select("id").maybeSingle();
 if(profileError||!profile)return NextResponse.json({ok:false,message:"The invitation could not be activated. Contact your System Admin."},{status:503});
 await admin.from("security_audit_logs").insert({actor_user_id:invite.user_id,event_category:"ACCOUNT_SECURITY",action:"ACCEPT_ACCOUNT_INVITATION",target_identifier:invite.user_id,outcome:"SUCCESS",message:"Employee accepted account invitation. Initial password change remains required."});
 return NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store"}});
}
