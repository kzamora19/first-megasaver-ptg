import Link from "next/link";

export default function WorkspaceNav({ role, active, onNavigate }: { role: string; active: string; onNavigate: () => void }) {
  const system = role === "SYSTEM_ADMIN";
  const admin = system || role === "BRANCH_ADMIN";
  const items = [
    ...(system ? [["/dashboard", "Dashboard"]] : []),
    ["/products", "Product Search & Queue"],
    ...(admin ? [["/price-memos/import", "Price Memo Import"], ["/admin/accounts", "Account Administration"]] : []),
    ...(system ? [["/admin/logos", "Logo Manager"], ["/product-master", "Product Master"]] : []),
  ];
  return <nav aria-label="Workspace">
    {items.map(([path, label]) => <Link key={path} href={path + "/"} onClick={onNavigate}
      className={"ptg-nav-item" + (active === path ? " active" : "")}
      aria-current={active === path ? "page" : undefined}>{label}</Link>)}
  </nav>;
}
