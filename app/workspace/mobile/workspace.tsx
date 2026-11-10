"use client";

import { useState } from "react";
import InstallApp from "@/components/install-app";
import { withBasePath } from "@/lib/base-path";
import "./workspace.css";

const apps = [
  { key: "sales", name: "Sales Tracker", src: "/branchline/" },
  { key: "ptg", name: "Price Tag Generator", src: withBasePath("/login/") },
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
      <nav aria-label="Workspace apps">
        {apps.map(app => <button key={app.key} type="button" aria-pressed={current === app.key}
          onClick={() => open(app.key)}>{app.name}</button>)}
      </nav>
    </header>
    <div className="mobile-workspace-content">
      {current === null && <section className="mobile-workspace-home">
        <h1>Your apps</h1>
        <p>Choose an app and sign in with the account assigned to you.</p>
        <InstallApp name="Branchline Workspace" />
      </section>}
      {apps.filter(app => opened.includes(app.key)).map(app => <iframe key={app.key} title={app.name}
        src={app.src} hidden={current !== app.key} allow="camera; clipboard-write; web-share" />)}
    </div>
  </main>;
}
