import { redirect } from "next/navigation";
import { getActiveAppSession } from "@/lib/auth/session";
import PriceMemoImporter from "./price-memo-importer";

export const dynamic = "force-dynamic";
export default async function PriceMemoImportPage() {
  const session = await getActiveAppSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  if (!["SYSTEM_ADMIN","BRANCH_ADMIN"].includes(session.role)) redirect("/no-access");
  return <main className="shell admin-shell">
    <a className="admin-back" href="/dashboard">← Back to PTG dashboard</a>
    <section className="hero admin-hero"><p className="eyebrow">PRICE MEMO MANAGEMENT</p><h1>Import Price Memo</h1>
      <p className="intro">Import Head Office price memos once for all four branches. Memo products and the product master are shared across PTG.</p>
      <div className="status"><span className="status-dot"/>{session.role.replaceAll("_"," ")}</div>
    </section>
    <PriceMemoImporter />
  </main>;
}
