"use client";
import { FormEvent,useState } from "react";
import { useRouter } from "next/navigation";
export default function ChangePasswordPage(){
 const router=useRouter();const [password,setPassword]=useState("");const [confirm,setConfirm]=useState("");const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;setBusy(true);setMessage("");
  try{const response=await fetch("/api/auth/change-password",{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({password,confirmPassword:confirm})});const result=await response.json();
   if(!response.ok||!result.ok){setMessage(result.message??"Unable to change password.");return;}
   setPassword("");setConfirm("");router.replace("/dashboard");router.refresh();
  }catch{setMessage("Unable to connect. Please try again.");}finally{setBusy(false);}
 }
 return <main className="auth-shell"><section className="auth-card"><div className="auth-brand">FIRST MEGASAVER</div><p className="auth-eyebrow">ACCOUNT SECURITY</p><h1>Change your password</h1><p className="auth-intro">Set a new password before continuing. Use at least 12 characters.</p><form className="auth-form" onSubmit={submit}><label htmlFor="new-password">NEW PASSWORD</label><input id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={password} onChange={e=>setPassword(e.target.value)} required/><label htmlFor="confirm-password">CONFIRM PASSWORD</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={confirm} onChange={e=>setConfirm(e.target.value)} required/><button type="submit" disabled={busy}>{busy?"UPDATING…":"UPDATE PASSWORD"}</button></form><p className="auth-message" role="status">{message}</p></section></main>;
}
