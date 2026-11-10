"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import ClientSessionGate from "@/components/client-session-gate";

function WorkspaceHome({ admin }: { admin: boolean }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(admin ? "/admin/accounts/" : "/products/");
  }, [admin, router]);
  return <p role="status">Opening PTG…</p>;
}

export default function DashboardPage() {
  return <ClientSessionGate>{session => <WorkspaceHome admin={session.role === "SYSTEM_ADMIN"} />}</ClientSessionGate>;
}
