"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import LogoutButton from "@/app/dashboard/logout-button";
import ClientSessionGate, { type PtgClientSession } from "@/components/client-session-gate";
import WorkspaceNav from "@/components/workspace-nav";
import WebRelease from "@/components/web-release";
import { withBasePath } from "@/lib/base-path";
import { invokePtgAuth, usesEdgeAuth } from "@/lib/ptg/auth-client";

const workspacePaths = new Set(["/dashboard", "/products", "/price-memos/import", "/price-memos/subdealer", "/admin/accounts", "/admin/logos", "/product-master", "/data-desk", "/studios"]);
const deskTools = new Set(["/price-memos/import", "/price-memos/subdealer", "/admin/logos", "/product-master"]);

function WorkspaceFrame({ session, path, children }: { session: PtgClientSession; path: string; children: ReactNode }) {
  const [openOnPath, setOpenOnPath] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [desktopMode, setDesktopMode] = useState(false);
  const [browserShell,setBrowserShell]=useState(false);
  const query = useSearchParams();
  const router = useRouter();
  const desk = path === "/data-desk" || (deskTools.has(path) && query.get("workspace") === "data-desk");
  const open = openOnPath === path;
  const home = session.role === "SYSTEM_ADMIN" ? "/admin/accounts/" : "/products/";
  const BrandLink = desk ? "a" : Link;
  // Data Desk is a PTG workspace tool, not a fifth Branchline application.
  const activeApp = path === "/studios" && query.get("studio")==="megaframe" ? "megaframe-studio" : path === "/studios" && query.get("studio")==="flyer" ? "flyer-studio" : "price-tag-generator";
  const apps = [
    {id:"price-tag-generator",name:"Price Tag Generator",label:"PTG",href:withBasePath("/products/")},
    {id:"sales-tracker",name:"Sales Tracker",label:"Sales",href:"/branchline/"},
    {id:"megaframe-studio",name:"MegaFrame Studio",label:"Frame",href:withBasePath("/studios/?studio=megaframe")},
    {id:"flyer-studio",name:"MegaFlyer Studio",label:"Flyer",href:withBasePath("/studios/?studio=flyer")}
  ];
  const toggleAppMenu = () => {setOpenOnPath(null);setAppMenuOpen(value=>!value);};
  useEffect(() => {
    const native=!!(window as Window & {chrome?:{webview?:unknown}}).chrome?.webview;
    setBrowserShell(!native);
    const query = window.matchMedia("(min-width: 721px)");
    const update = () => setDesktopMode(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
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

  return <div className={"ptg-unified-host"+(browserShell?" ptg-web-r6":"")}>
    <WebRelease />
    <nav className="ptg-universal-app-rail ptg-print-hide" aria-label="Branchline applications">
      <button type="button" className="ptg-official-brand-logo" aria-label={appMenuOpen?"Close application list":"Open application list"}
        aria-expanded={appMenuOpen} aria-controls="ptg-universal-app-drawer" onClick={toggleAppMenu} title="Branchline applications">
        <img src={withBasePath(browserShell ? "/icons/r6/Approved.branchline.png" : "/icons/official/branchline.png")} alt="" aria-hidden="true"/>
      </button>
      <img className="ptg-r6-branchline-wordart" src={withBasePath("/icons/r6/BranchlineWordartFull.png")} alt="Branchline"/>
      <img className="ptg-r6-megasaver" src={withBasePath("/icons/r6/FirstMegasaverHeader.png")} alt="1st Megasaver"/>
      {apps.map(app=><a key={app.id} href={app.href} className={"ptg-official-app-choice "+app.id+(app.id===activeApp?" is-active":"")}
        aria-label={"Open "+app.name} aria-current={app.id===activeApp?"page":undefined} title={app.name} onClick={()=>setAppMenuOpen(false)}>
        <span className={"ptg-official-app-icon "+app.id} aria-hidden="true"/><span>{app.label}</span>
      </a>)}
      <details className="ptg-r6-account"><summary><strong>{session.username}</strong><small>{session.legacyRole || session.role.replaceAll("_"," ")}</small></summary><div className="ptg-r6-account-menu"><LogoutButton /></div></details>
    </nav>
    <div className={"ptg-app" + (railCollapsed ? " ptg-workspace-collapsed" : "")}>
    <aside className={"ptg-sidebar ptg-print-hide" + (railCollapsed && !desk ? " ptg-sidebar-compact" : "")} data-menu-open={open}>
      <div className="ptg-sidebar-header">
        <button type="button" className="ptg-official-mobile-logo" aria-label={appMenuOpen?"Close application list":"Open application list"}
          aria-expanded={appMenuOpen} aria-controls="ptg-universal-app-drawer" onClick={toggleAppMenu}>
          <img src={withBasePath(browserShell ? "/icons/r6/Approved.branchline.png" : "/icons/official/branchline.png")} alt="" aria-hidden="true"/>
        </button>
        <BrandLink className="ptg-brand" href={desk ? withBasePath("/data-desk/") : home} onClick={() => setOpenOnPath(null)} aria-label={desk ? "Data Desk home" : "Branchline Price Tag Generator home"}>
          <span className="ptg-brand-lockup">
            <img className="ptg-brand-wide-logo" src={withBasePath("/branchline-logo.png")} alt="" />
            <img className="ptg-brand-mini-logo" src={withBasePath("/icons/ptg-icon.svg")} alt="" />
            <small>{desk ? "DATA DESK" : activeApp==="megaframe-studio" ? "MEGAFRAME STUDIO" : activeApp==="flyer-studio" ? "MEGAFLYER STUDIO" : "PRICE TAG GENERATOR"}</small>
          </span>
        </BrandLink>
        <button className="ptg-menu-toggle" type="button"
          aria-label={(desktopMode ? !railCollapsed : open) ? "Close workspace menu" : "Open workspace menu"}
          aria-expanded={desktopMode ? !railCollapsed : open} aria-controls="ptg-workspace-links"
          onClick={() => {
            setAppMenuOpen(false);
            if (desktopMode) setRailCollapsed(value => !value);
            else setOpenOnPath(open ? null : path);
          }}>
          <span aria-hidden="true">☰</span>
        </button>
      </div>
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
