import Link from "next/link";
import { Suspense, Fragment } from "react";
import { useSearchParams } from "next/navigation";
import { getSecuritySection, securitySections } from "@/lib/ptg/security-sections";
import { withBasePath } from "@/lib/base-path";
import { deskSalesTools } from "@/lib/ptg/batch-import";

function SecurityLinks({ onNavigate }: { onNavigate: () => void }) {
  const selected = getSecuritySection(useSearchParams().get("section"));
  return <div className="ptg-security-nav" aria-label="System Security">
    {securitySections.map(([key, label]) => <Link key={key} href={"/admin/accounts/?section=" + key}
      onClick={onNavigate} className={"ptg-nav-item" + (key === selected ? " active" : "")}
      aria-current={key === selected ? "page" : undefined}>{label}</Link>)}
  </div>;
}

const deskPtgTools = [
  ["/price-memos/import", "Price Memo Import"],
  ["/product-master", "Product Master"],
  ["/admin/logos", "Logo Manager"],
];
export default function WorkspaceNav({ role, active, desk = false, onNavigate }: {
  role: string; active: string; desk?: boolean; onNavigate: () => void;
}) {
  const system = role === "SYSTEM_ADMIN";
  const query = useSearchParams();
  const onDesk = active === "/data-desk";
  const catalog = onDesk && query.get("mode") === "catalog";
  const salesTool = onDesk && !catalog ? deskSalesTools.find(tool => tool.id === query.get("tool")) : undefined;
  const unified = onDesk && !catalog && !salesTool;
  if (system && desk) return <nav aria-label="Data Desk import tools" data-branchline-import-menu>
    <a href={withBasePath("/data-desk/")} onClick={onNavigate}
      className={"ptg-nav-item" + (unified ? " active" : "")}
      aria-current={unified ? "page" : undefined}>Unified Import</a>
    <a href={withBasePath("/data-desk/?mode=catalog")} onClick={onNavigate}
      className={"ptg-nav-item" + (catalog ? " active" : "")}
      aria-current={catalog ? "page" : undefined}>Cross-App Catalog Review</a>
    {deskPtgTools.map(([path, label]) => <a key={path} href={withBasePath(path + "/") + "?workspace=data-desk"}
      onClick={onNavigate} className={"ptg-nav-item" + (active === path ? " active" : "")}
      aria-current={active === path ? "page" : undefined}>{label}</a>)}
    <div className="ptg-nav-label">SALES TRACKER</div>
    {deskSalesTools.map(tool => <a key={tool.id} href={withBasePath("/data-desk/?tool=" + tool.id)}
      onClick={onNavigate} className={"ptg-nav-item" + (tool === salesTool ? " active" : "")}
      aria-current={tool === salesTool ? "page" : undefined}>{tool.label}</a>)}
  </nav>;
  const admin = system || role === "BRANCH_ADMIN";
  const items = [
    ...(system ? [["/dashboard", "Dashboard"]] : []),
    ["/products", "Product Search & Queue"],
    ...(admin ? [["/price-memos/import", "Price Memo Import"], ["/admin/accounts", "Account Administration"]] : []),
    ...(system ? [["/admin/logos", "Logo Manager"], ["/product-master", "Product Master"]] : []),
  ];
  return <nav aria-label="Workspace">
    {items.map(([path, label]) => <Fragment key={path}><Link href={path + "/"} onClick={onNavigate}
      className={"ptg-nav-item" + (active === path ? " active" : "")}
      aria-current={active === path ? "page" : undefined}>{label}</Link>
      {system && active === path && path === "/admin/accounts" && <Suspense><SecurityLinks onNavigate={onNavigate} /></Suspense>}
    </Fragment>)}
    {system && <a href={withBasePath("/data-desk/")} data-branchline-catalog-review onClick={onNavigate}
      className={"ptg-nav-item" + (active === "/data-desk" ? " active" : "")}
      aria-current={active === "/data-desk" ? "page" : undefined}>Data Desk</a>}
  </nav>;
}
