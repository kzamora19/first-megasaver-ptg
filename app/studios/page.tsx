"use client";

// Staged PTG launch portal. Access rights are checked by the PTG Edge Function,
// not by the client-side buttons. No tokens or app secrets are persisted here.
import {useEffect,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase/client";
import {getPtgAppSessionId, invokePtgAuth} from "@/lib/ptg/auth-client";

type Studio = "megaframe"|"flyer";
// Build-time URLs only. No guessed protected host or public-editor fallback.
function studioLaunchUrl(raw:string|undefined){
  if(!raw)return "";
  try {
    const target=new URL(raw);
    if(target.protocol!=="https:"||target.username||target.password||target.hash||target.search)
      return "";
    return target.href;
  } catch {return "";}
}
const destinations:Record<Studio,{name:string,url:string,summary:string}>={
  megaframe:{name:"MegaFrame Studio",url:studioLaunchUrl(process.env.NEXT_PUBLIC_STUDIO_MEGAFRAME_LAUNCH_URL),summary:"Photo framing, collages and personalized layouts"},
  flyer:{name:"MegaFlyer Studio",url:studioLaunchUrl(process.env.NEXT_PUBLIC_STUDIO_FLYER_LAUNCH_URL),summary:"Campaign artwork, product bundles and promotional flyers"},
};
function allowedRole(account:{role:string;legacyRole:string}|null){
  return !!account && (account.role==="SYSTEM_ADMIN"||account.role==="BRANCH_ADMIN"||
    (account.role==="BRANCH_USER"&&account.legacyRole.trim().toUpperCase()==="TEAM LEADER"));
}
export default function StudioLaunchPage(){
  const [checking,setChecking]=useState(true);
  const [account,setAccount]=useState<{role:string;legacyRole:string;displayName:string}|null>(null);
  const [busy,setBusy]=useState<Studio|null>(null);
  const [requestedStudio,setRequestedStudio]=useState<Studio|null>(null);
  const [message,setMessage]=useState("");
  useEffect(()=>{
    // Source app cards identify which Studio the user requested.
    // This is presentation context ONLY; it does not issue a ticket automatically.
    const requested=new URLSearchParams(window.location.search).get("studio");
    if(requested==="megaframe"||requested==="flyer")setRequestedStudio(requested);
  },[]);
  useEffect(()=>{
    let live=true;
    void invokePtgAuth("session").then(data=>{
      if(live&&data.account)setAccount({
        role:data.account.role,legacyRole:data.account.legacyRole,displayName:data.account.displayName,
      });
    }).catch(()=>{if(live)setMessage("Sign in to PTG to use the studios.");})
      .finally(()=>{if(live)setChecking(false);});
    return()=>{live=false;};
  },[]);
  async function launch(studio:Studio){
    setBusy(studio);setMessage("");
    try{
      if(!destinations[studio].url)throw Error("Secure Studio destination has not been configured.");
      // Reverify the existing PTG account immediately before issuing the ticket.
      const check=await invokePtgAuth("session");
      if(!check.account||!allowedRole(check.account))
        throw Error("PTG Team Leader or higher access is required.");
      const auth=await createClient().auth.getSession();
      const sessionId=getPtgAppSessionId();
      const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
      const publishable=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if(!auth.data.session?.access_token||!sessionId||!url||!publishable)
        throw Error("Your PTG session is unavailable. Sign in again.");
      const response=await fetch(url.replace(/\/$/,"")+"/functions/v1/ptg-studio-access",{
        method:"POST",cache:"no-store",
        headers:{"Content-Type":"application/json",apikey:publishable,
          Authorization:"Bearer "+auth.data.session.access_token,
          "x-ptg-session-id":sessionId},
        body:JSON.stringify({action:"issue",studio}),
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||payload.ok!==true||typeof payload.ticket!=="string")
        throw Error(payload.message||"Studio access denied.");
      // A location fragment is not sent in HTTP requests or Referer headers.
      // The Studio removes the fragment and exchanges this one-use bearer for a
      // P-256 browser-key-bound proof session; no reusable cookie is created.
      window.location.assign(destinations[studio].url+"#ptg_studio_ticket="+encodeURIComponent(payload.ticket));
    }catch(error){
      setMessage(error instanceof Error?error.message:"Could not open the studio.");
      setBusy(null);
    }
  }
  const eligible=allowedRole(account);
  return <main className="shell"><section className="hero">
    <h1>Creative Studios</h1>
    <p className="intro">Access requires an active PTG Team Leader, Branch Admin or System Admin account.</p>
    {requestedStudio&&<p role="status">Selected: <strong>{destinations[requestedStudio].name}</strong>. Use the button below to verify your PTG account and open the protected editor.</p>}
  </section>
  <section className="panel install-panel">
    {checking?<p role="status">Checking PTG authorization…</p>:
      !eligible?<p role="alert">Your current PTG account is not authorized for Creative Studios. <Link href="/login/">Return to PTG login</Link>.</p>:
      <>
        <p>Signed in as <strong>{account?.displayName||"PTG user"}</strong></p>
        <div style={{display:"grid",gap:16,gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))"}}>
          {(Object.keys(destinations) as Studio[]).map(studio=><div key={studio} className="panel" style={{padding:16,outline:requestedStudio===studio?"2px solid #355ee8":undefined}}>
            <h2>{destinations[studio].name}</h2><p>{destinations[studio].summary}</p>
            <button type="button" className="admin-button" disabled={busy!==null||!destinations[studio].url} onClick={()=>void launch(studio)}>
              {!destinations[studio].url?"Launch unavailable until secure hosting is configured":busy===studio?"Checking access…":"Open "+destinations[studio].name}
            </button>
          </div>)}
        </div>
      </>}
    {message&&<p role="alert">{message}</p>}
  </section></main>;
}
