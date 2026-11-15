"use client";



import { Suspense } from "react";
import SecurityWorkspace from "./security-workspace";
import ClientSessionGate from "@/components/client-session-gate";
import AccountAdministration from "./account-administration";
import { withBasePath } from "@/lib/base-path";

export default function AdminAccountsPage() {
  return <ClientSessionGate allowRoles={["SYSTEM_ADMIN", "BRANCH_ADMIN"]} deniedTo="/products/">
    {session => session.role === "SYSTEM_ADMIN" ? <Suspense fallback={<p>Loading System Security…</p>}><SecurityWorkspace /></Suspense> : session.legacyRole.trim().toUpperCase() === "BRANCH MANAGER" ? <main className="shell admin-shell">
      <section className="hero admin-hero">
        <p className="eyebrow">FIRST MEGASAVER · SYSTEM SECURITY</p>
        <h1>Administration</h1>
        <p className="intro">Manage user accounts and active access within your authorized scope.</p>
        <div className="status"><span className="status-dot"/>{session.role.replaceAll("_", " ")}</div>
      </section>
      <AccountAdministration role={session.role}/>
    </main> : <main className="shell admin-shell"><section className="panel"><h1>Account administration unavailable</h1><p>Only the Branch Manager or System Administrator can manage accounts.</p><a href={withBasePath("/change-password/")}>Change my password</a></section></main>}
  </ClientSessionGate>;
}

