import { NextResponse } from "next/server";

import {
  clearLoginFailures,
  recordLoginFailure,
  resolveLoginIdentity,
} from "@/lib/auth/login";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const genericFailure = () =>
  NextResponse.json(
    { ok: false, message: "Invalid username or password, or account unavailable." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ ok: false, message: "Request origin is not allowed." }, { status: 403 });
  }

  let body: { username?: string; password?: string; branchCode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }

  const username = String(body.username ?? "").trim().toUpperCase();
  const password = String(body.password ?? "");
  const branchCode = String(body.branchCode ?? "").trim().toUpperCase() || undefined;

  if (!username || !password || username.length > 120 || password.length > 1024) {
    return NextResponse.json(
      { ok: false, message: "Username and password are required." },
      { status: 400 },
    );
  }

  try {
    const identity = await resolveLoginIdentity(username, branchCode);
    if (!identity || !identity.is_active) return genericFailure();

    if (
      identity.account_scope === "BRANCH" &&
      (identity.branch_status !== "ACTIVE" ||
        identity.operational_status !== "ON" ||
        !identity.branch_id)
    ) {
      return genericFailure();
    }

    if (identity.locked_until && new Date(identity.locked_until).getTime() > Date.now()) {
      return genericFailure();
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: identity.auth_email,
      password,
    });

    if (error || !data.user || !data.session) {
      await recordLoginFailure(identity.auth_user_id);
      return genericFailure();
    }

    await clearLoginFailures(identity.auth_user_id);

    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    const admin = createAdminClient();
    const { data: appSession, error: sessionError } = await admin.from("app_sessions").insert({
      user_id: identity.auth_user_id,
      branch_id: identity.branch_id,
      session_version: identity.session_version,
      device_label: String(request.headers.get("user-agent") ?? "Browser").slice(0, 200),
      last_activity_at: new Date().toISOString(),
      expires_at: expiresAt,
    }).select("id").single();

    if (sessionError) {
      await supabase.auth.signOut();
      return NextResponse.json(
        { ok: false, message: "Unable to establish a secure application session." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    const response = NextResponse.json(
      {
        ok: true,
        account: {
          username: identity.username,
          displayName: identity.display_name,
          role: identity.role_key,
          branchCode: identity.branch_code,
          branchName: identity.branch_name,
        },
        session: {
          idleTimeoutMinutes: 30,
          maxLifetimeMinutes: 480,
        },
      },
      { headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } },
    );
    response.cookies.set("ptg_app_session", appSession.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    return response;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Authentication service is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
