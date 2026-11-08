"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import LogoutButton from "@/app/dashboard/logout-button";
import ClientSessionGate, { type PtgClientSession } from "@/components/client-session-gate";
import WorkspaceNav from "@/components/workspace-nav";
import { withBasePath } from "@/lib/base-path";

const workspacePaths = new Set(["/dashboard", "/products", "/price-memos/import", "/admin/accounts", "/admin/logos", "/product-master"]);

function WorkspaceFrame({ session, path, children }: { session: PtgClientSession; path: string; children: ReactNode }) {
  const [openOnPath, setOpenOnPath] = useState<string | null>(null);
  const open = openOnPath === path;
  const home = session.role === "SYSTEM_ADMIN" ? "/dashboard/" : "/products/";

  return <div className="ptg-app">
    <aside className="ptg-sidebar ptg-print-hide" data-menu-open={open}>
      <div className="ptg-sidebar-header">
        <Link className="ptg-brand" href={home} onClick={() => setOpenOnPath(null)} aria-label="Branchline Price Tag Generator home">
          <span className="ptg-brand-lockup">
            <img src={withBasePath("/branchline-logo.png")} alt="" />
            <small>PRICE TAG GENERATOR</small>
          </span>
        </Link>
        <button className="ptg-menu-toggle" type="button" aria-label={open ? "Close workspace menu" : "Open workspace menu"}
          aria-expanded={open} aria-controls="ptg-workspace-links" onClick={() => setOpenOnPath(open ? null : path)}>
          <span aria-hidden="true">☰</span>
        </button>
      </div>
      <div className="ptg-sidebar-content" id="ptg-workspace-links">
        <div className="ptg-nav-label">WORKSPACE</div>
        <WorkspaceNav role={session.role} active={path} onNavigate={() => setOpenOnPath(null)} />
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

  return <ClientSessionGate>
    {session => session.role === "SYSTEM_ADMIN"
      ? <WorkspaceFrame session={session} path={path}>{children}</WorkspaceFrame>
      : children}
  </ClientSessionGate>;
}
