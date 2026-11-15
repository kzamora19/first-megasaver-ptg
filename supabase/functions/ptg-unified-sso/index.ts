import { createClient } from "npm:@supabase/supabase-js@2";

const ptgUrl = Deno.env.get("SUPABASE_URL")!;
const ptgServiceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ptgPublicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const salesUrl = Deno.env.get("SALES_TRACKER_SUPABASE_URL") ?? "https://psoopubvdpwztzkdyifa.supabase.co";
const salesKey = Deno.env.get("SALES_TRACKER_PUBLISHABLE_KEY") ?? "sb_publishable_e_6K64Wul2fJEq2KiuvnTA_NmuaKqNm";
const allowed = new Set((Deno.env.get("PTG_ALLOWED_ORIGINS") ??
  "https://kzamora19.github.io,http://localhost:3000,http://127.0.0.1:3000").split(",").map(s => s.trim()));
const ptgAdmin = createClient(ptgUrl, ptgServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const reply = (origin: string, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin",
  } });

Deno.serve(async request => {
  const origin = request.headers.get("origin") ?? "";
  if (!allowed.has(origin)) return new Response("Forbidden", { status: 403 });
  if (request.method === "OPTIONS") return reply(origin, 204, {});
  if (request.method !== "POST") return reply(origin, 405, { ok: false });
  try {
    const input = await request.json() as Record<string, unknown>;
    const bearer = String(input.salesAccessToken ?? "");
    if (bearer.length < 50 || bearer.length > 8192)
      return reply(origin, 401, { ok: false, message: "Sign in to Sales Tracker first." });

    // A PUBLIC project key identifies the Sales Auth project. Supabase Auth
    // validates the actual signed JWT; a caller-supplied user ID is never
    // used as identity evidence.
    const sales = createClient(salesUrl, salesKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: "Bearer " + bearer } },
    });
    const { data: verified, error: authError } = await sales.auth.getUser(bearer);
    if (authError || !verified.user) return reply(origin, 401, { ok: false, message: "Sales Tracker session expired." });
    const { data: salesProfile, error: profileError } = await sales.from("profiles")
      .select("id,role,active,dealer_id,branch_id")
      .eq("id", verified.user.id).maybeSingle();
    if (profileError || !salesProfile?.active)
      return reply(origin, 403, { ok: false, message: "Sales Tracker account is inactive." });
    const { data: link, error: linkError } = await ptgAdmin.from("unified_identity_links")
      .select("ptg_user_id,ptg_branch_id,ptg_role_key,sales_dealer_id,sales_branch_code,status")
      .eq("sales_user_id", verified.user.id).maybeSingle();
    if (linkError || !link || link.status === "REVOKED")
      return reply(origin, 403, { ok: false, message: "No PTG access is linked to this Sales Tracker account." });
    if (salesProfile.dealer_id !== link.sales_dealer_id ||
       !((salesProfile.role === "manager" && link.ptg_role_key === "BRANCH_ADMIN") ||
         (salesProfile.role === "ps" && link.ptg_role_key === "BRANCH_USER")))
      return reply(origin, 403, { ok: false, message: "Application permissions no longer match." });
    // A branch assignment can be changed later by an administrator. Never
    // silently grant PTG access if Sales scope drifted from the original link.
    const { data: managerBranches, error: managerError } = salesProfile.role === "manager"
      ? await sales.from("manager_branches").select("branch_id")
          .eq("manager_id", verified.user.id).eq("dealer_id", salesProfile.dealer_id)
      : { data: null, error: null };
    if (managerError || (salesProfile.role === "manager" && managerBranches?.length !== 1))
      return reply(origin, 403, { ok: false, message: "Manager branch authorization changed." });
    const salesBranchId = salesProfile.role === "manager"
      ? managerBranches![0].branch_id : salesProfile.branch_id;
    const { data: salesBranches, error: salesBranchError } = await sales.from("branches")
      .select("id,code").eq("id", salesBranchId);
    if (salesBranchError || salesBranches?.length !== 1 ||
        String(salesBranches[0].code).toUpperCase() !== link.sales_branch_code)
      return reply(origin, 403, { ok: false, message: "Sales Tracker branch access changed." });
    const { data: ptgBranch } = await ptgAdmin.from("branches")
      .select("id,status,operational_status,branch_code").eq("id", link.ptg_branch_id).maybeSingle();
    if (!ptgBranch || ptgBranch.status !== "ACTIVE" || ptgBranch.operational_status !== "ON" ||
       ptgBranch.branch_code !== link.sales_branch_code)
      return reply(origin, 403, { ok: false, message: "PTG branch access is unavailable." });

    const { data: user, error: userError } = await ptgAdmin.auth.admin.getUserById(link.ptg_user_id);
    if (userError || !user.user?.email || !user.user.email.endsWith("@accounts.firstmegasaver.invalid"))
      return reply(origin, 403, { ok: false, message: "Linked PTG identity is not available." });
    const { data: profile, error: ptgError } = await ptgAdmin.from("user_profiles")
      .select("role_key,legacy_role,display_name,branch_id,is_active,invitation_status,session_version,must_change_password")
      .eq("id", link.ptg_user_id).maybeSingle();
    if (ptgError || !profile || profile.role_key !== link.ptg_role_key || profile.branch_id !== link.ptg_branch_id)
      return reply(origin, 403, { ok: false, message: "PTG role or branch does not match the unified grant." });
    if (link.status === "PENDING" && profile.invitation_status !== "PENDING")
      return reply(origin, 403, { ok: false, message: "Linked account activation is inconsistent." });
    if (link.status === "ACTIVE" && !profile.is_active)
      return reply(origin, 403, { ok: false, message: "PTG account has been disabled." });

    // No password is ever shared across projects. Admin-generated OTP is
    // exchanged server-side with the PTG Auth project to mint a native
    // PTG session only after the Sales JWT, scope and linked grant pass.
    const { data: magic, error: linkGenerationError } = await ptgAdmin.auth.admin.generateLink({
      type: "magiclink", email: user.user.email,
    });
    const tokenHash = magic.properties?.hashed_token;
    if (linkGenerationError || !tokenHash)
      return reply(origin, 503, { ok: false, message: "PTG identity exchange is unavailable." });
    const ptg = createClient(ptgUrl, ptgPublicKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { data: authenticated, error: exchangeError } = await ptg.auth.verifyOtp({
      token_hash: tokenHash, type: "magiclink",
    });
    if (exchangeError || !authenticated.session || authenticated.user?.id !== link.ptg_user_id)
      return reply(origin, 503, { ok: false, message: "PTG session exchange failed." });

    if (link.status === "PENDING") {
      const now = new Date().toISOString();
      const { error: activationError } = await ptgAdmin.from("user_profiles").update({
        is_active: true, must_change_password: false, invitation_status: "ACTIVATED",
        invitation_accepted_at: now, activated_at: now, updated_at: now,
      }).eq("id", link.ptg_user_id).eq("invitation_status", "PENDING");
      if (activationError) return reply(origin, 503, { ok: false, message: "PTG activation could not be completed." });
      const { error: markActiveError } = await ptgAdmin.from("unified_identity_links").update({
        status: "ACTIVE", activated_at: now,
      }).eq("sales_user_id", verified.user.id).eq("status", "PENDING");
      if (markActiveError) return reply(origin, 503, { ok: false, message: "Unified identity activation is incomplete." });
    }

    // Restrict unified sessions to a short lifetime until cross-project
    // revocation is implemented. Never inherit 7-day PTG remembered-device
    // permissions without fresh Sales identity validation.
    const now = new Date();
    const lifetimeMinutes = 30;
    const { data: appSession, error: sessionError } = await ptgAdmin.from("app_sessions").insert({
      user_id: link.ptg_user_id, branch_id: link.ptg_branch_id,
      session_version: profile.session_version, remember_device: false,
      device_label: String(request.headers.get("user-agent") ?? "Unified Branchline").slice(0, 200),
      last_activity_at: now.toISOString(),
      expires_at: new Date(now.getTime() + lifetimeMinutes * 60 * 1000).toISOString(),
    }).select("id").single();
    if (sessionError || !appSession) return reply(origin, 503, {
      ok: false, message: "PTG is unavailable or the unified session could not be established.",
    });
    return reply(origin, 200, {
      ok: true, account: {
        username: String(user.user.email.split("@")[0]),
        displayName: profile.display_name,
        role: profile.role_key, legacyRole: profile.legacy_role,
        branchCode: ptgBranch.branch_code, branchName: null,
        mustChangePassword: false,
      },
      appSessionId: appSession.id,
      authSession: {
        accessToken: authenticated.session.access_token,
        refreshToken: authenticated.session.refresh_token,
        expiresAt: authenticated.session.expires_at,
        expiresIn: authenticated.session.expires_in,
      },
      sessionPolicy: { idleTimeoutMinutes: 30, maxLifetimeMinutes: 30, rememberedDevice: false },
    });
  } catch (error) {
    console.error("Unified SSO exchange unavailable", error instanceof Error ? error.name : "unknown");
    return reply(origin, 503, { ok: false, message: "Unified sign-in is temporarily unavailable." });
  }
});
