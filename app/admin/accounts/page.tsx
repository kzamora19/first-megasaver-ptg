import { redirect } from "next/navigation";
import { getActiveAppSession } from "@/lib/auth/session";
import AccountAdministration from "./account-administration";
export const dynamic = "force-dynamic";
export default async function AdminAccountsPage(){
 const session=await getActiveAppSession();if(!session)redirect("/login");if(session.mustChangePassword)redirect("/change-password");
 if(!["SYSTEM_ADMIN","BRANCH_ADMIN"].includes(session.role))redirect("/dashboard");
 return <main className="shell admin-shell"><a className="admin-back" href="/dashboard">← Back to dashboard</a><section className="hero admin-hero"><p className="eyebrow">FIRST MEGASAVER · SYSTEM SECURITY</p><h1>Administration</h1><p className="intro">Manage user accounts and active access within your authorized scope.</p><div className="status"><span className="status-dot"/>{session.role.replaceAll("_"," ")}</div></section><AccountAdministration role={session.role}/></main>;
}
