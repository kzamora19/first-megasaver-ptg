"use client";

import { useState } from "react";
import InstallApp from "@/components/install-app";
import { withBasePath } from "@/lib/base-path";
import "./workspace.css";

// The four modules share one Workspace shell but retain their own Supabase projects.
// Studio URLs are PTG-gated portals, never raw/public editor HTML destinations.
const apps = [
  { key: "sales", name: "Sales Tracker", src: "/branchline/", details: "Track sales and performance", icon: "/branchline/icons/icon-192.png" },
  { key: "ptg", name: "Price Tag Generator", src: withBasePath("/login/"), details: "Find products and print price tags", icon: "" },
  { key: "megaframe", name: "MegaFrame Studio", src: withBasePath("/studios/?studio=megaframe"), details: "Social Media Photo Frame Generator · PTG TL+ only", icon: "/megaframe-studio/icons/icon-192.png" },
  { key: "flyer", name: "MegaFlyer Studio", src: withBasePath("/studios/?studio=flyer"), details: "Promotional Flyer & Sale Artwork Generator · PTG TL+ only", icon: "/flyer-studio/icons/flyer-studio-192.png" },
] as const;
type App = (typeof apps)[number]["key"];

export default function MobileWorkspace() {
  const [current, setCurrent] = useState<App | null>(null);
  const [opened, setOpened] = useState<App[]>([]);

  function open(app: App) {
    setOpened(previous => previous.includes(app) ? previous : [...previous, app]);
    setCurrent(app);
  }

  return <main className="mobile-workspace">
    <header className="mobile-workspace-header">
      <button type="button" className="mobile-workspace-brand" onClick={() => setCurrent(null)} aria-label="Branchline Workspace home">
        <img src="/branchline/icons/icon-192.png" width="28" height="28" alt="" />
        <span>Branchline Workspace</span>
      </button>
      {current !== null && <nav aria-label="Workspace apps">
        {apps.map(app => <button key={app.key} type="button" aria-pressed={current === app.key}
          onClick={() => open(app.key)}>{app.name}</button>)}
      </nav>}
    </header>
    <div className="mobile-workspace-content">
      {current === null && <section className="mobile-workspace-home">
        <h1>Branchline Applications</h1>
        <p>Four modules in one workspace. Sales Tracker and PTG retain their own accounts; both Creative Studios require an authorized PTG Team Leader or higher account.</p>
        <div className="mobile-workspace-choices">
          {apps.map(app => <button key={app.key} type="button" className="mobile-workspace-choice" onClick={() => open(app.key)}>
            <span className={`mobile-workspace-choice-icon ${app.key}`} aria-hidden="true">
              {app.icon ? <img src={app.icon} alt="" /> :
                <svg viewBox="0 0 48 48" fill="none"><path d="M8 10h17l15 15-15 15L8 23V10Z" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/><circle cx="17" cy="18" r="2.7" fill="currentColor"/><path d="M22 24l7 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>}
            </span>
            <span><strong>{app.name}</strong><small>{app.details}</small></span>
            <span aria-hidden="true">→</span>
          </button>)}
        </div>
        <InstallApp name="Branchline Workspace" />
      </section>}
      {apps.filter(app => opened.includes(app.key)).map(app => <iframe key={app.key} title={app.name}
        src={app.src} hidden={current !== app.key} allow="camera; clipboard-write; web-share" />)}
    </div>
  </main>;
}

