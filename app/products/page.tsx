import { redirect } from "next/navigation";
import { getActiveAppSession } from "@/lib/auth/session";
import ProductSearch from "./product-search";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const session = await getActiveAppSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  const allowed = ["SYSTEM_ADMIN", "BRANCH_ADMIN"].includes(session.role) ||
    (session.role === "BRANCH_USER" && session.legacyRole.trim().toUpperCase() === "TEAM LEADER");
  if (!allowed) redirect("/no-access");
  return <ProductSearch branchCode={session.branchCode ?? "ALL BRANCHES"} />;
}
