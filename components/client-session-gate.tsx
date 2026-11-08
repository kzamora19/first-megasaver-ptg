"use client";

import { useEffect, useState, type ReactNode } from "react";
import AppDialog from "@/components/app-dialog";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import {
  clearPtgAuthSession,
  getAvailabilityNotice,
  invokePtgAuth,
  usesEdgeAuth,
  type EdgeAuthResponse,
} from "@/lib/ptg/auth-client";

export type PtgClientSession = NonNullable<EdgeAuthResponse["account"]>;

export default function ClientSessionGate({
  children,
  allowRoles,
  watchAvailability = false,
  deniedTo = "/no-access",
}: {
  children: (session: PtgClientSession) => ReactNode;
  allowRoles?: string[];
  watchAvailability?: boolean;
  deniedTo?: string;
}) {
  const router = useRouter();
  const [session, setSession] = useState<PtgClientSession | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [availabilityNotice, setAvailabilityNotice] = useState<ReturnType<typeof getAvailabilityNotice>>(null);
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
          const notice = getAvailabilityNotice(error);
          if (notice) {
            setAvailabilityNotice(notice);
            setSession(null);
            void clearPtgAuthSession().catch(() => {});
          } else {
            await clearPtgAuthSession();
            router.replace("/login");
          }
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

  const role = session?.role;
  useEffect(() => {
    if (!usesEdgeAuth || !watchAvailability || !role || role === "SYSTEM_ADMIN") return;
    const client = createClient();
    const channel = client.channel("ptg-availability");
    let stopped = false;
    let checking = false;
    let recheckPending = false;

    async function verifyAvailability() {
      if (stopped) return;
      if (checking) {
        recheckPending = true;
        return;
      }
      checking = true;
      try {
        await invokePtgAuth("session-status");
      } catch (error) {
        if (!stopped && typeof error === "object" && error !== null && "status" in error && error.status === 401) {
          stopped = true;
          setSession(null);
          const notice = getAvailabilityNotice(error);
          if (notice) setAvailabilityNotice(notice);
          try {
            await clearPtgAuthSession();
          } catch {
            // The application session ID has already been cleared.
          } finally {
            if (!notice) router.replace("/login");
          }
        }
      } finally {
        checking = false;
        if (recheckPending) {
          recheckPending = false;
          void verifyAvailability();
        }
      }
    }

    channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "ptg_availability_signal" }, () => void verifyAvailability());
    void client.realtime.setAuth().then(() => {
      if (!stopped) channel.subscribe(status => {
        if (status === "SUBSCRIBED") void verifyAvailability();
      });
    }).catch(() => { /* The fallback check covers connection failures. */ });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void verifyAvailability();
    }, 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void verifyAvailability();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      void client.removeChannel(channel);
    };
  }, [role, router, watchAvailability]);

  if (availabilityNotice) {
    return <AppDialog title={availabilityNotice.title} busy={false} closeIcon onClose={() => router.replace("/login")}>
      <p>Your PTG session has ended. {availabilityNotice.message}</p>
      <button type="button" className="admin-button" onClick={() => router.replace("/login")}>Return to sign-in</button>
    </AppDialog>;
  }

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
