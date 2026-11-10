import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const appSessionKey = "ptg_app_session_id";
let edgeClient: ReturnType<typeof createSupabaseClient> | undefined;
let rememberOnSignIn: boolean | undefined;

export async function withPtgAuthStorage<T>(remember: boolean, action: () => Promise<T>) {
  rememberOnSignIn = remember;
  try {
    return await action();
  } finally {
    rememberOnSignIn = undefined;
  }
}

export function createCookieClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase public environment variables are not configured.");
  }

  return createBrowserClient(url, publishableKey);
}

export function createClient() {
  if (process.env.NEXT_PUBLIC_PTG_USE_EDGE_AUTH !== "true" || typeof window === "undefined") {
    return createCookieClient();
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error("Supabase public environment variables are not configured.");

  return edgeClient ??= createSupabaseClient(url, publishableKey, {
    auth: {
      storageKey: "branchline-ptg-edge-auth",
      detectSessionInUrl: false,
      storage: {
        getItem: key => sessionStorage.getItem(key) ?? localStorage.getItem(key),
        setItem: (key, value) => {
          const remember = rememberOnSignIn ?? (sessionStorage.getItem(appSessionKey) === null && localStorage.getItem(appSessionKey) !== null);
          (remember ? localStorage : sessionStorage).setItem(key, value);
          (remember ? sessionStorage : localStorage).removeItem(key);
        },
        removeItem: key => { sessionStorage.removeItem(key); localStorage.removeItem(key); },
      },
    },
  });
}
