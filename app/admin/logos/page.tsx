"use client";

import ClientSessionGate from "@/components/client-session-gate";
import LogoManager from "./logo-manager";

export default function LogoManagerPage() {
  return <ClientSessionGate allowRoles={["SYSTEM_ADMIN"]}>
    {() => <LogoManager />}
  </ClientSessionGate>;
}
