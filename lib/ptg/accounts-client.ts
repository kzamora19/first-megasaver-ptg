"use client";

import { createClient } from "@/lib/supabase/client";
import { getPtgAppSessionId } from "@/lib/ptg/auth-client";

export const usesEdgeAccounts = process.env.NEXT_PUBLIC_PTG_USE_EDGE_ACCOUNTS === "true";

export async function requestPtgAccounts(
  method: "GET" | "POST" | "PATCH",
  body?: Record<string, unknown>,
  params?: Record<string, string>,
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publicKey) throw new Error("Supabase public environment variables are not configured.");
  const headers: Record<string, string> = { apikey: publicKey, "Content-Type": "application/json" };
  const client = createClient();
  const { data } = await client.auth.getSession();
  if (data.session?.access_token) headers.Authorization = "Bearer " + data.session.access_token;
  else if (method !== "GET") headers.Authorization = "Bearer " + publicKey;
  const sessionId = getPtgAppSessionId();
  if (sessionId) headers["x-ptg-session-id"] = sessionId;
  const query = new URLSearchParams(params ?? {});
  const target = url.replace(/\/$/, "") + "/functions/v1/ptg-accounts" + (query.size ? "?" + query.toString() : "");
  return fetch(target, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
}
