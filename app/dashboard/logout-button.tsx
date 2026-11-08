"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearPtgAuthSession, invokePtgAuth, usesEdgeAuth } from "@/lib/ptg/auth-client";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      if (usesEdgeAuth) {
        try { await invokePtgAuth("logout"); } finally { await clearPtgAuthSession(); }
      } else {
        await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
      }
    } finally {
      router.replace("/login");
      router.refresh();
      setBusy(false);
    }
  }

  return <button className="secondary-button" type="button" onClick={logout} disabled={busy}>
    {busy ? "SIGNING OUT…" : "SIGN OUT"}
  </button>;
}
