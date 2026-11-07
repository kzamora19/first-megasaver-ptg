import "server-only";
import { randomBytes, createHash } from "node:crypto";

export function makeTemporaryPassword() {
  return randomBytes(24).toString("base64url");
}
export function makeInvitationToken() {
  const token=randomBytes(32).toString("base64url");
  return {token,hash:createHash("sha256").update(token).digest("hex")};
}
export async function sendAccountInvitation(input:{
  email:string;displayName:string;username:string;temporaryPassword:string;acceptUrl:string;
}) {
  const key=process.env.RESEND_API_KEY;
  const from=process.env.RESEND_FROM_EMAIL;
  if(!key||!from)throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]??c));
  const name=escape(input.displayName), user=escape(input.username), password=escape(input.temporaryPassword), link=escape(input.acceptUrl);
  const text=`Hello ${input.displayName},

Your First Megasaver PTG account has been created.

Username: ${input.username}
Temporary password: ${input.temporaryPassword}

First, accept your invitation: ${input.acceptUrl}

After accepting, sign in using your username and temporary password. You will be required to set a new password before accessing the application.

This invitation expires in 48 hours. If you were not expecting this email, contact your branch administrator.`;
  const response=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json","User-Agent":"First-Megasaver-PTG/1.0"},
    body:JSON.stringify({
      from,to:[input.email],subject:"Your First Megasaver PTG account invitation",
      text,
      html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033;line-height:1.6"><h2>Welcome to First Megasaver PTG</h2><p>Hello ${name}, your account has been created.</p><p><b>Username:</b> ${user}<br><b>Temporary password:</b> <code>${password}</code></p><p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#123c69;color:#fff;text-decoration:none;border-radius:6px">Accept invitation</a></p><p>After accepting, sign in with your username and temporary password. You must create a new password before accessing PTG.</p><p>This invitation expires in 48 hours. If you were not expecting it, contact your branch administrator.</p></div>`
    })
  });
  if(!response.ok)throw new Error("EMAIL_DELIVERY_FAILED");
  const result=await response.json() as {id?:string};
  if(!result.id)throw new Error("EMAIL_DELIVERY_FAILED");
  return result.id;
}
