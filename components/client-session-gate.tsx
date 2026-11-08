"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export type PtgClientSession = {
  username: string;
  displayName: string;
  role: string;
  legacyRole: string;
  branchCode: string | null;
  branchName: string | null;
  mustChangePassword: boolean;
};

type SessionResponse = {
  ok?: boolean;
  account?: PtgClientSession;
};

export default function ClientSessionGate({
  children,
  allowRoles,
  deniedTo = "/no-access",
}: {
  children: (session: PtgClientSession) => ReactNode;
  allowRoles?: string[];
  deniedTo?: string;
}) {
  const router = useRouter();
  const [session, setSession] = useState<PtgClientSession | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }).then(async response => {
      const result = await response.json() as SessionResponse;
      if (!response.ok || !result.ok || !result.account) {
        router.replace("/login");
        return;
      }
      if (result.account.mustChangePassword) {
        router.replace("/change-password");
        return;
      }
      if (allowRoles && !allowRoles.includes(result.account.role)) {
        router.replace(deniedTo);
        return;
      }
      setSession(result.account);
      setStatus("ready");
    }).catch(error => {
      if (error instanceof Error && error.name === "AbortError") return;
      setStatus("error");
    });
    return () => controller.abort();
  }, [allowRoles, deniedTo, router]);

  if (status === "loading") {
    return <main className="shell"><section className="panel" role="status">Checking your PTG session…</section></main>;
  }
  if (status === "error") {
    return <main className="shell"><section className="panel" role="alert">
      <h1>PTG is unavailable</h1>
      <p className="intro">We could not verify your session. Check your connection and try again.</p>
      <button type="button" className="admin-link" onClick={() => window.location.reload()}>Try again</button>
    </section></main>;
  }
  if (!session) return null;
  return children(session);
}
