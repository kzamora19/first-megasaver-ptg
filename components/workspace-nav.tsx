import { withBasePath } from "@/lib/base-path";

export default function WorkspaceNav({ role, active, sidebar = false }: { role: string; active: string; sidebar?: boolean }) {
  const system = role === "SYSTEM_ADMIN";
  const admin = system || role === "BRANCH_ADMIN";
  const items = [
    ...(system ? [["/dashboard", "Dashboard"]] : []),
    ["/products", "Product Search & Queue"],
    ...(admin ? [["/price-memos/import", "Price Memo Import"], ["/admin/accounts", "Account Administration"]] : []),
    ...(system ? [["/admin/logos", "Logo Manager"], ["/product-master", "Product Master"]] : []),
  ];
  return <nav aria-label="Workspace" className={sidebar ? undefined : "ptg-workspace-menu ptg-print-hide"}>
    {items.map(([path, label]) => <a key={path} href={withBasePath(path + "/")}
      className={sidebar ? "ptg-nav-item" + (active === path ? " active" : "") : undefined}
      aria-current={active === path ? "page" : undefined}>{label}</a>)}
  </nav>;
}
