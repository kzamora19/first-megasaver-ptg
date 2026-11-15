"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { establishPtgAuthSession, getPtgAppSessionId, type EdgeAuthResponse } from "@/lib/ptg/auth-client";

let sales: SupabaseClient | undefined;

// The same hybrid storage policy used by Sales Tracker and Data Desk.
// Both apps run under the same GitHub Pages origin, but have distinct
// Supabase Auth storage keys and separate authorization decisions.
function client() {
  if (sales) return sales;
  const url = process.env.NEXT_PUBLIC_SALES_TRACKER_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SALES_TRACKER_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  sales = createClient(url, key, { auth: {
    autoRefreshToken: true, persistSession: true, detectSessionInUrl: false,
    storage: {
      getItem: k => sessionStorage.getItem(k) ?? localStorage.getItem(k),
      setItem: (k, value) => {
        const persistent = sessionStorage.getItem(k) === null &&
          (localStorage.getItem(k) !== null || localStorage.getItem("branchline-remember") !== "0");
        (persistent ? localStorage : sessionStorage).setItem(k, value);
        (persistent ? sessionStorage : localStorage).removeItem(k);
      },
      removeItem: k => { sessionStorage.removeItem(k); localStorage.removeItem(k); },
    },
  } });
  return sales;
}

export async function salesTrackerAdminSessionToken() {
  const sales = client();
  if (!sales) return null;
  const { data, error } = await sales.auth.getSession();
  return error ? null : data.session?.access_token ?? null;
}

export async function restoreUnifiedPtgSession(): Promise<EdgeAuthResponse | null> {
  if (getPtgAppSessionId()) return null;
  const salesAccessToken = await salesTrackerAdminSessionToken();
  if (!salesAccessToken) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const response = await fetch(url.replace(/\/$/, "") + "/functions/v1/ptg-unified-sso", {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ salesAccessToken }),
  });
  // An unlinked legacy user continues to use their existing PTG login.
  if (response.status === 401 || response.status === 403 || response.status === 404) return null;
  const result = await response.json().catch(() => ({})) as EdgeAuthResponse;
  if (!response.ok || !result.ok) throw Error(result.message || "Unified sign-in is unavailable.");
  await establishPtgAuthSession(result, false);
  return result;
}
