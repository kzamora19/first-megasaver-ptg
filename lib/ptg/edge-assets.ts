"use client";

import { createClient } from "@/lib/supabase/client";
import { getPtgAppSessionId } from "@/lib/ptg/auth-client";

export const usesEdgeAssets = process.env.NEXT_PUBLIC_PTG_USE_EDGE_ASSETS === "true";

export async function requestPtgLogos(method: "GET" | "POST" | "DELETE", body?: FormData | Record<string, unknown>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publicKey) throw new Error("Supabase public environment variables are not configured.");

  const headers: Record<string, string> = { apikey: publicKey };
  let requestBody: BodyInit | undefined;
  if (body instanceof FormData) {
    requestBody = body;
  } else if (body) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  if (method !== "GET") {
    const client = createClient();
    const { data } = await client.auth.getSession();
    if (data.session?.access_token) headers.Authorization = "Bearer " + data.session.access_token;
    const sessionId = getPtgAppSessionId();
    if (sessionId) headers["x-ptg-session-id"] = sessionId;
  }

  return fetch(url.replace(/\/$/, "") + "/functions/v1/ptg-logos", {
    method,
    headers,
    body: requestBody,
  });
}
