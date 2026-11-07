import "server-only";

import { cookies } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActiveAppSession = {
  id: string;
  userId: string;
  role: string;
  branchId: string | null;
  branchCode: string | null;
  username: string;
  displayName: string;
};

/**
 * Enforces the legacy 30-minute idle timeout, 8-hour absolute lifetime,
 * account status, and session-version revocation on the server.
 */
export async function getActiveAppSession(): Promise<ActiveAppSession | null> {
  const cookieStore = await cookies();
  const appSessionId = cookieStore.get("ptg_app_session")?.value;
  if (!appSessionId) return null;

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return null;

  const admin = createAdminClient();
  const { data: session, error: sessionError } = await admin
    .from("app_sessions")
    .select("id,user_id,branch_id,session_version,created_at,last_activity_at,expires_at,revoked_at")
    .eq("id", appSessionId)
    .eq("user_id", authData.user.id)
    .is("revoked_at", null)
    .maybeSingle();

  if (sessionError || !session) return null;

  const now = Date.now();
  const idleExpired =
    now - new Date(session.last_activity_at).getTime() > 30 * 60 * 1000;
  const absoluteExpired = new Date(session.expires_at).getTime() <= now;

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("role_key,display_name,is_active,session_version")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (
    profileError ||
    !profile ||
    !profile.is_active ||
    Number(profile.session_version) !== Number(session.session_version) ||
    idleExpired ||
    absoluteExpired
  ) {
    await admin
      .from("app_sessions")
      .update({ revoked_at: new Date().toISOString(), revoke_reason: "EXPIRED_OR_INVALID" })
      .eq("id", appSessionId)
      .is("revoked_at", null);
    return null;
  }

  await admin
    .from("app_sessions")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", appSessionId)
    .is("revoked_at", null);

  let branchCode: string | null = null;
  if (session.branch_id) {
    const { data: branch } = await admin
      .from("branches")
      .select("branch_code,status,operational_status")
      .eq("id", session.branch_id)
      .maybeSingle();
    if (!branch || branch.status !== "ACTIVE" || branch.operational_status !== "ON") {
      await admin
        .from("app_sessions")
        .update({ revoked_at: new Date().toISOString(), revoke_reason: "BRANCH_UNAVAILABLE" })
        .eq("id", appSessionId)
        .is("revoked_at", null);
      return null;
    }
    branchCode = branch.branch_code;
  }

  const { data: identity } = await admin
    .schema("private")
    .from("login_identities")
    .select("username")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();

  return {
    id: session.id,
    userId: authData.user.id,
    role: profile.role_key,
    branchId: session.branch_id,
    branchCode,
    username: identity?.username ?? "",
    displayName: profile.display_name ?? "",
  };
}
