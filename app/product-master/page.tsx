import { redirect } from "next/navigation";
import { getActiveAppSession } from "@/lib/auth/session";
import ProductMasterImporter from "./product-master-importer";

export const dynamic = "force-dynamic";

export default async function ProductMasterPage() {
  const session = await getActiveAppSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  if (session.role !== "SYSTEM_ADMIN") redirect("/no-access");

  return (
    <main className="shell admin-shell">
      <a className="admin-back" href="/dashboard">← Back to PTG dashboard</a>
      <section className="hero admin-hero">
        <p className="eyebrow">SYSTEM ADMINISTRATION</p>
        <h1>Product Master</h1>
        <p className="intro">Import the product reference file used to match memo items with their barcode and full description.</p>
      </section>
      <ProductMasterImporter />
    </main>
  );
}
