"use client";

import ClientSessionGate from "@/components/client-session-gate";
import SubdealerMemoImporter from "./subdealer-memo-importer";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

function SystemAdminSubdealerRedirect() {
  const router = useRouter();
  useEffect(() => {
    // The Data Desk tool stays on the already-authenticated Data Desk route.
    // This legacy URL remains supported for existing bookmarks and links.
    if (window.location.pathname.replace(/\/$/, "").endsWith("/price-memos/subdealer")) {
      router.replace("/data-desk/?mode=subdealer");
    }
  }, [router]);
  return <main className="shell"><p role="status">Opening Subdealer Memo Import in Data Desk…</p></main>;
}

export default function SubdealerMemoImportPage() {
  return <ClientSessionGate allowRoles={["SYSTEM_ADMIN", "BRANCH_ADMIN"]}>
    {session => session.role === "SYSTEM_ADMIN" ? <SystemAdminSubdealerRedirect /> : <main className="shell admin-shell">
      <Link href={"/price-memos/import/" + (session.role === "SYSTEM_ADMIN" ? "?workspace=data-desk" : "")} className="admin-link">← Head Office memo importer</Link>
      <section className="hero">
        <p className="eyebrow">PRICE MEMO MANAGEMENT</p>
        <h1>SUBDEALER MEMO IMPORTER</h1>
        <p className="intro">Import approved subdealer PDF price memos with a source review
          before applying prices to shared PTG data.</p>
        <div className="status"><span className="status-dot"/>{session.role.replaceAll("_", " ")}</div>
      </section>
      <SubdealerMemoImporter />
    </main>}
  </ClientSessionGate>;
}
