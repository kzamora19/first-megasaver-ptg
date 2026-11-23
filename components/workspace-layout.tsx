"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import LogoutButton from "@/app/dashboard/logout-button";
import ClientSessionGate, { type PtgClientSession } from "@/components/client-session-gate";
import WorkspaceNav from "@/components/workspace-nav";
import { withBasePath } from "@/lib/base-path";
import { invokePtgAuth, usesEdgeAuth } from "@/lib/ptg/auth-client";

const workspacePaths = new Set(["/dashboard", "/products", "/price-memos/import", "/price-memos/subdealer", "/admin/accounts", "/admin/logos", "/product-master", "/data-desk", "/studios"]);
const deskTools = new Set(["/price-memos/import", "/price-memos/subdealer", "/admin/logos", "/product-master"]);

function WorkspaceFrame({ session, path, children }: { session: PtgClientSession; path: string; children: ReactNode }) {
  const [openOnPath, setOpenOnPath] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const query = useSearchParams();
  const router = useRouter();
  const desk = path === "/data-desk" || (deskTools.has(path) && query.get("workspace") === "data-desk");
  const open = openOnPath === path;
  const home = session.role === "SYSTEM_ADMIN" ? "/admin/accounts/" : "/products/";
  const BrandLink = desk ? "a" : Link;
  const activeApp = desk ? "data-desk" : "price-tag-generator";
  const apps = [
    {id:"price-tag-generator",name:"Price Tag Generator",label:"PTG",href:withBasePath("/products/")},
    {id:"sales-tracker",name:"Sales Tracker",label:"Sales",href:"/branchline/"},
    ...(session.role === "SYSTEM_ADMIN" ? [{id:"data-desk",name:"Data Desk",label:"Data",href:withBasePath("/data-desk/")}] : []),
    {id:"megaframe-studio",name:"MegaFrame Studio",label:"Frame",href:withBasePath("/studios/?studio=megaframe")},
    {id:"flyer-studio",name:"MegaFlyer Studio",label:"Flyer",href:withBasePath("/studios/?studio=flyer")}
  ];
  const toggleAppMenu = () => {setOpenOnPath(null);setAppMenuOpen(value=>!value);};
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{if(event.key!=="Escape")return;if(appMenuOpen){event.preventDefault();setAppMenuOpen(false);}else if(openOnPath===path){event.preventDefault();setOpenOnPath(null);}};
    document.addEventListener("keydown",key);
    return ()=>document.removeEventListener("keydown",key);
  },[appMenuOpen,openOnPath,path]);

  useEffect(() => {
    if (!desk || !usesEdgeAuth) return;
    let active = true;
    async function verify() {
      try { await invokePtgAuth("session-status"); }
      catch (error) {
        if (active && typeof error === "object" && error !== null && "status" in error && error.status === 401) {
          router.replace("/login/");
        }
      }
    }
    const timer = window.setInterval(() => void verify(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [desk, router]);

  return <div className="ptg-unified-host">
    <nav className="ptg-universal-app-rail ptg-print-hide" aria-label="Branchline applications">
      <button type="button" className="ptg-official-brand-logo" aria-label={appMenuOpen?"Close application list":"Open application list"}
        aria-expanded={appMenuOpen} aria-controls="ptg-universal-app-drawer" onClick={toggleAppMenu} title="Branchline applications">
        <img src={withBasePath("/icons/official/branchline.png")} alt="" aria-hidden="true"/>
      </button>
      {apps.map(app=><a key={app.id} href={app.href} className={"ptg-official-app-choice "+app.id+(app.id===activeApp?" is-active":"")}
        aria-label={"Open "+app.name} aria-current={app.id===activeApp?"page":undefined} title={app.name} onClick={()=>setAppMenuOpen(false)}>
        <span className={"ptg-official-app-icon "+app.id} aria-hidden="true"/><span>{app.label}</span>
      </a>)}
    </nav>
    <div className="ptg-app">
    <aside className={"ptg-sidebar ptg-print-hide" + (railCollapsed && !desk ? " ptg-sidebar-compact" : "")} data-menu-open={open}>
      <div className="ptg-sidebar-header">
        <button type="button" className="ptg-official-mobile-logo" aria-label={appMenuOpen?"Close application list":"Open application list"}
          aria-expanded={appMenuOpen} aria-controls="ptg-universal-app-drawer" onClick={toggleAppMenu}>
          <img src={withBasePath("/icons/official/branchline.png")} alt="" aria-hidden="true"/>
        </button>
        <BrandLink className="ptg-brand" href={desk ? withBasePath("/data-desk/") : home} onClick={() => setOpenOnPath(null)} aria-label={desk ? "Data Desk home" : "Branchline Price Tag Generator home"}>
          <span className="ptg-brand-lockup">
            <img className="ptg-brand-wide-logo" src={withBasePath("/branchline-logo.png")} alt="" />
            <img className="ptg-brand-mini-logo" src={withBasePath("/icons/ptg-icon.svg")} alt="" />
            <small>{desk ? "DATA DESK" : "PRICE TAG GENERATOR"}</small>
          </span>
        </BrandLink>
        <button className="ptg-menu-toggle" type="button" aria-label={open ? "Close workspace menu" : "Open workspace menu"}
          aria-expanded={open} aria-controls="ptg-workspace-links" onClick={() => {setAppMenuOpen(false);setOpenOnPath(open ? null : path);}}>
          <span aria-hidden="true">☰</span>
        </button>
      </div>
      {!desk && <button className="ptg-desktop-collapse" type="button"
        aria-label={railCollapsed ? "Expand workspace sidebar" : "Collapse workspace sidebar"}
        aria-expanded={!railCollapsed} aria-controls="ptg-workspace-links"
        title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={() => setRailCollapsed(value => !value)}><span aria-hidden="true">{railCollapsed ? "»" : "«"}</span><span className="ptg-collapse-label">{railCollapsed ? "Expand" : "Collapse"}</span></button>}
      <div className="ptg-sidebar-content" id="ptg-workspace-links">
        <div className="ptg-sidebar-menu">
          <div className="ptg-nav-label">{desk ? "IMPORT TOOLS" : "WORKSPACE"}</div>
          <WorkspaceNav role={session.role} legacyRole={session.legacyRole} active={path} desk={desk} onNavigate={() => setOpenOnPath(null)} />
        </div>
        <div className="ptg-sidebar-bottom">
          <div className="ptg-user-chip">
            <span className="ptg-avatar">{session.username.slice(0, 1).toUpperCase()}</span>
            <span><strong>{session.username}</strong><small>{session.role.replaceAll("_", " ")}</small></span>
          </div>
          <LogoutButton />
        </div>
      </div>
    </aside>
    <div className="ptg-workspace-content">{children}</div>
    </div>
    <div id="ptg-universal-app-drawer" className="ptg-universal-drawer-backdrop ptg-print-hide" hidden={!appMenuOpen}
      onClick={event=>{if(event.target===event.currentTarget)setAppMenuOpen(false);}}>
      <aside className="ptg-universal-drawer" aria-label="Branchline application list">
        <h2>Branchline applications</h2>
        <nav aria-label="Choose an application">
          {apps.map(app=><a key={app.id} href={app.href} className={"ptg-universal-drawer-link "+(app.id===activeApp?"is-active":"")}
            aria-current={app.id===activeApp?"page":undefined} onClick={()=>setAppMenuOpen(false)}>
            <span className={"ptg-official-app-icon "+app.id} aria-hidden="true"/>{app.name}
          </a>)}
        </nav>
      </aside>
    </div>
  </div>;
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const path = (usePathname() ?? "").replace(/\/$/, "");
  if (!workspacePaths.has(path)) return children;

  return <ClientSessionGate watchAvailability>
    {session => <Suspense fallback={null}><WorkspaceFrame session={session} path={path}>{children}</WorkspaceFrame></Suspense>}
  </ClientSessionGate>;
}
