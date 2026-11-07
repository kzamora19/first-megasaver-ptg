import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const cookieStore = await cookies();
  const appSessionId = cookieStore.get("ptg_app_session")?.value;
  const admin = createAdminClient();

  if (appSessionId) {
    await admin
      .from("app_sessions")
      .update({ revoked_at: new Date().toISOString(), revoke_reason: "USER_LOGOUT" })
      .eq("id", appSessionId)
      .is("revoked_at", null);
  }

  const supabase = await createClient();
  await supabase.auth.signOut();

  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set("ptg_app_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
