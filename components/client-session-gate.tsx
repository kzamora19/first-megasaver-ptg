"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  clearPtgAuthSession,
  invokePtgAuth,
  usesEdgeAuth,
  type EdgeAuthResponse,
} from "@/lib/ptg/auth-client";

export type PtgClientSession = NonNullable<EdgeAuthResponse["account"]>;

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
  const allowedRoles = allowRoles?.join("|") ?? "";

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const checkSession = async () => {
      try {
        let account: PtgClientSession | undefined;
        if (usesEdgeAuth) {
          const result = await invokePtgAuth("session");
          account = result.account;
        } else {
          const response = await fetch("/api/auth/session", {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          });
          const result = await response.json() as { ok?: boolean; account?: PtgClientSession };
          if (!response.ok || !result.ok) {
            router.replace("/login");
            return;
          }
          account = result.account;
        }
        if (cancelled) return;
        if (!account) {
          if (usesEdgeAuth) await clearPtgAuthSession();
          router.replace("/login");
          return;
        }
        if (account.mustChangePassword) {
          router.replace("/change-password");
          return;
        }
        if (allowedRoles && !allowedRoles.split("|").includes(account.role)) {
          router.replace(deniedTo);
          return;
        }
        setSession(account);
        setStatus("ready");
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        if (usesEdgeAuth && typeof error === "object" && error !== null && "status" in error && error.status === 401) {
          await clearPtgAuthSession();
          router.replace("/login");
          return;
        }
        setStatus("error");
      }
    };
    void checkSession();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [allowedRoles, deniedTo, router]);

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
