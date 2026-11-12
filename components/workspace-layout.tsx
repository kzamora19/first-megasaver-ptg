"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import LogoutButton from "@/app/dashboard/logout-button";
import ClientSessionGate, { type PtgClientSession } from "@/components/client-session-gate";
import WorkspaceNav from "@/components/workspace-nav";
import { withBasePath } from "@/lib/base-path";
import { invokePtgAuth, usesEdgeAuth } from "@/lib/ptg/auth-client";

const workspacePaths = new Set(["/dashboard", "/products", "/price-memos/import", "/admin/accounts", "/admin/logos", "/product-master", "/data-desk"]);
const deskTools = new Set(["/price-memos/import", "/admin/logos", "/product-master"]);

function WorkspaceFrame({ session, path, children }: { session: PtgClientSession; path: string; children: ReactNode }) {
  const [openOnPath, setOpenOnPath] = useState<string | null>(null);
  const query = useSearchParams();
  const router = useRouter();
  const desk = path === "/data-desk" || (deskTools.has(path) && query.get("workspace") === "data-desk");
  const open = openOnPath === path;
  const home = session.role === "SYSTEM_ADMIN" ? "/admin/accounts/" : "/products/";
  const BrandLink = desk ? "a" : Link;

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

  return <div className="ptg-app">
    <aside className="ptg-sidebar ptg-print-hide" data-menu-open={open}>
      <div className="ptg-sidebar-header">
        <BrandLink className="ptg-brand" href={desk ? withBasePath("/data-desk/") : home} onClick={() => setOpenOnPath(null)} aria-label={desk ? "Data Desk home" : "Branchline Price Tag Generator home"}>
          <span className="ptg-brand-lockup">
            <img src={withBasePath("/branchline-logo.png")} alt="" />
            <small>{desk ? "DATA DESK" : "PRICE TAG GENERATOR"}</small>
          </span>
        </BrandLink>
        <button className="ptg-menu-toggle" type="button" aria-label={open ? "Close workspace menu" : "Open workspace menu"}
          aria-expanded={open} aria-controls="ptg-workspace-links" onClick={() => setOpenOnPath(open ? null : path)}>
          <span aria-hidden="true">☰</span>
        </button>
      </div>
      <div className="ptg-sidebar-content" id="ptg-workspace-links">
        <div className="ptg-sidebar-menu">
          <div className="ptg-nav-label">{desk ? "IMPORT TOOLS" : "WORKSPACE"}</div>
          <WorkspaceNav role={session.role} active={path} desk={desk} onNavigate={() => setOpenOnPath(null)} />
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
  </div>;
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const path = (usePathname() ?? "").replace(/\/$/, "");
  if (!workspacePaths.has(path)) return children;

  return <ClientSessionGate watchAvailability>
    {session => session.role === "SYSTEM_ADMIN"
      ? <Suspense fallback={null}><WorkspaceFrame session={session} path={path}>{children}</WorkspaceFrame></Suspense>
      : children}
  </ClientSessionGate>;
}
