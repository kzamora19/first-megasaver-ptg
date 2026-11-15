"use client";

import { createClient, withPtgAuthStorage } from "@/lib/supabase/client";
import { withBasePath } from "@/lib/base-path";

// Both the UI and the server exchange endpoint have independent kill switches.
// The provider also must be configured in Supabase Auth before this can work.
export const unifiedSsoVisible =
  process.env.NEXT_PUBLIC_PTG_UNIFIED_SSO_ENABLED === "true";
const oauthRememberKey = "ptg-branchline-sso-remember";
export const ssoCallbackPath = "/sso/callback/";

export async function startBranchlineSso(remember: boolean) {
  if (!unifiedSsoVisible) throw Error("Unified sign-in is not enabled.");
  sessionStorage.setItem(oauthRememberKey, remember ? "1" : "0");
  const redirectTo = window.location.origin + withBasePath(ssoCallbackPath);
  const { error } = await withPtgAuthStorage(remember, () =>
    createClient().auth.signInWithOAuth({
      provider: "custom:branchline",
      options: { redirectTo },
    }),
  );
  if (error) {
    sessionStorage.removeItem(oauthRememberKey);
    throw Error("Could not start Branchline sign-in: " + error.message);
  }
}

export function ssoRememberPreference() {
  const remember = sessionStorage.getItem(oauthRememberKey) === "1";
  sessionStorage.removeItem(oauthRememberKey);
  return remember;
}
