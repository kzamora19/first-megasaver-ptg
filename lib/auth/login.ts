import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type LoginIdentity = {
  auth_user_id: string;
  auth_email: string;
  account_scope: "SYSTEM" | "BRANCH";
  username: string;
  role_key: "SYSTEM_ADMIN" | "SYSTEM_VIEWER" | "BRANCH_ADMIN" | "BRANCH_USER";
  display_name: string;
  is_active: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
  session_version: number;
  branch_id: string | null;
  branch_code: string | null;
  branch_name: string | null;
  branch_status: string | null;
  operational_status: string | null;
};

export async function resolveLoginIdentity(
  username: string,
  branchCode?: string,
): Promise<LoginIdentity | null> {
  const normalizedUsername = username.trim().toUpperCase();
  if (!normalizedUsername) return null;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("resolve_ptg_login_identity", {
    p_username: normalizedUsername,
    p_branch_code: branchCode?.trim().toUpperCase() || null,
  });

  if (error) {
    throw new Error("Unable to resolve login identity.");
  }

  // Universal login must resolve to exactly one account, matching the legacy
  // behavior. Branch-specific login can disambiguate repeated usernames.
  if (!Array.isArray(data) || data.length !== 1) return null;
  return data[0] as LoginIdentity;
}

export async function recordLoginFailure(userId: string) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("record_ptg_login_failure", {
    p_user_id: userId,
  });
  if (error) throw new Error("Unable to record authentication failure.");
}

export async function clearLoginFailures(userId: string) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("clear_ptg_login_failures", {
    p_user_id: userId,
  });
  if (error) throw new Error("Unable to clear authentication failures.");
}
