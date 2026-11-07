import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false }, { status: 403 });
  let body: { bootstrapCode?: string; username?: string; displayName?: string; password?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }

  const bootstrapCode = String(body.bootstrapCode ?? "").trim().toUpperCase();
  const username = String(body.username ?? "").trim().toUpperCase();
  const displayName = String(body.displayName ?? "").trim();
  const password = String(body.password ?? "");
  if (!/^[A-F0-9]{64}$/.test(bootstrapCode)) {
    return NextResponse.json({ ok: false, message: "The one-time bootstrap code is invalid or expired." }, { status: 400 });
  }
  if (!/^[A-Z0-9._-]{3,32}$/.test(username) || !displayName || displayName.length > 80 ||
      password.length < 12 || password.length > 1024) {
    return NextResponse.json({ ok: false, message: "Enter a valid username, display name, and password of at least 12 characters." }, { status: 400 });
  }

  const normalized = username.toLowerCase();
  const authEmail = `ptg.system.${normalized}@accounts.firstmegasaver.invalid`;
  const codeHash = createHash("sha256").update(bootstrapCode).digest("hex");
  const admin = createAdminClient();
  let userId: string | null = null;
  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
      app_metadata: { application: "first-megasaver-ptg" },
    });
    if (createError || !created.user) throw new Error("AUTH_USER_CREATE_FAILED");
    userId = created.user.id;

    const { data, error } = await admin.rpc("bootstrap_ptg_first_system_admin", {
      p_user_id: userId,
      p_username: username,
      p_display_name: displayName,
      p_auth_email: authEmail,
      p_code_hash: codeHash,
    });
    if (error || data !== true) throw new Error("BOOTSTRAP_REJECTED");

    return NextResponse.json({ ok: true, username }, {
      status: 201,
      headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" },
    });
  } catch {
    if (userId) await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({
      ok: false,
      message: "The first System Admin could not be created. The bootstrap code may be expired, already used, or initialization may already be complete.",
    }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
