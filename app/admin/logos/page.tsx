"use client";

import WorkspaceNav from "@/components/workspace-nav";


import ClientSessionGate from "@/components/client-session-gate";
import LogoManager from "./logo-manager";

export default function LogoManagerPage() {
  return <ClientSessionGate allowRoles={["SYSTEM_ADMIN"]}>
    {session => <><WorkspaceNav role={session.role} active="/admin/logos" /><LogoManager /></>}
  </ClientSessionGate>;
}
