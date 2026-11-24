"use client";
import { useEffect } from "react";
import release from "@/public/updates/release.json";
export default function WebRelease() {
  useEffect(()=>{
    if(window.location.origin!=="https://kzamora19.github.io")return;
    const base="/first-megasaver-ptg/updates/";
    const css=document.createElement("link");css.rel="stylesheet";css.href=base+"check.css?v="+release.sequence;
    const script=document.createElement("script");script.src=base+"check.js?v="+release.sequence;
    script.dataset.sequence=String(release.sequence);script.dataset.releaseLabel=release.label;
    document.head.append(css,script);
    return ()=>{script.remove();css.remove();window.dispatchEvent(new Event("branchline-ptg-release-unmount"));};
  },[]);
  return null;
}
