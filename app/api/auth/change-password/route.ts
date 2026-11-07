import { NextResponse } from "next/server";
import { getActiveAppSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
 if(request.headers.get("origin")!==new URL(request.url).origin)return NextResponse.json({ok:false},{status:403});
 const session=await getActiveAppSession();
 if(!session)return NextResponse.json({ok:false},{status:401});
 let body:{password?:string;confirmPassword?:string};
 try{body=await request.json();}catch{return NextResponse.json({ok:false,message:"Invalid request."},{status:400});}
 const password=String(body.password??""),confirm=String(body.confirmPassword??"");
 if(password.length<12||password.length>1024)return NextResponse.json({ok:false,message:"Password must be at least 12 characters."},{status:400});
 if(password!==confirm)return NextResponse.json({ok:false,message:"Passwords do not match."},{status:400});
 const supabase=await createClient();
 const {error}=await supabase.auth.updateUser({password});
 if(error)return NextResponse.json({ok:false,message:"Unable to update password."},{status:400});
 const admin=createAdminClient();
 const {error:profileError}=await admin.from("user_profiles").update({must_change_password:false,invitation_status:"ACTIVATED",activated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",session.userId);
 if(profileError)return NextResponse.json({ok:false,message:"Password changed, but account setup could not be finalized. Contact your System Admin."},{status:503});
 await admin.from("security_audit_logs").insert({actor_user_id:session.userId,branch_id:session.branchId,event_category:"ACCOUNT_SECURITY",action:"CHANGE_INITIAL_PASSWORD",target_identifier:session.username,outcome:"SUCCESS",message:"User completed required initial password change."});
 return NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store"}});
}
