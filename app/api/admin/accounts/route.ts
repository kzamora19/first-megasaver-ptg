import { NextResponse } from "next/server";

import { requireAdminPermission, writeAdminAudit } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (code === "AUTH_REQUIRED") return NextResponse.json({ ok: false }, { status: 401 });
  if (code === "PERMISSION_DENIED") return NextResponse.json({ ok: false, message: "You are not authorized to perform this action." }, { status: 403 });
  return NextResponse.json({ ok: false, message: "The account operation could not be completed." }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ ok: false }, { status: 403 });
    const branchId = new URL(request.url).searchParams.get("branchId");
    const { session, admin } = await requireAdminPermission(
      sessionPermission(sessionRolePlaceholder()),
      "VIEW",
      branchId,
    );
    let query = admin.from("user_profiles")
      .select("id,display_name,role_key,legacy_role,branch_id,is_active,failed_login_attempts,locked_until,must_change_password,created_at,updated_at")
      .order("display_name");
    if (session.role === "BRANCH_ADMIN") query = query.eq("branch_id", session.branchId);
    else if (branchId) query = query.eq("branch_id", branchId);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ ok: true, accounts: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ ok: false }, { status: 403 });
    const body = await request.json() as {
      username?: string; displayName?: string; password?: string;
      role?: string; branchId?: string; legacyRole?: string;
    };
    const username = String(body.username ?? "").trim().toUpperCase();
    const displayName = String(body.displayName ?? "").trim();
    const password = String(body.password ?? "");
    const role = String(body.role ?? "").trim().toUpperCase();
    const legacyRole = String(body.legacyRole ?? role).trim().toUpperCase();
    const branchId = body.branchId ?? null;

    if (!/^[A-Z0-9._-]{3,32}$/.test(username) || !displayName ||
        password.length < 12 || password.length > 1024) {
      return NextResponse.json({ ok: false, message: "Provide a valid username, display name, and an initial password of at least 12 characters." }, { status: 400 });
    }
    if (!["SYSTEM_ADMIN", "SYSTEM_VIEWER", "BRANCH_ADMIN", "BRANCH_USER"].includes(role)) {
      return NextResponse.json({ ok: false, message: "Invalid application role." }, { status: 400 });
    }
    if (role.startsWith("BRANCH_") !== !!branchId) {
      return NextResponse.json({ ok: false, message: "Select a branch for branch accounts only." }, { status: 400 });
    }
    if (role === "BRANCH_USER" && !["BRANCH USER", "TEAM LEADER"].includes(legacyRole)) {
      return NextResponse.json({ ok: false, message: "Invalid branch account title." }, { status: 400 });
    }
    if (role === "BRANCH_ADMIN" && legacyRole !== "BRANCH ADMIN") {
      return NextResponse.json({ ok: false, message: "Invalid Branch Admin title." }, { status: 400 });
    }

    const permission = role.startsWith("SYSTEM_")
      ? "SYSTEM_ADMIN_ACCOUNT_MANAGEMENT"
      : "BRANCH_USER_ACCOUNT_MANAGEMENT";
    const { session, admin } = await requireAdminPermission(permission, "EXECUTE", branchId);

    if (role.startsWith("SYSTEM_") && session.role !== "SYSTEM_ADMIN") {
      throw new Error("PERMISSION_DENIED");
    }
    if (role.startsWith("BRANCH_")) {
      const { data: branch } = await admin.from("branches").select("id,status,operational_status").eq("id", branchId).maybeSingle();
      if (!branch || branch.status !== "ACTIVE" || branch.operational_status !== "ON") {
        return NextResponse.json({ ok: false, message: "The selected branch is not active." }, { status: 400 });
      }
    }

    const normalized = username.toLowerCase();
    const authEmail = role.startsWith("SYSTEM_")
      ? `ptg.system.${normalized}@accounts.firstmegasaver.invalid`
      : `ptg.${String(branchId).replace(/-/g, "")}.${normalized}@accounts.firstmegasaver.invalid`;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
      app_metadata: { application: "first-megasaver-ptg" },
    });
    if (createError || !created.user) throw new Error("AUTH_USER_CREATE_FAILED");

    const authUserId = created.user.id;
    const { error: profileError } = await admin.from("user_profiles").insert({
      id: authUserId, display_name: displayName, role_key: role,
      legacy_role: legacyRole, branch_id: branchId, is_active: true,
      must_change_password: true,
    });
    const { error: identityError } = profileError ? { error: profileError } :
      await admin.schema("private").from("login_identities").insert({
        auth_user_id: authUserId, username, normalized_username: username,
        account_scope: role.startsWith("SYSTEM_") ? "SYSTEM" : "BRANCH",
        branch_id: branchId, auth_email: authEmail,
      });

    if (profileError || identityError) {
      await admin.auth.admin.deleteUser(authUserId);
      throw new Error("ACCOUNT_RECORD_CREATE_FAILED");
    }

    await writeAdminAudit({
      actorUserId: session.userId, branchId: role.startsWith("BRANCH_") ? branchId : null,
      action: "CREATE_ACCOUNT", target: username, outcome: "SUCCESS",
      message: "Account provisioned; password change required at first sign-in.",
      metadata: { role, legacyRole, branchId },
    });
    return NextResponse.json({ ok: true, accountId: authUserId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

function sessionRolePlaceholder(): "SYSTEM_ADMIN_ACCOUNT_MANAGEMENT" {
  return "SYSTEM_ADMIN_ACCOUNT_MANAGEMENT";
}
function sessionPermission(_role: string) {
  return "SYSTEM_ADMIN_ACCOUNT_MANAGEMENT" as const;
}
