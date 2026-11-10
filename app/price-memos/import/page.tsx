"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import ClientSessionGate from "@/components/client-session-gate";
import PriceMemoImporter from "./price-memo-importer";

function ImportBackLink({ systemAdmin }: { systemAdmin: boolean }) {
  const workspace = useSearchParams().get("workspace");
  const fromDataDesk = systemAdmin && workspace === "data-desk";
  return <Link className="admin-back" href={fromDataDesk ? "/data-desk/" : "/products/"}>
    <span aria-hidden="true">← </span>{fromDataDesk ? "Back to Data Desk" : "Back to Product Search"}
  </Link>;
}

export default function PriceMemoImportPage() {
  return <ClientSessionGate allowRoles={["SYSTEM_ADMIN", "BRANCH_ADMIN"]}>
    {session => <main className="shell admin-shell">
      <Suspense fallback={null}>
        <ImportBackLink systemAdmin={session.role === "SYSTEM_ADMIN"} />
      </Suspense>
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
