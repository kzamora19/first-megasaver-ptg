"use client";

import ClientSessionGate from "@/components/client-session-gate";
import LogoutButton from "./logout-button";

type ModuleCard = {
  title: string;
  description: string;
  href?: string;
  action: string;
  available: boolean;
  eyebrow: string;
};

function DashboardContent({session}:{session:import("@/components/client-session-gate").PtgClientSession}) {
  const isSystemAdmin = session.role === "SYSTEM_ADMIN";
  const canManageMemos = ["SYSTEM_ADMIN", "BRANCH_ADMIN"].includes(session.role);
  const canUsePTG = canManageMemos || session.role === "BRANCH_USER";
  const modules: ModuleCard[] = [
    {
      title: "Price Memo Import",
      description: "Import multiple Head Office memo files, review detected memo types, and manage branch price references.",
      href: canManageMemos ? "/price-memos/import" : undefined,
      action: canManageMemos ? "Open importer" : "Admin access required",
      available: canManageMemos,
      eyebrow: "PRICE DATA",
    },
    {
      title: "Product Master",
      description: "Maintain the product identity reference used to match barcode, model, brand, and description.",
      href: isSystemAdmin ? "/product-master" : undefined,
      action: isSystemAdmin ? "Open product master" : "System Admin only",
      available: isSystemAdmin,
      eyebrow: "PRODUCT DATABASE",
    },
    {
      title: "Product Search & Tag Queue",
      description: "Search shared price references and select products for the print workflow.",
      href: canUsePTG ? "/products" : undefined,
      action: canUsePTG ? "Open product search" : "PTG access required",
      available: canUsePTG,
      eyebrow: "WORKFLOW",
    },
    {
      title: "Price Tag Designer",
      description: "Prepare the remaining tag formats, installment details, validity dates, and promotional artwork.",
      action: "In development",
      available: false,
      eyebrow: "TAG DESIGN",
    },
    {
      title: "Print Preview & PDF",
      description: "Open the first 1 WHOLE print preview from the selected product queue.",
      href: canUsePTG ? "/products" : undefined,
      action: canUsePTG ? "Open print workflow" : "PTG access required",
      available: canUsePTG,
      eyebrow: "OUTPUT",
    },
    {
      title: "Logo & Promotion Manager",
      description: "Manage the interface header, price tag header and footer, and promotional artwork.",
      href: isSystemAdmin ? "/admin/logos" : undefined,
      action: isSystemAdmin ? "Manage logos" : "System Admin only",
      available: isSystemAdmin,
      eyebrow: "ASSETS",
    },
  ];

  return (
    <main className="ptg-app">
      <aside className="ptg-sidebar">
        <a className="ptg-brand" href="/dashboard" aria-label="Branchline Price Tag Generator home">
          <span className="ptg-brand-lockup">
            <img src="/branchline-logo.png" alt="" />
            <small>PRICE TAG GENERATOR</small>
          </span>
        </a>
        <div className="ptg-nav-label">WORKSPACE</div>
        <a className="ptg-nav-item active" href="/dashboard"><span>▦</span> Dashboard</a>
        {canManageMemos && <a className="ptg-nav-item" href="/price-memos/import"><span>▤</span> Price Memo Import</a>}
        {canUsePTG && <a className="ptg-nav-item" href="/products"><span>⌕</span> Product Search &amp; Queue</a>}
        {isSystemAdmin && <a className="ptg-nav-item" href="/admin/logos"><span>✧</span> Logo Manager</a>}
        {isSystemAdmin && <a className="ptg-nav-item" href="/product-master"><span>▧</span> Product Master</a>}
        {canManageMemos && <a className="ptg-nav-item" href="/admin/accounts"><span>♙</span> Account Administration</a>}
        <div className="ptg-sidebar-bottom">
          <div className="ptg-user-chip">
            <span className="ptg-avatar">{session.username.slice(0, 1).toUpperCase()}</span>
            <span><strong>{session.username}</strong><small>{session.role.replaceAll("_", " ")}</small></span>
          </div>
          <LogoutButton />
        </div>
      </aside>

      <section className="ptg-main">
        <header className="ptg-topbar">
          <div><span className="ptg-breadcrumb">FIRST MEGASAVER / WORKSPACE</span><h1>Dashboard</h1></div>
          <div className="ptg-session"><span className="ptg-online-dot" /> Session active <span className="ptg-session-divider" /> {session.branchCode ?? "SYSTEM"}</div>
        </header>

        <section className="ptg-welcome">
          <div>
            <p className="ptg-kicker">PRICE TAG WORKSPACE</p>
            <h2>Welcome back, {session.username}.</h2>
            <p>Your workspace for price references, product selection, tag preparation, and print output.</p>
          </div>
          <div className="ptg-welcome-art" aria-hidden="true"><span>₱</span><i>PRICE<br />READY</i></div>
        </section>

        <section className="ptg-section-heading">
          <div><h2>Application modules</h2><p>Use the available tools below. Modules are being delivered in stages.</p></div>
          <span className="ptg-branch-pill">{session.branchCode ?? "SYSTEM"} · {session.role.replaceAll("_", " ")}</span>
        </section>

        <div className="ptg-module-grid">
          {modules.map((module, index) => (
            <article className={`ptg-module-card ${module.available ? "is-ready" : "is-building"}`} key={module.title}>
              <div className="ptg-module-top"><span className="ptg-module-icon">{["₱", "▧", "⌕", "▤", "▣", "✧"][index]}</span><span className={module.available ? "ptg-module-state ready" : "ptg-module-state"}>{module.available ? "AVAILABLE" : "COMING NEXT"}</span></div>
              <p className="ptg-module-eyebrow">{module.eyebrow}</p>
              <h3>{module.title}</h3>
              <p className="ptg-module-description">{module.description}</p>
              {module.href ? <a className="ptg-module-link" href={module.href}>{module.action} <span>→</span></a> : <span className="ptg-module-disabled">{module.action}</span>}
            </article>
          ))}
        </div>

        <footer className="ptg-footer"><span>FIRST MEGASAVER · PRICE TAG GENERATOR</span><span>Development environment · Production Apps Script remains unchanged</span></footer>
      </section>
    </main>
  );
}

export default function DashboardPage() {
  return <ClientSessionGate>{session => <DashboardContent session={session} />}</ClientSessionGate>;
}
