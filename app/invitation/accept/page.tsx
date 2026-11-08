import { Suspense } from "react";
import InvitationAcceptPage from "./invitation-accept-page";

export default function AcceptInvitationPage() {
  return <Suspense fallback={<main className="auth-shell"><section className="auth-card">Loading invitation…</section></main>}>
    <InvitationAcceptPage />
  </Suspense>;
}
