"use client";

import { createClient } from "@/lib/supabase/client";
import { getPtgAppSessionId } from "@/lib/ptg/auth-client";

export const usesEdgeData = process.env.NEXT_PUBLIC_PTG_USE_EDGE_DATA === "true";

export async function invokePtgData(functionName: string, body: Record<string, unknown>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publicKey) throw new Error("Supabase public environment variables are not configured.");

  const client = createClient();
  const { data: authData } = await client.auth.getSession();
  const sessionId = getPtgAppSessionId();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: publicKey,
  };
  if (authData.session?.access_token) headers.Authorization = "Bearer " + authData.session.access_token;
  if (sessionId) headers["x-ptg-session-id"] = sessionId;

  const response = await fetch(url.replace(/\/$/, "") + "/functions/v1/" + encodeURIComponent(functionName), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as { ok?: boolean; message?: string };
  if (!response.ok || result.ok !== true) {
    const error = new Error(result.message ?? "PTG data request failed.") as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return result as Record<string, unknown>;
}
