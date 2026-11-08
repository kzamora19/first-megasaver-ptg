import { createClient } from "npm:@supabase/supabase-js@2";

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
const respond = (origin: string, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-ptg-session-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  },
});
const fail = (message: string) => ({ ok: false, message });
const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const MAX_ROWS = 10_000;

type ActiveSession = { id: string; userId: string; role: string; branchId: string | null; username: string; mustChangePassword: boolean };

async function getSession(request: Request): Promise<ActiveSession | null> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const client = createClient(projectUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return null;
  const appSessionId = request.headers.get("x-ptg-session-id");
  if (!appSessionId || appSessionId.length > 100) return null;
  const { data: row, error: rowError } = await admin.from("app_sessions")
    .select("id,user_id,branch_id,session_version,last_activity_at,expires_at,revoked_at")
    .eq("id", appSessionId).eq("user_id", authData.user.id).is("revoked_at", null).maybeSingle();
  if (rowError || !row) return null;
  const now = Date.now();
  const idleExpired = now - new Date(row.last_activity_at).getTime() > 30 * 60 * 1000;
  const absoluteExpired = new Date(row.expires_at).getTime() <= now;
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("role_key,is_active,session_version,must_change_password")
    .eq("id", authData.user.id).maybeSingle();
  if (profileError || !profile || !profile.is_active || Number(profile.session_version) !== Number(row.session_version) || idleExpired || absoluteExpired) {
    await admin.from("app_sessions").update({ revoked_at: new Date().toISOString(), revoke_reason: "EXPIRED_OR_INVALID" })
      .eq("id", appSessionId).is("revoked_at", null);
    return null;
  }
  if (row.branch_id) {
    const { data: branch } = await admin.from("branches").select("status,operational_status").eq("id", row.branch_id).maybeSingle();
    if (!branch || branch.status !== "ACTIVE" || branch.operational_status !== "ON") {
      await admin.from("app_sessions").update({ revoked_at: new Date().toISOString(), revoke_reason: "BRANCH_UNAVAILABLE" })
        .eq("id", appSessionId).is("revoked_at", null);
      return null;
    }
  }
  await admin.from("app_sessions").update({ last_activity_at: new Date().toISOString() })
    .eq("id", appSessionId).is("revoked_at", null);
  const { data: username } = await admin.rpc("get_ptg_login_username", { p_user_id: authData.user.id });
  return {
    id: row.id,
    userId: authData.user.id,
    role: profile.role_key,
    branchId: row.branch_id,
    username: typeof username === "string" ? username : "",
    mustChangePassword: profile.must_change_password === true,
  };
}

Deno.serve(async request => {
  const origin = request.headers.get("origin") ?? "";
  if (!origin || !allowedOrigins.has(origin)) return new Response(JSON.stringify({ ok: false, message: "Request origin is not allowed." }), {
    status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-ptg-session-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  } });
  if (request.method !== "POST") return respond(origin, fail("Method not allowed."), 405);

  try {
    const session = await getSession(request);
    if (!session) return respond(origin, fail("Please sign in again."), 401);
    if (session.mustChangePassword) return respond(origin, fail("Password change required."), 403);
    if (!["SYSTEM_ADMIN", "BRANCH_ADMIN"].includes(session.role)) {
      return respond(origin, fail("Only Branch Admin and System Admin can import price memos."), 403);
    }
    const body = await request.json() as Record<string, unknown>;
    const memoId = clean(body.memoId, 120);
    const sourceFile = clean(body.sourceFile, 240);
    const memoType = clean(body.memoType, 40).toUpperCase();
    const period = clean(body.period, 120);
    const action = clean(body.duplicateAction, 20).toUpperCase();
    if (!memoId || !sourceFile || !["MEMO_LIST", "KIOSK_MEMO_LIST"].includes(memoType) ||
        !Array.isArray(body.products) || !body.products.length || body.products.length > MAX_ROWS ||
        !["SKIP", "REPLACE"].includes(action)) {
      return respond(origin, fail("A memo number, source file and valid product rows are required."), 400);
    }
    const products = body.products.map(value => {
      const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      return {
        period,
        source_file: sourceFile,
        brand: clean(row.brand, 120),
        category: clean(row.category, 160),
        barcode: clean(row.barcode, 100),
        model: clean(row.model, 240),
        srp: Number(row.srp) || 0,
        cash_payment: Number(row.cash_payment) || 0,
        tag_this: Number(row.tag_this) || 0,
        months_6: Number(row.months_6) || 0,
        months_9: Number(row.months_9) || 0,
        months_12: Number(row.months_12) || 0,
        months_18: Number(row.months_18) || 0,
        months_24: Number(row.months_24) || 0,
        remarks: clean(row.remarks, 500),
        eligible_for_price_tag: true,
        price_tag_status: "ELIGIBLE",
      };
    });
    if (products.some(row => !row.brand || !row.barcode || !row.model ||
        [row.srp, row.cash_payment, row.tag_this, row.months_6, row.months_9, row.months_12, row.months_18, row.months_24]
          .some(value => !Number.isFinite(value) || value < 0))) {
      return respond(origin, fail("One or more product rows contain missing identifiers or invalid prices."), 400);
    }

    const { data, error } = await admin.rpc("import_price_memo", {
      p_branch_id: null,
      p_memo_id: memoId,
      p_period: period,
      p_memo_type: memoType,
      p_source_file: sourceFile,
      p_imported_by: session.userId,
      p_duplicate_action: action,
      p_products: products,
    });
    if (error) return respond(origin, fail("Price memo import failed. The existing memo was not changed."), 500);
    const result = data as { skipped?: boolean; duplicate?: boolean; totalProducts?: number };
    if (!result.skipped) {
      await admin.from("security_audit_logs").insert({
        actor_user_id: session.userId,
        branch_id: null,
        event_category: "PRICE_MEMO",
        action: result.duplicate ? "REPLACE" : "IMPORT",
        target_identifier: memoId,
        outcome: "SUCCESS",
        message: "Shared price memo import completed.",
        metadata: {
          source_file: sourceFile,
          period,
          memo_type: memoType,
          total_products: result.totalProducts,
          scope: "ALL_BRANCHES",
        },
      });
    }
    return respond(origin, { ok: true, summary: {
      skipped: result.skipped === true,
      duplicate: result.duplicate === true,
      totalProducts: result.totalProducts ?? 0,
    } });
  } catch {
    return respond(origin, fail("Price memo import service is temporarily unavailable."), 503);
  }
});
