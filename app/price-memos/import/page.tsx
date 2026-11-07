import { redirect } from "next/navigation";
import { getActiveAppSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import PriceMemoImporter from "./price-memo-importer";

export const dynamic = "force-dynamic";
export default async function PriceMemoImportPage() {
  const session = await getActiveAppSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  if (!["SYSTEM_ADMIN","BRANCH_ADMIN"].includes(session.role)) redirect("/no-access");
  const admin = createAdminClient();
  const {data:branches} = session.role === "SYSTEM_ADMIN"
    ? await admin.from("branches").select("id,branch_code,branch_name").eq("status","ACTIVE").order("branch_code")
    : {data:[]};
  return <main className="shell admin-shell">
    <a className="admin-back" href="/dashboard">← Back to PTG dashboard</a>
    <section className="hero admin-hero"><p className="eyebrow">PRICE MEMO MANAGEMENT</p><h1>Import Price Memo</h1>
      <p className="intro">Import Head Office price memos, review eligible items and keep memo records scoped to the selected branch.</p>
      <div className="status"><span className="status-dot"/>{session.role.replaceAll("_"," ")}</div>
    </section>
    <PriceMemoImporter branchOptions={(branches??[]).map(b=>({id:b.id,label:`${b.branch_code} — ${b.branch_name}`}))} fixedBranchId={session.role==="BRANCH_ADMIN"?session.branchId:null} />
  </main>;
}
