import { NextResponse } from "next/server";
import { requireAdminPermission, writeAdminAudit } from "@/lib/auth/authorization";\nimport { getActiveAppSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
export const runtime="nodejs";
export const dynamic="force-dynamic";
function fail(error:unknown){
 const code=error instanceof Error?error.message:"INTERNAL_ERROR";
 if(code==="AUTH_REQUIRED")return NextResponse.json({ok:false},{status:401});
 if(code==="PERMISSION_DENIED")return NextResponse.json({ok:false,message:"You are not authorized to perform this action."},{status:403});
 return NextResponse.json({ok:false,message:code==="LAST_ADMIN"? "The last active System Admin cannot be disabled.":"The account operation could not be completed."},{status:400});
}
export async function PATCH(request:Request,context:{params:Promise<{userId:string}>}){
 try{
  if(request.headers.get("origin")!==new URL(request.url).origin)return NextResponse.json({ok:false},{status:403});
  const current=await getActiveAppSession();\n  if(!current)return NextResponse.json({ok:false},{status:401});\n  if(current.mustChangePassword)return NextResponse.json({ok:false},{status:403});\n  const {userId}=await context.params;
  const body=await request.json() as {action?:string;password?:string;enabled?:boolean};
  const action=String(body.action??"").toUpperCase();
  const admin=createAdminClient();
  const {data:target,error:targetError}=await admin.from("user_profiles").select("id,display_name,role_key,legacy_role,branch_id,is_active").eq("id",userId).maybeSingle();
  if(targetError||!target)return NextResponse.json({ok:false,message:"Account not found."},{status:404});
  if(action==="RESET_PASSWORD"){
   const password=String(body.password??"");
   if(password.length<12||password.length>1024)return NextResponse.json({ok:false,message:"Temporary password must be at least 12 characters."},{status:400});
   const {session}=await requireAdminPermission("PASSWORD_RESET","EXECUTE",target.branch_id);
   const {error}=await admin.auth.admin.updateUserById(userId,{password});
   if(error)throw new Error("PASSWORD_UPDATE_FAILED");
   const {error:stateError}=await admin.rpc("reset_ptg_user_password_state",{p_user_id:userId});
   if(stateError)throw new Error("PASSWORD_STATE_UPDATE_FAILED");
   await writeAdminAudit({actorUserId:session.userId,branchId:target.branch_id,action:"RESET_PASSWORD",target:userId,outcome:"SUCCESS",message:"Password reset; user must change password on next sign-in.",metadata:{role:target.role_key}});
   return NextResponse.json({ok:true});
  }
  if(action==="SET_STATUS"){
   if(typeof body.enabled!=="boolean")return NextResponse.json({ok:false,message:"enabled must be true or false."},{status:400});
   const {session}=await requireAdminPermission("USER_STATUS_CONTROL","EXECUTE",target.branch_id);
   const {error}=await admin.rpc("set_ptg_user_status",{p_user_id:userId,p_enabled:body.enabled});
   if(error){if(error.message.includes("last active SYSTEM ADMIN"))throw new Error("LAST_ADMIN");throw error;}
   await writeAdminAudit({actorUserId:session.userId,branchId:target.branch_id,action:body.enabled?"ENABLE_ACCOUNT":"DISABLE_ACCOUNT",target:userId,outcome:"SUCCESS",message:body.enabled?"Account enabled.":"Account disabled and sessions revoked.",metadata:{role:target.role_key}});
   return NextResponse.json({ok:true});
  }
  if(action==="FORCE_LOGOUT"){
   const {session}=await requireAdminPermission("FORCE_LOGOUT","EXECUTE",target.branch_id);
   const {error}=await admin.rpc("bump_ptg_user_session_version",{p_user_id:userId});
   if(error)throw error;
   await writeAdminAudit({actorUserId:session.userId,branchId:target.branch_id,action:"FORCE_LOGOUT",target:userId,outcome:"SUCCESS",message:"All active application sessions revoked.",metadata:{role:target.role_key}});
   return NextResponse.json({ok:true});
  }
  return NextResponse.json({ok:false,message:"Unsupported account action."},{status:400});
 }catch(error){return fail(error);}
}
