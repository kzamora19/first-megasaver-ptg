import { NextResponse } from "next/server";
import { requireAdminPermission, writeAdminAudit } from "@/lib/auth/authorization";
import { getActiveAppSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { makeInvitationToken, makeTemporaryPassword, sendAccountInvitation } from "@/lib/email/send-account-invitation";
export const runtime="nodejs";
export const dynamic="force-dynamic";
function sameOrigin(request:Request){return request.headers.get("origin")===new URL(request.url).origin;}
function failure(error:unknown){
 const code=error instanceof Error?error.message:"INTERNAL_ERROR";
 if(code==="AUTH_REQUIRED")return NextResponse.json({ok:false},{status:401});
 if(code==="PERMISSION_DENIED")return NextResponse.json({ok:false,message:"You are not authorized to perform this action."},{status:403});
 if(code==="EMAIL_PROVIDER_NOT_CONFIGURED")return NextResponse.json({ok:false,message:"Invitation email is not configured yet. Ask the System Admin to configure the email provider."},{status:503});
 if(code==="EMAIL_DELIVERY_FAILED")return NextResponse.json({ok:false,message:"The invitation email could not be sent. No account was retained; verify the sender and email provider settings."},{status:502});
 return NextResponse.json({ok:false,message:"The account operation could not be completed."},{status:400});
}
export async function GET(request:Request){
 try{
  if(!sameOrigin(request))return NextResponse.json({ok:false},{status:403});
  const current=await getActiveAppSession();if(!current)throw new Error("AUTH_REQUIRED");
  const branchId=current.role==="BRANCH_ADMIN"?current.branchId:new URL(request.url).searchParams.get("branchId");
  const permission=current.role==="SYSTEM_ADMIN"?"SYSTEM_ADMIN_ACCOUNT_MANAGEMENT":"BRANCH_USER_ACCOUNT_MANAGEMENT";
  const {admin}=await requireAdminPermission(permission,"VIEW",branchId);
  let query=admin.from("user_profiles").select("id,display_name,role_key,legacy_role,branch_id,email,invitation_status,invited_at,invitation_expires_at,invitation_accepted_at,activated_at,is_active,failed_login_attempts,locked_until,must_change_password,created_at,updated_at").order("display_name");
  if(current.role==="BRANCH_ADMIN")query=query.eq("branch_id",current.branchId);
  else if(branchId)query=query.eq("branch_id",branchId);
  const {data,error}=await query;if(error)throw error;
  let branches:{id:string;branch_code:string;branch_name:string;status:string;operational_status:string}[]=[];
  if(current.role==="SYSTEM_ADMIN"){const {data:rows}=await admin.from("branches").select("id,branch_code,branch_name,status,operational_status").order("branch_code");branches=rows??[];}
  else if(current.role==="BRANCH_ADMIN"&&current.branchId){const {data:rows}=await admin.from("branches").select("id,branch_code,branch_name,status,operational_status").eq("id",current.branchId);branches=rows??[];}
  const accounts=(data??[]).map(account=>account.invitation_status==="SENT"&&account.invitation_expires_at&&new Date(account.invitation_expires_at).getTime()<=Date.now()?{...account,invitation_status:"EXPIRED"}:account);
  return NextResponse.json({ok:true,accounts,branches},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return failure(error);}
}
export async function POST(request:Request){
 let createdUserId:string|null=null;
 try{
  if(!sameOrigin(request))return NextResponse.json({ok:false},{status:403});
  const body=await request.json() as {username?:string;displayName?:string;email?:string;role?:string;branchId?:string;legacyRole?:string};
  const username=String(body.username??"").trim().toUpperCase();
  const displayName=String(body.displayName??"").trim();
  const email=String(body.email??"").trim().toLowerCase();
  const role=String(body.role??"").trim().toUpperCase();
  const legacyRole=String(body.legacyRole??role.replaceAll("_"," ")).trim().toUpperCase();
  const branchId=body.branchId??null;
  if(!/^[A-Z0-9._-]{3,32}$/.test(username)||!displayName||displayName.length>120||!/^\S+@\S+\.\S+$/.test(email)||email.length>254)
   return NextResponse.json({ok:false,message:"Enter a valid username, full name, and employee email address."},{status:400});
  if(!["SYSTEM_ADMIN","BRANCH_ADMIN","BRANCH_USER"].includes(role))return NextResponse.json({ok:false,message:"Invalid application role."},{status:400});
  if(role.startsWith("BRANCH_")!==!!branchId)return NextResponse.json({ok:false,message:"Select a branch for branch accounts only."},{status:400});
  if(role==="BRANCH_USER"&&!["BRANCH USER","TEAM LEADER"].includes(legacyRole))return NextResponse.json({ok:false,message:"Invalid branch account title."},{status:400});
  if(role==="BRANCH_ADMIN"&&!["BRANCH ADMIN","BRANCH MANAGER"].includes(legacyRole))return NextResponse.json({ok:false,message:"Invalid Branch Admin title."},{status:400});
  const permission=role==="SYSTEM_ADMIN"?"SYSTEM_ADMIN_ACCOUNT_MANAGEMENT":"BRANCH_USER_ACCOUNT_MANAGEMENT";
  const {session,admin}=await requireAdminPermission(permission,"EXECUTE",branchId);
  if(role==="SYSTEM_ADMIN"&&session.role!=="SYSTEM_ADMIN")throw new Error("PERMISSION_DENIED");
  if(session.role==="BRANCH_ADMIN"&&role!=="BRANCH_USER")throw new Error("PERMISSION_DENIED");
  if(role.startsWith("BRANCH_")){
   const {data:branch,error}=await admin.from("branches").select("id,status,operational_status").eq("id",branchId).maybeSingle();
   if(error||!branch||branch.status!=="ACTIVE"||branch.operational_status!=="ON")return NextResponse.json({ok:false,message:"The selected branch is not active."},{status:400});
  }
  const {data:existing}=await admin.from("user_profiles").select("id").ilike("email",email).maybeSingle();
  if(existing)return NextResponse.json({ok:false,message:"That email address is already assigned to an account."},{status:409});
  const normalized=username.toLowerCase();
  const authEmail=role==="SYSTEM_ADMIN"?`ptg.system.${normalized}@accounts.firstmegasaver.invalid`:`ptg.${String(branchId).replace(/-/g,"")}.${normalized}@accounts.firstmegasaver.invalid`;
  const temporaryPassword=makeTemporaryPassword();
  const {token,hash}=makeInvitationToken();
  const expiresAt=new Date(Date.now()+48*60*60*1000).toISOString();
  const {data:created,error:createError}=await admin.auth.admin.createUser({email:authEmail,password:temporaryPassword,email_confirm:true,user_metadata:{display_name:displayName},app_metadata:{application:"first-megasaver-ptg"}});
  if(createError||!created.user)throw new Error("AUTH_USER_CREATE_FAILED");
  createdUserId=created.user.id;
  const {error:provisionError}=await admin.rpc("provision_ptg_user_profile",{p_user_id:createdUserId,p_username:username,p_display_name:displayName,p_role_key:role,p_legacy_role:legacyRole,p_branch_id:branchId,p_auth_email:authEmail});
  if(provisionError)throw new Error("ACCOUNT_RECORD_CREATE_FAILED");
  const {error:profileError}=await admin.from("user_profiles").update({email,invitation_status:"SENT",invited_at:new Date().toISOString(),invitation_expires_at:expiresAt,is_active:false,must_change_password:true}).eq("id",createdUserId);
  if(profileError)throw new Error("ACCOUNT_RECORD_CREATE_FAILED");
  const {error:tokenError}=await admin.schema("private").from("account_invitations").insert({user_id:createdUserId,token_hash:hash,expires_at:expiresAt});
  if(tokenError)throw new Error("INVITATION_CREATE_FAILED");
  const acceptUrl=new URL("/invitation/accept",request.url);acceptUrl.searchParams.set("token",token);
  const emailId=await sendAccountInvitation({email,displayName,username,temporaryPassword,acceptUrl:acceptUrl.toString()});
  await writeAdminAudit({actorUserId:session.userId,branchId:role.startsWith("BRANCH_")?branchId:null,action:"CREATE_ACCOUNT_INVITATION",target:username,outcome:"SUCCESS",message:"Account invitation emailed; account remains inactive until invitation acceptance and initial password change.",metadata:{role,legacyRole,email,emailId,expiresAt}});
  return NextResponse.json({ok:true,account:{id:createdUserId,username,displayName,email,role,legacyRole,branchId,invitationStatus:"SENT",expiresAt}},{status:201,headers:{"Cache-Control":"no-store"}});
 }catch(error){
  if(createdUserId){const admin=createAdminClient();await admin.auth.admin.deleteUser(createdUserId);}
  return failure(error);
 }
}
