"use client";
import { useEffect } from "react";
import release from "@/public/updates/release.json";
import { invokePtgData, usesEdgeData } from "@/lib/ptg/edge-api";
type Notice={id:string;title:string;body:string};
type Updater={setAnnouncements:(scope:string,items:Notice[])=>void;clearAnnouncements:()=>void};
export default function WebRelease({memoAnnouncementsKey=""}:{memoAnnouncementsKey?:string}={}) {
  useEffect(()=>{
    if(window.location.origin!=="https://kzamora19.github.io")return;
    const root=window as Window & {BranchlineReleaseUpdates?:Updater};
    let active=true,busy=false;
    const refresh=async()=>{
      if(!active||busy||!memoAnnouncementsKey||!usesEdgeData||document.visibilityState!=="visible"||!root.BranchlineReleaseUpdates)return;
      busy=true;
      try{
        const data=await invokePtgData("ptg-widget-announcements",{});
        if(active&&Array.isArray(data.notices))root.BranchlineReleaseUpdates?.setAnnouncements("ptg:"+memoAnnouncementsKey,data.notices as Notice[]);
      }catch{if(active)root.BranchlineReleaseUpdates?.clearAnnouncements();}
      finally{busy=false;}
    };
    const base="/first-megasaver-ptg/updates/";
    const css=document.createElement("link");css.rel="stylesheet";css.href=base+"check.css?v="+release.sequence;
    const script=document.createElement("script");script.src=base+"check.js?v="+release.sequence;
    script.dataset.sequence=String(release.sequence);script.dataset.releaseLabel=release.label;
    window.addEventListener("branchline-release-updates-ready",refresh);
    window.addEventListener("online",refresh);
    window.addEventListener("branchline-memo-import-complete",refresh);
    document.addEventListener("visibilitychange",refresh);
    document.head.append(css,script);
    const timer=window.setInterval(refresh,120000);
    return ()=>{active=false;window.clearInterval(timer);window.removeEventListener("branchline-release-updates-ready",refresh);window.removeEventListener("online",refresh);window.removeEventListener("branchline-memo-import-complete",refresh);document.removeEventListener("visibilitychange",refresh);root.BranchlineReleaseUpdates?.clearAnnouncements();script.remove();css.remove();window.dispatchEvent(new Event("branchline-ptg-release-unmount"));};
  },[memoAnnouncementsKey]);
  return null;
}
