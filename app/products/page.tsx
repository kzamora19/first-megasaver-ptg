"use client";

import ClientSessionGate from "@/components/client-session-gate";
import ProductSearch from "./product-search";

export default function ProductsPage() {
  return <ClientSessionGate allowRoles={["SYSTEM_ADMIN", "BRANCH_ADMIN", "BRANCH_USER"]}>
    {session => <ProductSearch
      branchCode={session.branchCode ?? ""}
      branchName={session.branchName ?? ""}
      username={session.username}
      legacyRole={session.legacyRole}
      systemRole={session.role}
    />}
  </ClientSessionGate>;
}
