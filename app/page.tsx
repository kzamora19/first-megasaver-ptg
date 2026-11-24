"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import ClientSessionGate, { type PtgClientSession } from "@/components/client-session-gate";
import WorkspaceLoader from "@/components/workspace-loader";

function OpenWorkspace({ session }: { session: PtgClientSession }) {
  const router = useRouter();
  const destination = session.role === "SYSTEM_ADMIN" ? "/admin/accounts/" : "/products/";

  useEffect(() => {
    router.replace(destination);
  }, [destination, router]);

  return <WorkspaceLoader progress={100} />;
}

export default function Home() {
  return (
    <ClientSessionGate allowRoles={["SYSTEM_ADMIN", "BRANCH_ADMIN", "BRANCH_USER"]}>
      {session => <OpenWorkspace session={session} />}
    </ClientSessionGate>
  );
}
