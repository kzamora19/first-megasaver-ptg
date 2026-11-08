"use client";

import ClientSessionGate from "@/components/client-session-gate";
import { withBasePath } from "@/lib/base-path";
import ProductMasterImporter from "./product-master-importer";

export default function ProductMasterPage() {
  return <ClientSessionGate allowRoles={["SYSTEM_ADMIN"]}>
    {() => <main className="shell admin-shell">
      <a className="admin-back" href={withBasePath("/dashboard")}>← Back to PTG dashboard</a>
      <section className="hero admin-hero">
        <p className="eyebrow">SYSTEM ADMINISTRATION</p>
        <h1>Product Master</h1>
        <p className="intro">Import the product reference file used to match memo items with their barcode and full description.</p>
      </section>
      <ProductMasterImporter />
    </main>}
  </ClientSessionGate>;
}
