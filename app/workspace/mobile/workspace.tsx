"use client";

import { useState } from "react";
import InstallApp from "@/components/install-app";
import WebRelease from "@/components/web-release";
import { withBasePath } from "@/lib/base-path";
import "./workspace.css";

const apps = [
  { key: "sales", name: "Sales Tracker", icon: "sales-tracker", summary: "Track sales and review performance", src: "/branchline/" },
  { key: "ptg", name: "Price Tag Generator", icon: "price-tag-generator", summary: "Find products and prepare price tags", src: withBasePath("/login/") },
  { key: "megaframe", name: "MegaFrame Studio", icon: "megaframe-studio", summary: "Photo frames and collages", src: withBasePath("/studios/?studio=megaframe") },
  { key: "flyer", name: "MegaFlyer Studio", icon: "flyer-studio", summary: "Promotional artwork and flyers", src: withBasePath("/studios/?studio=flyer") },
] as const;
type App = (typeof apps)[number]["key"];

// Only mark known same-origin application documents; never access the protected
// editor iframe, account data or credentials. Keep the original frames mounted.
function markEmbedded(frame: HTMLIFrameElement) {
  try {
    const url = new URL(frame.contentWindow!.location.href);
    const allowed = ["/branchline/", "/first-megasaver-ptg/", "/megaframe-studio/studio/", "/flyer-studio/studio/"];
    if (url.origin === window.location.origin && allowed.some(prefix => url.pathname.startsWith(prefix))) {
      frame.contentDocument?.documentElement.classList.add("bl-mobile-embedded");
    }
  } catch { /* isolated editor or external sign-in remains untouched */ }
}

export default function MobileWorkspace() {
  const [current, setCurrent] = useState<App | null>(null);
  const [opened, setOpened] = useState<App[]>([]);
  const [listOpen, setListOpen] = useState(false);

  function open(app: App) {
    setOpened(previous => previous.includes(app) ? previous : [...previous, app]);
    setCurrent(app);
    setListOpen(false);
  }
  const choices = apps.map(app => <button key={app.key} type="button" className="mobile-workspace-choice" onClick={() => open(app.key)} aria-current={current===app.key?"page":undefined}>
    <span className="mobile-workspace-choice-icon" aria-hidden="true"><span className={"ptg-official-app-icon "+app.icon}/></span>
    <span><strong>{app.name}</strong><small>{app.summary}</small></span><span aria-hidden="true">→</span>
  </button>);

  return <main className="mobile-workspace">
    {current === null && <WebRelease />}
    <header className="mobile-workspace-header">
      <button type="button" className="mobile-workspace-brand" onClick={() => setListOpen(value=>!value)} aria-label={listOpen?"Close application list":"Open application list"} aria-expanded={listOpen} aria-controls="mobile-app-list">
        <img src={withBasePath("/icons/official/branchline.png")} width="34" height="34" alt="" />
        <span>{apps.find(app=>app.key===current)?.name ?? "Branchline Workspace"}</span>
      </button>
    </header>
    <div className="mobile-workspace-content">
      {current === null && <section className="mobile-workspace-home">
        <h1>Your apps</h1><p>Choose an app and sign in with the account assigned to you.</p>
        <div className="mobile-workspace-choices">{choices}</div>
        <InstallApp name="Branchline Workspace" />
      </section>}
      {apps.filter(app => opened.includes(app.key)).map(app => <iframe key={app.key} title={app.name}
        src={app.src} hidden={current !== app.key} onLoad={event=>markEmbedded(event.currentTarget)} allow="camera; clipboard-write; web-share" />)}
      {listOpen && <div className="mobile-app-overlay" onClick={event=>{if(event.target===event.currentTarget)setListOpen(false);}}>
        <section id="mobile-app-list" className="mobile-app-list" aria-label="Branchline applications">
          <h2>Branchline applications</h2><div className="mobile-workspace-choices">{choices}</div>
        </section>
      </div>}
    </div>
  </main>;
}
