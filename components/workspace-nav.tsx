import Link from "next/link";
import { Suspense, Fragment } from "react";
import { useSearchParams } from "next/navigation";
import { getSecuritySection, securitySections } from "@/lib/ptg/security-sections";

function SecurityLinks({ onNavigate }: { onNavigate: () => void }) {
  const selected = getSecuritySection(useSearchParams().get("section"));
  return <div className="ptg-security-nav" aria-label="System Security">
    {securitySections.map(([key, label]) => <Link key={key} href={"/admin/accounts/?section=" + key}
      onClick={onNavigate} className={"ptg-nav-item" + (key === selected ? " active" : "")}
      aria-current={key === selected ? "page" : undefined}>{label}</Link>
      {system && active === path && path === "/admin/accounts" && <Suspense><SecurityLinks onNavigate={onNavigate} /></Suspense>}
    </Fragment>)}
  </div>;
}

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
    {items.map(([path, label]) => <Fragment key={path}><Link href={path + "/"} onClick={onNavigate}
      className={"ptg-nav-item" + (active === path ? " active" : "")}
      aria-current={active === path ? "page" : undefined}>{label}</Link>)}
  </nav>;
}
