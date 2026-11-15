import { createClient } from "npm:@supabase/supabase-js@2";

const ptgUrl = Deno.env.get("SUPABASE_URL")!;
const ptgServiceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ptgPublicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
// These are PUBLIC Sales Tracker API settings, not service_role credentials.
const salesUrl = Deno.env.get("SALES_TRACKER_SUPABASE_URL") ?? "https://psoopubvdpwztzkdyifa.supabase.co";
const salesKey = Deno.env.get("SALES_TRACKER_PUBLISHABLE_KEY") ?? "sb_publishable_e_6K64Wul2fJEq2KiuvnTA_NmuaKqNm";
const allowed = new Set((Deno.env.get("PTG_ALLOWED_ORIGINS") ??
  "https://kzamora19.github.io,http://localhost:3000,http://127.0.0.1:3000").split(",").map(s => s.trim()));
const admin = createClient(ptgUrl, ptgServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const respond = (origin: string, status: number, content: Record<string, unknown>) =>
  new Response(JSON.stringify(content), { status, headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-ptg-session-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin",
  } });
const uid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function verifyPtgSystemAdmin(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization") ?? "";
  const sessionId = request.headers.get("x-ptg-session-id") ?? "";
  if (!auth.startsWith("Bearer ") || !uid.test(sessionId)) return null;
  const userClient = createClient(ptgUrl, ptgPublicKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error } = await userClient.auth.getUser(auth.slice(7));
  if (error || !verified.user) return null;
  const [row, profile] = await Promise.all([
    admin.from("app_sessions").select("user_id,session_version,last_activity_at,expires_at,revoked_at")
      .eq("id", sessionId).eq("user_id", verified.user.id).is("revoked_at", null).maybeSingle(),
    admin.from("user_profiles").select("role_key,is_active,must_change_password,session_version")
      .eq("id", verified.user.id).maybeSingle(),
  ]);
  if (row.error || profile.error || !row.data || !profile.data ||
    profile.data.role_key !== "SYSTEM_ADMIN" || !profile.data.is_active ||
    profile.data.must_change_password ||
    Number(row.data.session_version) !== Number(profile.data.session_version) ||
    Date.now() >= new Date(row.data.expires_at).getTime() ||
    Date.now() - new Date(row.data.last_activity_at).getTime() > 7 * 24 * 60 * 60 * 1000) return null;
  return verified.user.id;
}

type Attestation = {
  ok: boolean; user_id: string; full_name: string; login_id: string;
  email: string; sales_role: "manager" | "ps"; dealer_id: string;
  branch_code: string; ptg_access: "NONE" | "BRANCH_MANAGER" | "TEAM_LEADER";
  invitation_status: string;
};
Deno.serve(async req => {
  const origin = req.headers.get("origin") ?? "";
  if (!allowed.has(origin)) return new Response("Forbidden", { status: 403 });
  if (req.method === "OPTIONS") return respond(origin, 204, {});
  if (req.method !== "POST") return respond(origin, 405, { ok: false });
  try {
    const actorId = await verifyPtgSystemAdmin(req);
    if (!actorId) return respond(origin, 403, { ok: false, message: "PTG System Admin authorization required." });
    const body = await req.json() as Record<string, unknown>;
    const salesUserId = String(body.salesUserId ?? "");
    const salesToken = String(body.salesAdminAccessToken ?? "");
    if (!uid.test(salesUserId) || salesToken.length < 50 || salesToken.length > 8192)
      return respond(origin, 400, { ok: false, message: "Missing new Sales identity or administrator session." });
    const verify = await fetch(salesUrl + "/functions/v1/admin-create-user", {
      method: "POST",
      headers: { apikey: salesKey, Authorization: "Bearer " + salesToken,
        "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unified_attestation", user_id: salesUserId }),
    });
    if (!verify.ok) return respond(origin, 403, { ok: false,
      message: "Sales Tracker did not verify this new unified invitation." });
    const attestation = await verify.json() as Attestation;
    if (!attestation.ok || attestation.user_id !== salesUserId ||
      attestation.invitation_status !== "PREPARED" && attestation.invitation_status !== "LINKED" ||
      !uid.test(attestation.dealer_id) || !attestation.email ||
      !/^[A-Za-z0-9._-]{3,32}$/.test(attestation.login_id)) {
      return respond(origin, 409, { ok: false, message: "Sales identity attestation is incomplete." });
    }
    if (attestation.ptg_access === "NONE") return respond(origin, 400, {
      ok: false, message: "This invitation does not grant PTG access.",
    });
    const manager = attestation.sales_role === "manager" && attestation.ptg_access === "BRANCH_MANAGER";
    const leader = attestation.sales_role === "ps" && attestation.ptg_access === "TEAM_LEADER";
    if (!manager && !leader) return respond(origin, 403, { ok: false, message: "Incompatible Sales and PTG roles." });
    const code = attestation.branch_code.trim().toUpperCase();
    const { data: matchedBranches, error: branchError } = await admin.from("branches")
      .select("id,branch_code,status,operational_status").eq("branch_code", code);
    if (branchError || !matchedBranches || matchedBranches.length !== 1 ||
      matchedBranches[0].status !== "ACTIVE" || matchedBranches[0].operational_status !== "ON")
      return respond(origin, 409, { ok: false, message: "Branch code is not uniquely matched and active in PTG." });
    const branchId = matchedBranches[0].id as string;
    const { data: existing } = await admin.from("unified_identity_links")
      .select("ptg_user_id,status,sales_dealer_id,ptg_branch_id")
      .eq("sales_user_id", salesUserId).maybeSingle();
    if (existing) {
      if (existing.sales_dealer_id !== attestation.dealer_id || existing.ptg_branch_id !== branchId ||
          existing.status === "REVOKED")
        return respond(origin, 409, { ok: false, message: "Identity already linked or revoked." });
      return respond(origin, 200, { ok: true, ptgUserId: existing.ptg_user_id,
        invitationStatus: existing.status, created: false });
    }
    const username = attestation.login_id.trim().toUpperCase();
    const internalEmail = "ptg." + branchId.replace(/-/g, "") + "." + username.toLowerCase() +
      "@accounts.firstmegasaver.invalid";
    const password = Array.from(crypto.getRandomValues(new Uint8Array(32)),
      b => b.toString(16).padStart(2, "0")).join("") + "!7";
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: internalEmail, password, email_confirm: true,
      app_metadata: { application: "first-megasaver-ptg", identity_provider: "sales_tracker" },
    });
    if (createError || !created.user) return respond(origin, 409, {
      ok: false, message: "Could not create a new PTG-only shadow account. Review duplicate identities.",
    });
    const ptgUserId = created.user.id;
    const role = manager ? "BRANCH_ADMIN" : "BRANCH_USER";
    const legacyRole = manager ? "BRANCH MANAGER" : "TEAM LEADER";
    const { error: provisionError } = await admin.rpc("provision_ptg_user_profile", {
      p_user_id: ptgUserId, p_username: username,
      p_display_name: attestation.full_name, p_role_key: role,
      p_legacy_role: legacyRole, p_branch_id: branchId, p_auth_email: internalEmail,
    });
    if (provisionError) {
      await admin.auth.admin.deleteUser(ptgUserId);
      return respond(origin, 409, { ok: false, message: "PTG role/username could not be provisioned." });
    }
    const { error: linkError } = await admin.from("unified_identity_links").insert({
      sales_user_id: salesUserId, sales_dealer_id: attestation.dealer_id,
      sales_branch_code: code, ptg_user_id: ptgUserId, ptg_branch_id: branchId,
      ptg_role_key: role, status: "PENDING", linked_by_ptg_admin: actorId,
    });
    if (linkError) {
      await admin.auth.admin.deleteUser(ptgUserId);
      return respond(origin, 409, { ok: false, message: "Unified identity link conflicted; no invitation sent." });
    }
    return respond(origin, 201, { ok: true, ptgUserId, invitationStatus: "PENDING", created: true });
  } catch (error) {
    console.error("Unified PTG provisioning failed", error instanceof Error ? error.name : "unknown");
    return respond(origin, 503, { ok: false, message: "Unified provisioning is temporarily unavailable." });
  }
});
