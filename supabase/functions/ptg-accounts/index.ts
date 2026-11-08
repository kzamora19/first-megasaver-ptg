import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@10.3.1";

const projectUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const gmailUser = Deno.env.get("GMAIL_USER")?.trim() ?? "";
const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD")?.replace(/\s+/g, "") ?? "";
const appUrl = (Deno.env.get("PTG_APP_URL") ?? "https://kzamora19.github.io/first-megasaver-ptg").replace(/\/+$/, "");
const allowedOrigins = new Set(
  (Deno.env.get("PTG_ALLOWED_ORIGINS") ?? "https://kzamora19.github.io,http://localhost:3000,http://127.0.0.1:3000")
    .split(",").map(value => value.trim()).filter(Boolean),
);
const admin = createClient(projectUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const json = (origin: string, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-ptg-session-id",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Vary": "Origin",
  },
});
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
const randomToken = (bytes = 32) => {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const sha256 = async (v: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))).map(x => x.toString(16).padStart(2, "0")).join("");
const respondError = (origin: string, error: unknown) => {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return json(origin, { ok: false }, 401);
  if (code === "PERMISSION_DENIED") return json(origin, { ok: false, message: "You are not authorized to perform this action." }, 403);
  if (code === "EMAIL_PROVIDER_NOT_CONFIGURED") return json(origin, { ok: false, message: "Gmail email delivery is not configured in Supabase yet." }, 503);
  if (code === "EMAIL_DELIVERY_FAILED") return json(origin, { ok: false, message: "The email could not be delivered. Verify the Gmail account and app password settings, then retry." }, 502);
  if (code === "LAST_ADMIN") return json(origin, { ok: false, message: "The last active System Admin cannot be disabled." }, 400);
  return json(origin, { ok: false, message: "The account operation could not be completed." }, 400);
};

type Session = { id: string; userId: string; role: string; branchId: string | null; mustChangePassword: boolean; };
async function getSession(request: Request): Promise<Session | null> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const userClient = createClient(projectUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return null;
  const id = request.headers.get("x-ptg-session-id");
  if (!id || id.length > 100) return null;
  const { data: row, error } = await admin.from("app_sessions")
    .select("id,user_id,branch_id,session_version,last_activity_at,expires_at,revoked_at")
    .eq("id", id).eq("user_id", authData.user.id).is("revoked_at", null).maybeSingle();
  if (error || !row) return null;
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("role_key,is_active,session_version,must_change_password")
    .eq("id", authData.user.id).maybeSingle();
  const expired = Date.now() - new Date(row.last_activity_at).getTime() > 30 * 60 * 1000 || new Date(row.expires_at).getTime() <= Date.now();
  if (profileError || !profile || !profile.is_active || Number(profile.session_version) !== Number(row.session_version) || expired) return null;
  if (row.branch_id) {
    const { data: branch } = await admin.from("branches").select("status,operational_status").eq("id", row.branch_id).maybeSingle();
    if (!branch || branch.status !== "ACTIVE" || branch.operational_status !== "ON") return null;
  }
  await admin.from("app_sessions").update({ last_activity_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null);
  return { id: row.id, userId: authData.user.id, role: profile.role_key, branchId: row.branch_id, mustChangePassword: profile.must_change_password === true };
}

async function requirePermission(session: Session, permissionKey: string, action: "VIEW" | "EXECUTE", targetBranchId?: string | null) {
  if (session.mustChangePassword) throw new Error("PERMISSION_DENIED");
  const { data: permission, error } = await admin.from("role_permissions").select("access_level")
    .eq("role_key", session.role).eq("permission_key", permissionKey).maybeSingle();
  if (error || !permission) throw new Error("PERMISSION_DENIED");
  const access = String(permission.access_level);
  let allowed = access === "FULL";
  if (access === "VIEW" || access === "LIMITED") allowed = action === "VIEW";
  if (access === "OWN_BRANCH") allowed = !!session.branchId && !!targetBranchId && session.branchId === targetBranchId;
  if (!allowed) {
    await admin.from("security_audit_logs").insert({
      actor_user_id: session.userId, branch_id: session.branchId, event_category: "AUTHORIZATION",
      action, target_identifier: permissionKey, outcome: "DENIED", message: "Administrative permission denied.",
      metadata: { role: session.role, targetBranchId: targetBranchId ?? null },
    });
    throw new Error("PERMISSION_DENIED");
  }
}

async function audit(session: Session | null, branchId: string | null, action: string, target: string, message: string, metadata: Record<string, unknown> = {}) {
  const { error } = await admin.from("security_audit_logs").insert({
    actor_user_id: session?.userId ?? null, branch_id: branchId, event_category: "ACCOUNT_ADMINISTRATION",
    action, target_identifier: target, outcome: "SUCCESS", message, metadata,
  });
  if (error) throw new Error("AUDIT_WRITE_FAILED");
}
async function sendEmail(input: { to: string; subject: string; text: string; html: string }) {
  if (!gmailUser || !gmailPassword) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPassword },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  try {
    const result = await transport.sendMail({
      from: "First Megasaver PTG <" + gmailUser + ">",
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    if (!result.messageId || result.rejected.length) throw new Error("EMAIL_DELIVERY_FAILED");
    return result.messageId;
  } catch {
    throw new Error("EMAIL_DELIVERY_FAILED");
  } finally {
    transport.close();
  }
}
function inviteEmail(name: string, username: string, password: string, acceptUrl: string) {
  const safeName = escapeHtml(name), safeUser = escapeHtml(username), safePass = escapeHtml(password), safeUrl = escapeHtml(acceptUrl);
  const login = appUrl + "/login";
  const text = "Hello " + name + ",\n\nYour First Megasaver PTG account has been created.\n\nUsername: " + username +
    "\nTemporary password: " + password + "\n\nAccept your invitation: " + acceptUrl +
    "\n\nAfter accepting, sign in and change your temporary password.\n\nLogin: " + login + "\n\nThis invitation expires in 48 hours.";
  const html = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033;line-height:1.6"><h2>First Megasaver · Price Tag Generator</h2><p>Hello ' +
    safeName + ', your account has been created.</p><p><b>Username:</b> ' + safeUser + '<br><b>Temporary password:</b> <code>' + safePass +
    '</code></p><p><a href="' + safeUrl + '">Accept invitation</a></p><p>After accepting, sign in and change your temporary password.</p><p><a href="' +
    escapeHtml(login) + '">Open PTG</a></p><p>This invitation expires in 48 hours.</p></div>';
  return { to: "", subject: "Your First Megasaver PTG account invitation", text, html };
}
async function sendInvitation(email: string, displayName: string, username: string, password: string, token: string) {
  const acceptUrl = appUrl + "/invitation/accept?token=" + encodeURIComponent(token);
  const mail = inviteEmail(displayName, username, password, acceptUrl); mail.to = email;
  return sendEmail(mail);
}
async function sendReset(email: string, displayName: string, username: string, password: string) {
  const loginUrl = appUrl + "/login";
  const safeName = escapeHtml(displayName), safeUser = escapeHtml(username), safePass = escapeHtml(password), safeLogin = escapeHtml(loginUrl);
  const text = "Hello " + displayName + ",\n\nYour PTG password has been reset.\nUsername: " + username +
    "\nTemporary password: " + password + "\n\nSign in at " + loginUrl + " and change the temporary password.";
  const html = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033;line-height:1.6"><h2>First Megasaver PTG</h2><p>Hello ' +
    safeName + ', your password has been reset.</p><p><b>Username:</b> ' + safeUser + '<br><b>Temporary password:</b> <code>' + safePass +
    '</code></p><p><a href="' + safeLogin + '">Sign in and change your password</a></p></div>';
  return sendEmail({ to: email, subject: "Your First Megasaver PTG temporary password", text, html });
}
async function usernameFor(userId: string) {
  const { data } = await admin.rpc("get_ptg_login_username", { p_user_id: userId });
  return typeof data === "string" ? data : "";
}
async function getTarget(userId: string) {
  const { data, error } = await admin.from("user_profiles")
    .select("id,display_name,role_key,legacy_role,branch_id,email,is_active,invitation_status,invitation_expires_at")
    .eq("id", userId).maybeSingle();
  if (error || !data) throw new Error("ACCOUNT_NOT_FOUND");
  return data;
}

async function listAccounts(request: Request, session: Session, origin: string) {
  const url = new URL(request.url);
  const branchFilter = session.role === "BRANCH_ADMIN" ? session.branchId : url.searchParams.get("branchId");
  await requirePermission(session, session.role === "SYSTEM_ADMIN" ? "SYSTEM_ADMIN_ACCOUNT_MANAGEMENT" : "BRANCH_USER_ACCOUNT_MANAGEMENT", "VIEW", branchFilter);
  let query = admin.from("user_profiles")
    .select("id,display_name,role_key,legacy_role,branch_id,email,invitation_status,invited_at,invitation_expires_at,invitation_accepted_at,activated_at,is_active,failed_login_attempts,locked_until,must_change_password,created_at,updated_at")
    .order("display_name");
  if (session.role === "BRANCH_ADMIN") query = query.eq("branch_id", session.branchId);
  else if (branchFilter) query = query.eq("branch_id", branchFilter);
  const { data, error } = await query;
  if (error) throw error;
  let branches: unknown[] = [];
  if (session.role === "SYSTEM_ADMIN") {
    const result = await admin.from("branches").select("id,branch_code,branch_name,status,operational_status").order("branch_code");
    branches = result.data ?? [];
  } else if (session.role === "BRANCH_ADMIN" && session.branchId) {
    const result = await admin.from("branches").select("id,branch_code,branch_name,status,operational_status").eq("id", session.branchId);
    branches = result.data ?? [];
  }
  const accounts = (data ?? []).map(a => a.invitation_status === "SENT" && a.invitation_expires_at && new Date(a.invitation_expires_at).getTime() <= Date.now() ? { ...a, invitation_status: "EXPIRED" } : a);
  return json(origin, { ok: true, accounts, branches });
}

async function createAccount(request: Request, session: Session, origin: string, body: Record<string, unknown>) {
  const username = clean(body.username, 32).toUpperCase();
  const displayName = clean(body.displayName, 120);
  const email = clean(body.email, 254).toLowerCase();
  const role = clean(body.role, 40).toUpperCase();
  const legacyRole = clean(body.legacyRole ?? role.replaceAll("_", " "), 80).toUpperCase();
  const branchId = body.branchId ? clean(body.branchId, 64) : null;
  if (!/^[A-Z0-9._-]{3,32}$/.test(username) || !displayName || !/^\S+@\S+\.\S+$/.test(email)) return json(origin, { ok: false, message: "Enter a valid username, full name, and employee email address." }, 400);
  if (!["SYSTEM_ADMIN", "BRANCH_ADMIN", "BRANCH_USER"].includes(role)) return json(origin, { ok: false, message: "Invalid application role." }, 400);
  if (role.startsWith("BRANCH_") !== !!branchId) return json(origin, { ok: false, message: "Select a branch for branch accounts only." }, 400);
  if (role === "BRANCH_USER" && !["BRANCH USER", "TEAM LEADER"].includes(legacyRole)) return json(origin, { ok: false, message: "Invalid branch account title." }, 400);
  if (role === "BRANCH_ADMIN" && !["BRANCH ADMIN", "BRANCH MANAGER"].includes(legacyRole)) return json(origin, { ok: false, message: "Invalid Branch Admin title." }, 400);
  await requirePermission(session, role === "SYSTEM_ADMIN" ? "SYSTEM_ADMIN_ACCOUNT_MANAGEMENT" : "BRANCH_USER_ACCOUNT_MANAGEMENT", "EXECUTE", branchId);
  if (role === "SYSTEM_ADMIN" && session.role !== "SYSTEM_ADMIN") throw new Error("PERMISSION_DENIED");
  if (session.role === "BRANCH_ADMIN" && role !== "BRANCH_USER") throw new Error("PERMISSION_DENIED");
  if (branchId) {
    const { data: branch } = await admin.from("branches").select("id,status,operational_status").eq("id", branchId).maybeSingle();
    if (!branch || branch.status !== "ACTIVE" || branch.operational_status !== "ON") return json(origin, { ok: false, message: "The selected branch is not active." }, 400);
  }
  if (!resendKey || !resendFrom) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  const authEmail = role === "SYSTEM_ADMIN"
    ? "ptg.system." + username.toLowerCase() + "@accounts.firstmegasaver.invalid"
    : "ptg." + String(branchId).replace(/-/g, "") + "." + username.toLowerCase() + "@accounts.firstmegasaver.invalid";
  const password = randomToken(24);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: authEmail, password, email_confirm: true, user_metadata: { display_name: displayName }, app_metadata: { application: "first-megasaver-ptg" },
  });
  if (createError || !created.user) throw new Error("ACCOUNT_CREATE_FAILED");
  const userId = created.user.id;
  const { error: provisionError } = await admin.rpc("provision_ptg_user_profile", {
    p_user_id: userId, p_username: username, p_display_name: displayName, p_role_key: role,
    p_legacy_role: legacyRole, p_branch_id: branchId, p_auth_email: authEmail,
  });
  if (provisionError) { await admin.auth.admin.deleteUser(userId); throw new Error("ACCOUNT_CREATE_FAILED"); }
  const now = new Date().toISOString(), expires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), token = randomToken();
  const { error: profileError } = await admin.from("user_profiles").update({
    email, invitation_status: "SENT", invited_at: now, invitation_expires_at: expires, is_active: false, must_change_password: true,
  }).eq("id", userId);
  const tokenHash = await sha256(token);
  const { error: tokenError } = await admin.schema("private").from("account_invitations").insert({ user_id: userId, token_hash: tokenHash, expires_at: expires });
  if (profileError || tokenError) { await admin.auth.admin.deleteUser(userId); throw new Error("ACCOUNT_CREATE_FAILED"); }
  try {
    const emailId = await sendInvitation(email, displayName, username, password, token);
    await audit(session, branchId, "CREATE_ACCOUNT_INVITATION", username, "Invitation emailed; account remains inactive until acceptance and initial password change.", { role, legacyRole, email, emailId, expires });
    return json(origin, { ok: true, account: { id: userId, username, displayName, email, role, legacyRole, branchId, invitationStatus: "SENT", expiresAt: expires } }, 201);
  } catch (error) {
    await admin.auth.admin.deleteUser(userId);
    throw error;
  }
}

async function updateAccount(request: Request, session: Session, origin: string, body: Record<string, unknown>) {
  const userId = new URL(request.url).searchParams.get("userId") ?? "";
  if (!userId || userId.length > 100) return json(origin, { ok: false, message: "Account not found." }, 404);
  const target = await getTarget(userId);
  const action = clean(body.action, 40).toUpperCase();
  if (session.role === "BRANCH_ADMIN" && target.role_key !== "BRANCH_USER") throw new Error("PERMISSION_DENIED");
  if (action === "RESET_PASSWORD") {
    if (target.role_key === "SYSTEM_ADMIN" || !target.email) throw new Error("PERMISSION_DENIED");
    await requirePermission(session, "PASSWORD_RESET", "EXECUTE", target.branch_id);
    const temporary = randomToken(24);
    const { error } = await admin.auth.admin.updateUserById(userId, { password: temporary });
    if (error) throw new Error("PASSWORD_UPDATE_FAILED");
    const { error: stateError } = await admin.rpc("reset_ptg_user_password_state", { p_user_id: userId });
    if (stateError) throw new Error("PASSWORD_UPDATE_FAILED");
    const emailId = await sendReset(target.email, target.display_name, await usernameFor(userId), temporary);
    await audit(session, target.branch_id, "RESET_PASSWORD", userId, "Random temporary password emailed; user must change it on next sign-in.", { role: target.role_key, email: target.email, emailId });
    return json(origin, { ok: true });
  }
  if (action === "SET_STATUS") {
    if (typeof body.enabled !== "boolean") return json(origin, { ok: false, message: "enabled must be true or false." }, 400);
    if (body.enabled && ["PENDING", "SENT"].includes(String(target.invitation_status))) throw new Error("PERMISSION_DENIED");
    await requirePermission(session, "USER_STATUS_CONTROL", "EXECUTE", target.branch_id);
    const { error } = await admin.rpc("set_ptg_user_status", { p_user_id: userId, p_enabled: body.enabled });
    if (error) {
      if (error.message.includes("last active SYSTEM ADMIN")) throw new Error("LAST_ADMIN");
      throw error;
    }
    await audit(session, target.branch_id, body.enabled ? "ENABLE_ACCOUNT" : "DISABLE_ACCOUNT", userId, body.enabled ? "Account enabled." : "Account disabled and sessions revoked.", { role: target.role_key });
    return json(origin, { ok: true });
  }
  if (action === "FORCE_LOGOUT") {
    await requirePermission(session, "FORCE_LOGOUT", "EXECUTE", target.branch_id);
    const { error } = await admin.rpc("bump_ptg_user_session_version", { p_user_id: userId });
    if (error) throw error;
    await audit(session, target.branch_id, "FORCE_LOGOUT", userId, "All active application sessions revoked.", { role: target.role_key });
    return json(origin, { ok: true });
  }
  return json(origin, { ok: false, message: "Unsupported account action." }, 400);
}

async function resendInvitation(userId: string, session: Session, origin: string) {
  const target = await getTarget(userId);
  if (!target.email || target.role_key === "SYSTEM_ADMIN" || (session.role === "BRANCH_ADMIN" && target.role_key !== "BRANCH_USER")) throw new Error("PERMISSION_DENIED");
  const permission = target.role_key === "BRANCH_USER" || target.role_key === "BRANCH_ADMIN" ? "BRANCH_USER_ACCOUNT_MANAGEMENT" : "SYSTEM_ADMIN_ACCOUNT_MANAGEMENT";
  await requirePermission(session, permission, "EXECUTE", target.branch_id);
  const username = await usernameFor(userId);
  if (!username) throw new Error("ACCOUNT_IDENTITY_NOT_FOUND");
  const password = randomToken(24), token = randomToken(), expires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), now = new Date().toISOString();
  const { error: passwordError } = await admin.auth.admin.updateUserById(userId, { password });
  if (passwordError) throw new Error("PASSWORD_UPDATE_FAILED");
  const { error: bumpError } = await admin.rpc("bump_ptg_user_session_version", { p_user_id: userId });
  if (bumpError) throw new Error("SESSION_REVOKE_FAILED");
  const { error: delError } = await admin.schema("private").from("account_invitations").delete().eq("user_id", userId).is("accepted_at", null);
  if (delError) throw new Error("INVITATION_UPDATE_FAILED");
  const { error: insError } = await admin.schema("private").from("account_invitations").insert({ user_id: userId, token_hash: await sha256(token), expires_at: expires });
  if (insError) throw new Error("INVITATION_UPDATE_FAILED");
  const { error: profileError } = await admin.from("user_profiles").update({
    is_active: false, must_change_password: true, invitation_status: "SENT", invited_at: now,
    invitation_expires_at: expires, invitation_accepted_at: null, activated_at: null, updated_at: now,
  }).eq("id", userId);
  if (profileError) throw new Error("INVITATION_UPDATE_FAILED");
  const emailId = await sendInvitation(target.email, target.display_name, username, password, token);
  await audit(session, target.branch_id, "RESEND_ACCOUNT_INVITATION", username, "New single-use invitation and temporary password emailed.", { email: target.email, emailId, expires });
  return json(origin, { ok: true, invitationStatus: "SENT" });
}

async function acceptInvitation(body: Record<string, unknown>, origin: string) {
  const token = String(body.token ?? "");
  if (token.length < 30 || token.length > 200) return json(origin, { ok: false, message: "This invitation is invalid or expired." }, 400);
  const hash = await sha256(token), now = new Date().toISOString();
  const { data: invite, error } = await admin.schema("private").from("account_invitations")
    .select("id,user_id,expires_at,accepted_at").eq("token_hash", hash).maybeSingle();
  if (error || !invite || invite.accepted_at || new Date(invite.expires_at).getTime() <= Date.now()) return json(origin, { ok: false, message: "This invitation is invalid, expired, or already used." }, 400);
  const { data: consumed, error: consumeError } = await admin.schema("private").from("account_invitations")
    .update({ accepted_at: now }).eq("id", invite.id).is("accepted_at", null).gt("expires_at", now).select("id").maybeSingle();
  if (consumeError || !consumed) return json(origin, { ok: false, message: "This invitation has already been used or expired." }, 409);
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .update({ is_active: true, invitation_status: "ACCEPTED", invitation_accepted_at: now, updated_at: now })
    .eq("id", invite.user_id).eq("invitation_status", "SENT").select("id").maybeSingle();
  if (profileError || !profile) return json(origin, { ok: false, message: "The invitation could not be activated. Contact your System Admin." }, 503);
  await admin.from("security_audit_logs").insert({ actor_user_id: null, event_category: "ACCOUNT_SECURITY", action: "ACCEPT_ACCOUNT_INVITATION", target_identifier: invite.user_id, outcome: "SUCCESS", message: "Employee accepted account invitation. Initial password change remains required." });
  return json(origin, { ok: true });
}

async function bootstrapStart(body: Record<string, unknown>, origin: string) {
  const expected = Deno.env.get("FIRST_ADMIN_SETUP_SECRET") ?? "";
  const candidate = String(body.setupSecret ?? "");
  const a = new TextEncoder().encode(candidate), b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a[i] ^ b[i];
  if (expected.length < 32) return json(origin, { ok: false, message: "First-admin setup is not configured in Supabase." }, 503);
  if (!candidate || candidate.length > 512 || diff !== 0) return json(origin, { ok: false, message: "Setup authorization was not accepted." }, 403);
  const code = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x => x.toString(16).padStart(2, "0")).join("").toUpperCase();
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { data, error } = await admin.rpc("issue_ptg_first_admin_bootstrap", { p_code_hash: await sha256(code), p_expires_at: expires });
  if (error) throw error;
  if (data !== true) return json(origin, { ok: false, message: "A System Admin account already exists. Bootstrap is permanently closed." }, 409);
  return json(origin, { ok: true, bootstrapCode: code, expiresAt: expires });
}
async function bootstrapFinish(body: Record<string, unknown>, origin: string) {
  const code = clean(body.bootstrapCode, 64).toUpperCase();
  const username = clean(body.username, 32).toUpperCase();
  const displayName = clean(body.displayName, 80);
  const password = String(body.password ?? "");
  if (!/^[A-F0-9]{64}$/.test(code)) return json(origin, { ok: false, message: "The one-time bootstrap code is invalid or expired." }, 400);
  if (!/^[A-Z0-9._-]{3,32}$/.test(username) || !displayName || password.length < 12 || password.length > 1024) return json(origin, { ok: false, message: "Enter a valid username, display name, and password of at least 12 characters." }, 400);
  const authEmail = "ptg.system." + username.toLowerCase() + "@accounts.firstmegasaver.invalid";
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: authEmail, password, email_confirm: true, user_metadata: { display_name: displayName }, app_metadata: { application: "first-megasaver-ptg" },
  });
  if (createError || !created.user) throw new Error("BOOTSTRAP_REJECTED");
  const { data, error } = await admin.rpc("bootstrap_ptg_first_system_admin", {
    p_user_id: created.user.id, p_username: username, p_display_name: displayName, p_auth_email: authEmail, p_code_hash: await sha256(code),
  });
  if (error || data !== true) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json(origin, { ok: false, message: "The first System Admin could not be created. The code may be expired, already used, or setup may already be complete." }, 400);
  }
  return json(origin, { ok: true, username }, 201);
}

Deno.serve(async request => {
  const origin = request.headers.get("origin") ?? "";
  if (!origin || !allowedOrigins.has(origin)) return new Response(JSON.stringify({ ok: false, message: "Request origin is not allowed." }), { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-ptg-session-id",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS", "Vary": "Origin",
  } });
  try {
    const path = new URL(request.url).searchParams;
    if (request.method === "GET") {
      const session = await getSession(request);
      if (!session) throw new Error("AUTH_REQUIRED");
      return await listAccounts(request, session, origin);
    }
    if (request.method === "PATCH") {
      const session = await getSession(request);
      if (!session) throw new Error("AUTH_REQUIRED");
      return await updateAccount(request, session, origin, await request.json() as Record<string, unknown>);
    }
    if (request.method !== "POST") return json(origin, { ok: false, message: "Method not allowed." }, 405);
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 40);
    if (action === "acceptInvitation") return await acceptInvitation(body, origin);
    if (action === "bootstrapStart") return await bootstrapStart(body, origin);
    if (action === "bootstrapFinish") return await bootstrapFinish(body, origin);
    const session = await getSession(request);
    if (!session) throw new Error("AUTH_REQUIRED");
    if (action === "createAccount") return await createAccount(request, session, origin, body);
    if (action === "resendInvitation") return await resendInvitation(clean(body.userId, 100), session, origin);
    return json(origin, { ok: false, message: "Unsupported account action." }, 400);
  } catch (error) {
    return respondError(origin, error);
  }
});
