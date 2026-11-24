import { createClient } from "npm:@supabase/supabase-js@2";

type Session = {
  id: string;
  userId: string;
  role: string;
  legacyRole: string;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  username: string;
  displayName: string;
  mustChangePassword: boolean;
};

const projectUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
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
    "Pragma": "no-cache",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-ptg-session-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  },
});

const genericLoginFailure = { ok: false, message: "Invalid username or password, or account unavailable." };

async function activeSession(request: Request, touchActivity: boolean): Promise<Session | { unavailable: string } | null> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const userClient = createClient(projectUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return null;

  const appSessionId = request.headers.get("x-ptg-session-id");
  if (!appSessionId || appSessionId.length > 100) return null;
  const { data: row, error: sessionError } = await admin.from("app_sessions")
    .select("id,user_id,branch_id,session_version,remember_device,last_activity_at,expires_at,revoked_at,revoke_reason")
    .eq("id", appSessionId)
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (sessionError || !row) return null;
  if (row.revoked_at) {
    return ["MASTER_SYSTEM", "MAINTENANCE_MODE", "BRANCH_OFF", "BRANCH_UNAVAILABLE"].includes(row.revoke_reason)
      ? { unavailable: row.revoke_reason } : null;
  }

  const now = Date.now();
  // A remembered device is explicitly opted in at password login. It may
  // restore the session across browser/app restarts for seven days, unless
  // revoked by the user, an administrator, or a branch/system security rule.
  const idleLimitMs = row.remember_device === true
    ? 7 * 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
  const idleExpired = now - new Date(row.last_activity_at).getTime() > idleLimitMs;
  const absoluteExpired = new Date(row.expires_at).getTime() <= now;
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("role_key,legacy_role,display_name,is_active,session_version,must_change_password")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (
    profileError || !profile || !profile.is_active ||
    Number(profile.session_version) !== Number(row.session_version) ||
    idleExpired || absoluteExpired
  ) {
    await admin.from("app_sessions").update({
      revoked_at: new Date().toISOString(),
      revoke_reason: "EXPIRED_OR_INVALID",
    }).eq("id", appSessionId).is("revoked_at", null);
    return null;
  }

  let branchCode: string | null = null;
  let branchName: string | null = null;
  if (row.branch_id) {
    const { data: branch } = await admin.from("branches")
      .select("branch_code,branch_name,status,operational_status")
      .eq("id", row.branch_id)
      .maybeSingle();
    if (!branch || branch.status !== "ACTIVE" || branch.operational_status !== "ON") {
      await admin.from("app_sessions").update({
        revoked_at: new Date().toISOString(),
        revoke_reason: "BRANCH_UNAVAILABLE",
      }).eq("id", appSessionId).is("revoked_at", null);
      return { unavailable: "BRANCH_OFF" };
    }
    branchCode = branch.branch_code;
    branchName = branch.branch_name;
  }

  if (touchActivity) {
    await admin.from("app_sessions").update({ last_activity_at: new Date().toISOString() })
      .eq("id", appSessionId).is("revoked_at", null);
  }
  const { data: username } = await admin.rpc("get_ptg_login_username", { p_user_id: authData.user.id });
  return {
    id: row.id,
    userId: authData.user.id,
    role: profile.role_key,
    legacyRole: profile.legacy_role ?? "",
    branchId: row.branch_id,
    branchCode,
    branchName,
    username: typeof username === "string" ? username : "",
    displayName: profile.display_name ?? "",
    mustChangePassword: profile.must_change_password === true,
  };
}

async function login(body: Record<string, unknown>, request: Request, origin: string) {
  const username = String(body.username ?? "").trim().toUpperCase();
  const password = String(body.password ?? "");
  const branchCode = String(body.branchCode ?? "").trim().toUpperCase() || undefined;
  if (!username || !password || username.length > 120 || password.length > 1024) {
    return json(origin, { ok: false, message: "Username and password are required." }, 400);
  }

  async function recordLogin(outcome: "SUCCESS" | "DENIED", message: string, identity?: {
    auth_user_id: string; branch_id: string | null; role_key: string;
  }) {
    const { error } = await admin.from("security_audit_logs").insert({
      actor_user_id: identity?.auth_user_id ?? null,
      branch_id: identity?.branch_id ?? null,
      event_category: "AUTHENTICATION",
      action: "LOGIN",
      target_identifier: username,
      outcome,
      message,
      metadata: { username, role: identity?.role_key ?? "SYSTEM" },
    });
    if (error) console.error("Unable to record PTG login audit event.", error.code);
  }

  const { data: identities, error: identityError } = await admin.rpc("resolve_ptg_login_identity", {
    p_username: username,
    p_branch_code: branchCode ?? null,
  });
  if (identityError) return json(origin, { ok: false, message: "Authentication service is temporarily unavailable." }, 503);
  if (!Array.isArray(identities) || identities.length !== 1) {
    await recordLogin("DENIED", "Username did not resolve to one account.");
    return json(origin, genericLoginFailure, 401);
  }

  const identity = identities[0];
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("legacy_role,must_change_password")
    .eq("id", identity.auth_user_id)
    .maybeSingle();
  if (profileError || !profile) {
    return json(origin, { ok: false, message: "Authentication service is temporarily unavailable." }, 503);
  }
  if (!identity.is_active) {
    await recordLogin("DENIED", "Account disabled.", identity);
    return json(origin, genericLoginFailure, 401);
  }
  if (identity.account_scope === "BRANCH" && !identity.branch_id) return json(origin, genericLoginFailure, 401);
  if (identity.locked_until && new Date(identity.locked_until).getTime() > Date.now()) {
    await recordLogin("DENIED", "Account temporarily locked.", identity);
    return json(origin, genericLoginFailure, 401);
  }

  const authClient = createClient(projectUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({
    email: identity.auth_email,
    password,
  });
  if (error || !data.user || !data.session) {
    await admin.rpc("record_ptg_login_failure", { p_user_id: identity.auth_user_id });
    await recordLogin("DENIED", "Invalid credentials.", identity);
    return json(origin, genericLoginFailure, 401);
  }

  await admin.rpc("clear_ptg_login_failures", { p_user_id: identity.auth_user_id });
  const rememberDevice = body.rememberMe === true;
  const maxLifetimeMinutes = rememberDevice ? 7 * 24 * 60 : 8 * 60;
  const idleTimeoutMinutes = rememberDevice ? 7 * 24 * 60 : 30;
  const expiresAt = new Date(Date.now() + maxLifetimeMinutes * 60 * 1000).toISOString();
  const { data: appSession, error: sessionError } = await admin.from("app_sessions").insert({
    user_id: identity.auth_user_id,
    branch_id: identity.branch_id,
    session_version: identity.session_version,
    remember_device: rememberDevice,
    device_label: String(request.headers.get("user-agent") ?? "Browser").slice(0, 200),
    last_activity_at: new Date().toISOString(),
    expires_at: expiresAt,
  }).select("id").single();
  if (sessionError || !appSession) {
    await authClient.auth.signOut({ scope: "local" });
    const availabilityMessages: Record<string, string> = {
      PTG_SYSTEM_OFF: "The Price Tag Generator is temporarily unavailable.",
      PTG_MAINTENANCE: "The Price Tag Generator is temporarily unavailable for maintenance.",
      PTG_BRANCH_OFF: "Your branch is currently offline.",
    };
    const reason = sessionError?.message ?? "";
    const availabilityMessage = availabilityMessages[reason];
    const availability = reason === "PTG_SYSTEM_OFF" ? "MASTER_SYSTEM" : reason === "PTG_MAINTENANCE" ? "MAINTENANCE_MODE" : reason === "PTG_BRANCH_OFF" ? "BRANCH_OFF" : undefined;
    await recordLogin("DENIED", availabilityMessage ?? "Unable to establish application session.", identity);
    return json(origin, { ok: false, availability, message: availabilityMessage ?? "Unable to establish a secure application session." }, 503);
  }

  await recordLogin("SUCCESS", "Sign-in successful.", identity);
  return json(origin, {
    ok: true,
    account: {
      username: identity.username,
      displayName: identity.display_name,
      role: identity.role_key,
      legacyRole: profile.legacy_role ?? "",
      branchCode: identity.branch_code,
      branchName: identity.branch_name,
      mustChangePassword: profile.must_change_password === true,
    },
    appSessionId: appSession.id,
    authSession: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn: data.session.expires_in,
      expiresAt: data.session.expires_at,
    },
    sessionPolicy: { idleTimeoutMinutes, maxLifetimeMinutes, rememberedDevice: rememberDevice },
  });
}

// Separate from username/password sign-in: this endpoint does not accept
// an unverified email, user_metadata claim, or a Sales-side browser token.
async function ssoSession(body: Record<string, unknown>, request: Request, origin: string) {
  if (Deno.env.get("PTG_UNIFIED_SSO_ENABLED") !== "true") {
    return json(origin, { ok: false, message: "Unified sign-in is not yet enabled." }, 503);
  }
  const bearer = request.headers.get("authorization") ?? "";
  if (!/^Bearer [A-Za-z0-9._~-]+$/.test(bearer)) {
    return json(origin, { ok: false, message: "A verified PTG OIDC session is required." }, 401);
  }
  const jwt = bearer.slice(7);
  const { data: authData, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !authData.user?.id || !authData.user.email) {
    return json(origin, { ok: false, message: "The SSO session could not be verified." }, 401);
  }
  const user = authData.user;
  const authEmail = user.email?.trim().toLowerCase() || "";
  if (!authEmail) return json(origin, { ok: false, message: "A verified email is required." }, 403);
  // These identities are supplied by Supabase Auth's verified OIDC provider,
  // not by changeable user_metadata fields or a client-supplied central UUID.
  const { data: detailed, error: identityError } = await admin.auth.admin.getUserById(user.id);
  if (identityError || !detailed.user) {
    return json(origin, { ok: false, message: "Could not verify the trusted identity provider." }, 401);
  }
  const identity = detailed.user.identities?.find(item => item.provider === "custom:branchline");
  const centralId = identity && typeof identity.identity_data?.sub === "string"
    ? identity.identity_data.sub : "";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(centralId)) {
    return json(origin, { ok: false, message: "A verified Branchline identity is required." }, 403);
  }
  const { data: grant, error: grantError } = await admin.from("ptg_unified_sso_grants")
    .select("sales_user_id,ptg_user_id,expected_email,username,display_name,role_key,legacy_role,branch_id,is_active,approved_at")
    .eq("sales_user_id", centralId).eq("is_active", true).maybeSingle();
  if (grantError) return json(origin, { ok: false, message: "Unified sign-in grants are temporarily unavailable." }, 503);
  if (!grant || !grant.approved_at || grant.expected_email !== authEmail ||
      (grant.ptg_user_id && grant.ptg_user_id !== user.id)) {
    return json(origin, { ok: false, message: "No approved PTG entitlement was found for this account." }, 403);
  }
  const { data: branch, error: branchError } = await admin.from("branches")
    .select("branch_code,branch_name,status,operational_status")
    .eq("id", grant.branch_id).maybeSingle();
  if (branchError || !branch || branch.status !== "ACTIVE" || branch.operational_status !== "ON") {
    return json(origin, { ok: false, message: "PTG is not currently available for this branch." }, 403);
  }
  const { data: existingProfile, error: profileError } = await admin.from("user_profiles")
    .select("role_key,legacy_role,branch_id,is_active,must_change_password,session_version")
    .eq("id", user.id).maybeSingle();
  if (profileError) return json(origin, { ok: false, message: "PTG profile lookup failed." }, 503);

  // Never automatically link or alter an existing PTG password account.
  // A profile with no explicitly bound entitlement is treated as legacy.
  if (existingProfile && grant.ptg_user_id !== user.id) {
    return json(origin, { ok: false, message: "Existing PTG accounts require manual migration." }, 403);
  }
  if (!existingProfile) {
    if (Deno.env.get("PTG_UNIFIED_SSO_PROVISION_ENABLED") !== "true") {
      return json(origin, { ok: false, message: "Your PTG access has not yet been provisioned." }, 403);
    }
    if (!grant.ptg_user_id) {
      const { data: claimed, error: claimError } = await admin.from("ptg_unified_sso_grants")
        .update({ ptg_user_id: user.id, updated_at: new Date().toISOString() })
        .eq("sales_user_id", centralId).eq("is_active", true)
        .is("ptg_user_id", null).select("sales_user_id").maybeSingle();
      if (claimError || !claimed) {
        return json(origin, { ok: false, message: "This identity is being linked. Try again." }, 409);
      }
    }
    const { error: createdError } = await admin.rpc("provision_ptg_user_profile", {
      p_user_id: user.id, p_username: grant.username,
      p_display_name: grant.display_name, p_role_key: grant.role_key,
      p_legacy_role: grant.legacy_role, p_branch_id: grant.branch_id,
      p_auth_email: authEmail,
    });
    if (createdError) {
      return json(origin, { ok: false, message: "PTG account provisioning needs administrator review." }, 503);
    }
    const now = new Date().toISOString();
    const { error: activationError } = await admin.from("user_profiles")
      .update({ must_change_password: false, invitation_status: "ACTIVATED",
        activated_at: now, updated_at: now }).eq("id", user.id);
    if (activationError) return json(origin, { ok: false, message: "PTG activation needs administrator review." }, 503);
  }

  const { data: profile, error: finalError } = await admin.from("user_profiles")
    .select("role_key,legacy_role,branch_id,is_active,must_change_password,session_version")
    .eq("id", user.id).single();
  if (finalError || !profile?.is_active ||
      profile.role_key !== grant.role_key || profile.legacy_role !== grant.legacy_role ||
      profile.branch_id !== grant.branch_id || profile.must_change_password) {
    return json(origin, { ok: false, message: "PTG access is inactive or does not match its approved grant." }, 403);
  }
  const remember = body.rememberMe === true;
  const lifetimeMinutes = remember ? 7 * 24 * 60 : 8 * 60;
  const now = new Date();
  const { data: appSession, error: sessionError } = await admin.from("app_sessions")
    .insert({
      user_id: user.id, branch_id: grant.branch_id,
      session_version: profile.session_version, remember_device: remember,
      device_label: (request.headers.get("user-agent") ?? "Browser").slice(0, 200),
      last_activity_at: now.toISOString(),
      expires_at: new Date(now.getTime() + lifetimeMinutes * 60_000).toISOString(),
    }).select("id").single();
  if (sessionError || !appSession) {
    return json(origin, { ok: false, message: "PTG security controls did not permit this session." }, 503);
  }
  // A confirmed, active session never needs to return credentials to the
  // browser: the PTG Auth refresh token is already held by Supabase PKCE.
  await admin.from("security_audit_logs").insert({
    actor_user_id: user.id, branch_id: grant.branch_id,
    event_category: "AUTHENTICATION", action: "LOGIN",
    target_identifier: grant.username, outcome: "SUCCESS",
    message: "Verified Branchline OIDC sign-in.",
    metadata: { method: "OIDC", provider: "custom:branchline" },
  });
  return json(origin, {
    ok: true, appSessionId: appSession.id,
    account: { username: grant.username, displayName: grant.display_name,
      role: grant.role_key, legacyRole: grant.legacy_role,
      branchCode: branch.branch_code, branchName: branch.branch_name,
      mustChangePassword: false },
    sessionPolicy: { idleTimeoutMinutes: remember ? 10080 : 30,
      maxLifetimeMinutes: lifetimeMinutes, rememberedDevice: remember },
  });
}

Deno.serve(async request => {
  const origin = request.headers.get("origin") ?? "";
  if (!origin || !allowedOrigins.has(origin)) {
    return new Response(JSON.stringify({ ok: false, message: "Request origin is not allowed." }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-ptg-session-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  } });
  if (request.method !== "POST") return json(origin, { ok: false, message: "Method not allowed." }, 405);

  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (action === "login") return await login(body, request, origin);
    if (action === "sso-session") return await ssoSession(body, request, origin);

    const session = await activeSession(request, action !== "session-status");
    if (!session) return json(origin, { ok: false, message: "Please sign in again." }, 401);

    if ("unavailable" in session) return json(origin, { ok: false, availability: session.unavailable, message: "PTG is temporarily unavailable." }, 401);
    // Read-only status polls return the freshly verified account without touching idle activity.
    if (action === "session-status" || action === "session") {
      return json(origin, { ok: true, account: {
        username: session.username,
        displayName: session.displayName,
        role: session.role,
        legacyRole: session.legacyRole,
        branchCode: session.branchCode,
        branchName: session.branchName,
        mustChangePassword: session.mustChangePassword,
      } });
    }
    if (action === "logout") {
      await admin.from("app_sessions").update({
        revoked_at: new Date().toISOString(),
        revoke_reason: "USER_LOGOUT",
      }).eq("id", session.id).is("revoked_at", null);
      return json(origin, { ok: true });
    }
    if (action === "change-password") {
      if (session.role !== "SYSTEM_ADMIN" && session.role !== "BRANCH_ADMIN") {
        return json(origin, { ok: false, message: "Your administrator manages your PTG password." }, 403);
      }
      const password = String(body.password ?? "");
      const confirmPassword = String(body.confirmPassword ?? "");
      if (password.length < 12 || password.length > 1024) {
        return json(origin, { ok: false, message: "Password must be at least 12 characters." }, 400);
      }
      if (password !== confirmPassword) return json(origin, { ok: false, message: "Passwords do not match." }, 400);
      // The Edge Function has a verified bearer token, but no locally stored Auth session.
      const response = await fetch(projectUrl + "/auth/v1/user", {
        method: "PUT",
        headers: {
          apikey: publicKey,
          Authorization: request.headers.get("authorization")!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        const code = problem.error_code ?? problem.code;
        const message = code === "same_password" ? "Choose a password different from your current password."
          : code === "weak_password" ? "Choose a stronger password and try again."
          : code === "reauthentication_needed" || response.status === 401 ? "Sign in again before changing your password."
          : "Unable to update password. Please try again.";
        return json(origin, { ok: false, message }, response.status >= 500 ? 503 : 400);
      }
      const now = new Date().toISOString();
      const { error: profileError } = await admin.from("user_profiles").update({
        must_change_password: false,
        invitation_status: "ACTIVATED",
        activated_at: now,
        updated_at: now,
      }).eq("id", session.userId);
      if (profileError) return json(origin, {
        ok: false,
        message: "Password changed, but account setup could not be finalized. Contact your System Admin.",
      }, 503);
      await admin.from("security_audit_logs").insert({
        actor_user_id: session.userId,
        branch_id: session.branchId,
        event_category: "ACCOUNT_SECURITY",
        action: "CHANGE_INITIAL_PASSWORD",
        target_identifier: session.username,
        outcome: "SUCCESS",
        message: "User completed required initial password change.",
      });
      return json(origin, { ok: true });
    }
    return json(origin, { ok: false, message: "Unknown authentication action." }, 400);
  } catch {
    return json(origin, { ok: false, message: "Authentication service is temporarily unavailable." }, 503);
  }
});
