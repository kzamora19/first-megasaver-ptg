import "server-only";

import { getActiveAppSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export type AdminPermission =
  | "SYSTEM_ADMIN_ACCOUNT_MANAGEMENT"
  | "BRANCH_USER_ACCOUNT_MANAGEMENT"
  | "PASSWORD_RESET"
  | "USER_STATUS_CONTROL"
  | "FORCE_LOGOUT"
  | "SECURITY_LOG_VIEW";

export async function requireAdminPermission(
  permissionKey: AdminPermission,
  action: "VIEW" | "EXECUTE",
  targetBranchId?: string | null,
) {
  const session = await getActiveAppSession();
  if (!session) throw new Error("AUTH_REQUIRED");

  const admin = createAdminClient();
  const { data: permission, error } = await admin
    .from("role_permissions")
    .select("access_level")
    .eq("role_key", session.role)
    .eq("permission_key", permissionKey)
    .maybeSingle();

  if (error || !permission) throw new Error("PERMISSION_DENIED");

  const access = String(permission.access_level);
  let allowed = access === "FULL";
  if (access === "VIEW") allowed = action === "VIEW";
  if (access === "LIMITED") allowed = action === "VIEW";
  if (access === "OWN_BRANCH") {
    allowed = !!session.branchId && !!targetBranchId &&
      session.branchId === targetBranchId;
  }

  if (!allowed) {
    await admin.from("security_audit_logs").insert({
      actor_user_id: session.userId,
      branch_id: session.branchId,
      event_category: "AUTHORIZATION",
      action,
      target_identifier: permissionKey,
      outcome: "DENIED",
      message: "Administrative permission denied.",
      metadata: { role: session.role, targetBranchId: targetBranchId ?? null },
    });
    throw new Error("PERMISSION_DENIED");
  }

  return { session, admin };
}

export async function writeAdminAudit(input: {
  actorUserId: string;
  branchId?: string | null;
  action: string;
  target: string;
  outcome: "SUCCESS" | "DENIED" | "WARNING";
  message: string;
  metadata?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("security_audit_logs").insert({
    actor_user_id: input.actorUserId,
    branch_id: input.branchId ?? null,
    event_category: "ACCOUNT_ADMINISTRATION",
    action: input.action,
    target_identifier: input.target,
    outcome: input.outcome,
    message: input.message,
    metadata: input.metadata ?? {},
  });
  if (error) throw new Error("AUDIT_WRITE_FAILED");
}
