"use client";

import { createClient, createCookieClient, withPtgAuthStorage } from "@/lib/supabase/client";

export const usesEdgeAuth = process.env.NEXT_PUBLIC_PTG_USE_EDGE_AUTH === "true";
const appSessionKey = "ptg_app_session_id";
const rememberedLoginKey = "ptg_remembered_login";
let migratedSession: { id: string; request: ReturnType<typeof migrateCookieSession> } | undefined;

function retryableAuthFailure(error: { status?: number }) {
  return !error.status || error.status >= 500 || error.status === 429;
}

async function migrateCookieSession(id: string) {
  const { data, error } = await createCookieClient().auth.getSession();
  if (error && retryableAuthFailure(error)) throw error;
  if (!data.session || getPtgAppSessionId() !== id) return null;
  const { data: restored, error: restoreError } = await createClient().auth.setSession(data.session);
  if (restoreError) throw restoreError;
  return restored.session;
}

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

export function getRememberedPtgSignIn() {
  return {
    login: window.localStorage.getItem(rememberedLoginKey) ?? "",
    sessionId: window.localStorage.getItem(appSessionKey) ?? "",
  };
}

export function setRememberedPtgLogin(login: string, remember: boolean) {
  if (remember) window.localStorage.setItem(rememberedLoginKey, login.trim());
  else window.localStorage.removeItem(rememberedLoginKey);
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
  const { data: authData, error: authError } = await client.auth.getSession();
  const appSessionId = getPtgAppSessionId();
  if (authError && action !== "login" && retryableAuthFailure(authError)) throw authError;
  let authSession = authData.session;
  if (!authSession && appSessionId && action !== "login") {
    if (migratedSession?.id !== appSessionId) {
      const request = migrateCookieSession(appSessionId).catch(error => {
        if (migratedSession?.id === appSessionId) migratedSession = undefined;
        throw error;
      });
      migratedSession = { id: appSessionId, request };
    }
    authSession = await migratedSession.request;
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: publicKey,
  };
  if (authSession?.access_token) headers.Authorization = `Bearer ${authSession.access_token}`;
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
  const { appSessionId, authSession } = result;
  if (!appSessionId || !authSession?.accessToken || !authSession.refreshToken) {
    throw new Error("Authentication response did not include a complete PTG session.");
  }
  const client = createClient();
  const { error } = await withPtgAuthStorage(rememberMe, () => client.auth.setSession({
    access_token: authSession.accessToken,
    refresh_token: authSession.refreshToken,
  }));
  if (error) throw new Error("Could not establish the Supabase sign-in session.");
  setPtgAppSessionId(appSessionId, rememberMe);
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
