"use client";

import WorkspaceNav from "@/components/workspace-nav";


import ClientSessionGate from "@/components/client-session-gate";
import PriceMemoImporter from "./price-memo-importer";

export default function PriceMemoImportPage() {
  return <ClientSessionGate allowRoles={["SYSTEM_ADMIN", "BRANCH_ADMIN"]}>
    {session => <main className="shell admin-shell">
      <WorkspaceNav role={session.role} active="/price-memos/import" />
      <section className="hero admin-hero">
        <p className="eyebrow">PRICE MEMO MANAGEMENT</p>
        <h1>Import Price Memo</h1>
        <p className="intro">Import Head Office price memos once for all four branches. Memo products and the product master are shared across PTG.</p>
        <div className="status"><span className="status-dot"/>{session.role.replaceAll("_", " ")}</div>
      </section>
      <PriceMemoImporter />
    </main>}
  </ClientSessionGate>;
}
