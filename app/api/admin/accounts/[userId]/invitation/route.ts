import {NextResponse} from "next/server";
import {isEmailConfigured,makeInvitationToken,makeTemporaryPassword,sendAccountInvitation} from "@/lib/email/send-account-invitation";
import {requireAdminPermission,writeAdminAudit} from "@/lib/auth/authorization";
import {getActiveAppSession} from "@/lib/auth/session";
import {createAdminClient} from "@/lib/supabase/admin";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{userId:string}>}){
 try{
  if(request.headers.get("origin")!==new URL(request.url).origin)return NextResponse.json({ok:false},{status:403});
  const current=await getActiveAppSession();if(!current)return NextResponse.json({ok:false},{status:401});
  if(current.mustChangePassword)return NextResponse.json({ok:false},{status:403});
  if(!isEmailConfigured())return NextResponse.json({ok:false,message:"Email delivery is not configured."},{status:503});
  const {userId}=await context.params,admin=createAdminClient();
  const {data:target,error}=await admin.from("user_profiles").select("id,display_name,role_key,legacy_role,branch_id,email,invitation_status").eq("id",userId).maybeSingle();
  if(error||!target)return NextResponse.json({ok:false,message:"Account not found."},{status:404});
  if(!target.email||target.role_key==="SYSTEM_ADMIN"||(current.role==="BRANCH_ADMIN"&&target.role_key!=="BRANCH_USER"))return NextResponse.json({ok:false},{status:403});
  const permission=target.role_key==="BRANCH_USER"||target.role_key==="BRANCH_ADMIN"?"BRANCH_USER_ACCOUNT_MANAGEMENT":"SYSTEM_ADMIN_ACCOUNT_MANAGEMENT";
  const {session}=await requireAdminPermission(permission,"EXECUTE",target.branch_id);
  const {data:identity}=await admin.schema("private").from("login_identities").select("username").eq("auth_user_id",userId).single();
  if(!identity?.username)throw new Error("ACCOUNT_IDENTITY_NOT_FOUND");
  const temporaryPassword=makeTemporaryPassword(),{token,hash}=makeInvitationToken(),expiresAt=new Date(Date.now()+48*60*60*1000).toISOString(),now=new Date().toISOString();
  const {error:passwordError}=await admin.auth.admin.updateUserById(userId,{password:temporaryPassword});if(passwordError)throw new Error("PASSWORD_UPDATE_FAILED");
  const {error:stateError}=await admin.rpc("bump_ptg_user_session_version",{p_user_id:userId});if(stateError)throw new Error("SESSION_REVOKE_FAILED");
  const {error:deleteError}=await admin.schema("private").from("account_invitations").delete().eq("user_id",userId).is("accepted_at",null);if(deleteError)throw new Error("INVITATION_UPDATE_FAILED");
  const {error:tokenError}=await admin.schema("private").from("account_invitations").insert({user_id:userId,token_hash:hash,expires_at:expiresAt});if(tokenError)throw new Error("INVITATION_UPDATE_FAILED");
  const {error:profileError}=await admin.from("user_profiles").update({is_active:false,must_change_password:true,invitation_status:"SENT",invited_at:now,invitation_expires_at:expiresAt,invitation_accepted_at:null,activated_at:null,updated_at:now}).eq("id",userId);
  if(profileError)throw new Error("INVITATION_UPDATE_FAILED");
  const acceptUrl=new URL("/invitation/accept",request.url);acceptUrl.searchParams.set("token",token);
  const emailId=await sendAccountInvitation({email:target.email,displayName:target.display_name,username:identity.username,temporaryPassword,acceptUrl:acceptUrl.toString()});
  await writeAdminAudit({actorUserId:session.userId,branchId:target.branch_id,action:"RESEND_ACCOUNT_INVITATION",target:identity.username,outcome:"SUCCESS",message:"New single-use invitation and temporary password emailed.",metadata:{email:target.email,emailId,expiresAt}});
  return NextResponse.json({ok:true,invitationStatus:"SENT"},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  const code=error instanceof Error?error.message:"INTERNAL_ERROR";
  return NextResponse.json({ok:false,message:code==="EMAIL_DELIVERY_FAILED"?"Invitation email could not be sent. The account remains inactive; retry after verifying email settings.":"Unable to resend invitation."},{status:code==="EMAIL_DELIVERY_FAILED"?502:400});
 }
}
