import { redirect } from "next/navigation";
import { getActiveAppSession } from "@/lib/auth/session";
import ProductSearch from "./product-search";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const session = await getActiveAppSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  const allowed = ["SYSTEM_ADMIN", "BRANCH_ADMIN", "BRANCH_USER"].includes(session.role);
  if (!allowed) redirect("/no-access");
  return <ProductSearch branchCode={session.branchCode ?? "ALL BRANCHES"} username={session.username} legacyRole={session.legacyRole} systemRole={session.role} />;
}
