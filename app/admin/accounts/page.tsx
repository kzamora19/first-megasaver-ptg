"use client";

import WorkspaceNav from "@/components/workspace-nav";


import ClientSessionGate from "@/components/client-session-gate";
import AccountAdministration from "./account-administration";

export default function AdminAccountsPage() {
  return <ClientSessionGate allowRoles={["SYSTEM_ADMIN", "BRANCH_ADMIN"]} deniedTo="/dashboard">
    {session => <main className="shell admin-shell">
      <WorkspaceNav role={session.role} active="/admin/accounts" />
      <section className="hero admin-hero">
        <p className="eyebrow">FIRST MEGASAVER · SYSTEM SECURITY</p>
        <h1>Administration</h1>
        <p className="intro">Manage user accounts and active access within your authorized scope.</p>
        <div className="status"><span className="status-dot"/>{session.role.replaceAll("_", " ")}</div>
      </section>
      <AccountAdministration role={session.role}/>
    </main>}
  </ClientSessionGate>;
}
