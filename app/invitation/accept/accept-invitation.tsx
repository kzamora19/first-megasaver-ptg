"use client";
import {useState} from "react";
import { requestPtgAccounts, usesEdgeAccounts } from "@/lib/ptg/accounts-client";
import { withBasePath } from "@/lib/base-path";
export default function AcceptInvitation({token}:{token:string}){
 const [busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState("");
 async function accept(){setBusy(true);setError("");try{const r=usesEdgeAccounts?await requestPtgAccounts("POST",{action:"acceptInvitation",token}):await fetch("/api/invitations/accept",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.message||"Unable to accept invitation.");setDone(true);}catch(e){setError(e instanceof Error?e.message:"Unable to accept invitation.");}finally{setBusy(false);}}
 return <main className="shell"><section className="hero"><p className="eyebrow">FIRST MEGASAVER · ACCOUNT ACTIVATION</p><h1>Accept your invitation</h1><p className="intro">Accepting confirms that you received the invitation at your registered email address.</p></section><section className="panel">{done?<><h2>Invitation accepted</h2><p>Open Branchline Workspace, choose Price Tag Generator, and sign in with the credentials in your invitation email.</p><a className="admin-link" href={withBasePath("/workspace/")}>Get Branchline Workspace →</a></>:<><h2>Confirm account invitation</h2><p>For your security, this link is used only after you confirm below. The invitation expires after 48 hours and can be used once.</p>{error&&<p className="admin-alert error" role="alert">{error}</p>}<button className="admin-button" disabled={busy||!token} onClick={()=>void accept()}>{busy?"Accepting…":"Accept invitation"}</button></>}</section></main>;
}
