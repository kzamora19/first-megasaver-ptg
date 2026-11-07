import { redirect } from "next/navigation";

import { getActiveAppSession } from "@/lib/auth/session";
import LogoutButton from "./logout-button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getActiveAppSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">FIRST MEGASAVER · SECURE WORKSPACE</p>
        <h1>Price Tag Generator</h1>
        <p className="intro">Your account has been authenticated and the server-side application session is active.</p>
        <div className="status"><span className="status-dot" /> Authenticated session</div>
      </section>
      <section className="panel">
        <h2>Signed-in account</h2>
        <dl className="account-details">
          <div><dt>Username</dt><dd>{session.username}</dd></div>
          <div><dt>Role</dt><dd>{session.role}</dd></div>
          <div><dt>Branch</dt><dd>{session.branchCode ?? "SYSTEM"}</dd></div>
        </dl>
        <p className="intro">The PTG modules and print layouts will be migrated and tested in separate phases before this workspace is used operationally.</p>
        <LogoutButton />
      </section>
    </main>
  );
}
