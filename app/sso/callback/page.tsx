"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, withPtgAuthStorage } from "@/lib/supabase/client";
import {
  clearPtgAuthSession, invokePtgAuth, setPtgAppSessionId, setRememberedPtgLogin,
} from "@/lib/ptg/auth-client";
import { ssoRememberPreference, unifiedSsoVisible } from "@/lib/ptg/unified-sso-client";

export default function SsoCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Verifying your Branchline identity…");
  useEffect(() => {
    let active = true;
    async function finish() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const remember = ssoRememberPreference();
      if (!unifiedSsoVisible) {
        if (active) setMessage("Unified sign-in is not enabled for this workspace.");
        return;
      }
      if (!code || !/^[A-Za-z0-9._~-]{12,2048}$/.test(code) || params.has("error")) {
        if (active) setMessage("Your sign-in request was cancelled or expired. Return to the login page.");
        return;
      }
      try {
        // The code verifier is stored by Supabase PKCE when the OAuth redirect
        // starts. Manual exchange avoids implicit flow or URL-fragment tokens.
        const { data, error } = await withPtgAuthStorage(remember,
          () => createClient().auth.exchangeCodeForSession(code));
        window.history.replaceState(window.history.state, "", window.location.pathname);
        if (error || !data.user || !data.session) {
          throw Error("Could not verify the Branchline login. Please sign in again.");
        }
        // The server validates the trusted identity provider, central user
        // subject, approved entitlement, PTG role, branch and app availability.
        // A PTG Auth session alone never grants access to PTG data.
        const result = await invokePtgAuth("sso-session", { rememberMe: remember });
        if (!result.account || !result.appSessionId) throw Error("Your PTG grant is unavailable.");
        if (!active) return;
        setPtgAppSessionId(result.appSessionId, remember);
        setRememberedPtgLogin(result.account.username, remember);
        router.replace(result.account.mustChangePassword ? "/change-password/" :
          result.account.role === "SYSTEM_ADMIN" ? "/admin/accounts/" : "/products/");
      } catch (error) {
        await clearPtgAuthSession().catch(() => {});
        if (active) setMessage(error instanceof Error ? error.message : "Unable to establish the authorized PTG session.");
      }
    }
    void finish();
    return () => { active = false; };
  }, [router]);

  return <main className="auth-shell"><section className="auth-card">
    <h1>Branchline unified sign-in</h1>
    <p role="status">{message}</p>
    <a href="../login/">Back to PTG login</a>
  </section></main>;
}
