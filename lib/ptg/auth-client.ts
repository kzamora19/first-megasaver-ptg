"use client";

import { createClient } from "@/lib/supabase/client";

export const usesEdgeAuth = process.env.NEXT_PUBLIC_PTG_USE_EDGE_AUTH === "true";
const appSessionKey = "ptg_app_session_id";

export type EdgeAuthResponse = {
  ok?: boolean;
  message?: string;
  availability?: string;
  account?: {
    username: string;
    displayName: string;
    role: string;
    legacyRole: string;
    branchCode: string | null;
    branchName: string | null;
    mustChangePassword: boolean;
  };
  appSessionId?: string;
  authSession?: {
    accessToken: string;
    refreshToken: string;
  };
};

export function getPtgAppSessionId() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(appSessionKey) ?? window.localStorage.getItem(appSessionKey) ?? "";
}

export function setPtgAppSessionId(value: string, rememberMe: boolean) {
  const preferredStorage = rememberMe ? window.localStorage : window.sessionStorage;
  const otherStorage = rememberMe ? window.sessionStorage : window.localStorage;
  otherStorage.removeItem(appSessionKey);
  preferredStorage.setItem(appSessionKey, value);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = rememberMe
    ? `ptg_app_session=${encodeURIComponent(value)}; Path=/; Max-Age=28800; SameSite=Strict${secure}`
    : `ptg_app_session=; Path=/; Max-Age=0; SameSite=Strict${secure}`;
}

export function clearPtgAppSessionId() {
  window.sessionStorage.removeItem(appSessionKey);
  window.localStorage.removeItem(appSessionKey);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `ptg_app_session=; Path=/; Max-Age=0; SameSite=Strict${secure}`;
}

export async function clearPtgAuthSession() {
  clearPtgAppSessionId();
  await createClient().auth.signOut({ scope: "local" });
}

export async function invokePtgAuth(action: string, fields: Record<string, unknown> = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publicKey) throw new Error("Supabase public environment variables are not configured.");

  const client = createClient();
  const { data: authData } = await client.auth.getSession();
  const appSessionId = getPtgAppSessionId();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: publicKey,
  };
  if (authData.session?.access_token) headers.Authorization = `Bearer ${authData.session.access_token}`;
  if (appSessionId) headers["x-ptg-session-id"] = appSessionId;

  const response = await fetch(`${url.replace(/\/$/, "")}/functions/v1/ptg-auth`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...fields, action }),
  });
  const result = await response.json().catch(() => ({})) as EdgeAuthResponse;
  if (!response.ok || result.ok !== true) {
    const error = new Error(result.message ?? "Authentication request failed.") as Error & { status?: number; availability?: string };
    error.status = response.status;
    error.availability = result.availability;
    throw error;
  }
  return result;
}

export async function establishPtgAuthSession(result: EdgeAuthResponse, rememberMe: boolean) {
  if (!result.appSessionId || !result.authSession?.accessToken || !result.authSession.refreshToken) {
    throw new Error("Authentication response did not include a complete PTG session.");
  }
  const client = createClient();
  const { error } = await client.auth.setSession({
    access_token: result.authSession.accessToken,
    refresh_token: result.authSession.refreshToken,
  });
  if (error) throw new Error("Could not establish the Supabase sign-in session.");
  setPtgAppSessionId(result.appSessionId, rememberMe);
}

export function getAvailabilityNotice(error: unknown) {
  if (!error || typeof error !== "object" || !("availability" in error)) return null;
  switch (error.availability) {
    case "MAINTENANCE_MODE":
      return { title: "PTG is under maintenance", message: "Please try again when maintenance is complete." };
    case "MASTER_SYSTEM":
      return { title: "PTG is temporarily unavailable", message: "Please try again when the system is back online." };
    case "BRANCH_OFF":
    case "BRANCH_UNAVAILABLE":
      return { title: "PTG is unavailable for your branch", message: "Contact your branch administrator or try again when your branch is back online." };
    default:
      return null;
  }
}
