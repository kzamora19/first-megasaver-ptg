import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { withBasePath } from "@/lib/base-path";
import { deskSalesTools } from "@/lib/ptg/batch-import";

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
  const srp = onDesk && query.get("mode") === "srp";
  const promotionPdf = onDesk && query.get("mode") === "promotion-pdf";
  const subdealerPdf = onDesk && query.get("mode") === "subdealer";
  const unifiedInvites = onDesk && ["invitations", "invitation-drafts"].includes(query.get("mode") ?? "");
  const salesTool = onDesk && !catalog && !srp && !promotionPdf && !subdealerPdf && !unifiedInvites ? deskSalesTools.find(tool => tool.id === query.get("tool")) : undefined;
  const unified = onDesk && !catalog && !srp && !promotionPdf && !subdealerPdf && !unifiedInvites && !salesTool;
  if (system && desk) return <nav aria-label="Data Desk import tools" data-branchline-import-menu>
    <Link href="/admin/accounts/" onClick={onNavigate} className="ptg-nav-item">← Back to PTG</Link>
    <a href={withBasePath("/data-desk/")} onClick={onNavigate}
      className={"ptg-nav-item" + (unified ? " active" : "")}
      aria-current={unified ? "page" : undefined}>Unified Import</a>
    <a href={withBasePath("/data-desk/?mode=promotion-pdf")} onClick={onNavigate}
      className={"ptg-nav-item" + (promotionPdf ? " active" : "")}
      aria-current={promotionPdf ? "page" : undefined}>Promotion PDF Import</a>
    <Link href="/data-desk/?mode=subdealer" onClick={onNavigate}
      className={"ptg-nav-item" + (subdealerPdf ? " active" : "")}
      aria-current={subdealerPdf ? "page" : undefined}>Subdealer Memo Import</Link>
    <Link href="/data-desk/?mode=invitations" onClick={onNavigate}
      className={"ptg-nav-item" + (unifiedInvites ? " active" : "")}
      aria-current={unifiedInvites ? "page" : undefined}>User Administration</Link>
    <a href={withBasePath("/data-desk/?mode=catalog")} onClick={onNavigate}
      className={"ptg-nav-item" + (catalog ? " active" : "")}
      aria-current={catalog ? "page" : undefined}>Cross-App Catalog Review</a>
    {deskPtgTools.map(([path, label]) => <Link key={path} href={path + "/?workspace=data-desk"}
      onClick={onNavigate} className={"ptg-nav-item" + (active === path ? " active" : "")}
      aria-current={active === path ? "page" : undefined}>{label}</Link>)}
    <a href={withBasePath("/data-desk/?mode=srp")} onClick={onNavigate}
      className={"ptg-nav-item" + (srp ? " active" : "")}
      aria-current={srp ? "page" : undefined}>Product SRP Import</a>
    <div className="ptg-nav-label">SALES TRACKER</div>
    {deskSalesTools.map(tool => <a key={tool.id} href={withBasePath("/data-desk/?tool=" + tool.id)}
      onClick={onNavigate} className={"ptg-nav-item" + (tool === salesTool ? " active" : "")}
      aria-current={tool === salesTool ? "page" : undefined}>{tool.label}</a>)}
  </nav>;
  const admin = system || role === "BRANCH_ADMIN";
  const items = [
    ["/products", "Product Search & Queue"],
    ...(admin ? [["/admin/accounts", "Account Administration"]] : []),
    ...(system ? [["/data-desk", "Data Desk"]] : []),
  ];
  return <nav aria-label="Workspace">
    {items.map(([path, label]) => <Link key={path} href={path + "/"} onClick={onNavigate} title={label} aria-label={label}
      className={"ptg-nav-item" + (active === path ? " active" : "")}
      aria-current={active === path ? "page" : undefined}>
        <span className="ptg-nav-icon" aria-hidden="true">{path === "/products" ? "⌕" : "⚙"}</span>
        <span className="ptg-nav-text">{label}</span>
      </Link>)}
    {system && <a hidden href={withBasePath("/data-desk/")} data-branchline-catalog-review>Data Desk</a>}
  </nav>;
}


