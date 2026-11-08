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

type ActiveSession = {
  id: string;
  userId: string;
  role: string;
  branchId: string | null;
  username: string;
  mustChangePassword: boolean;
};

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

function clean(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

async function searchMemoProducts(origin: string, session: ActiveSession, body: Record<string, unknown>) {
  if (session.mustChangePassword) return respond(origin, fail("Password change required."), 403);
  if (!["SYSTEM_ADMIN", "BRANCH_ADMIN", "BRANCH_USER"].includes(session.role)) return respond(origin, fail("PTG access is not enabled for this account."), 403);
  const q = clean(body.q, 100);
  const page = Math.min(1_000_000, Math.max(1, Math.trunc(Number(body.page || 1)) || 1));
  const pageSize = 5;
  let query = admin.from("memo_products")
    .select("id,memo_id,brand,category,barcode,model,srp,cash_payment,tag_this,months_6,months_9,months_12,months_18,months_24,remarks,eligible_for_price_tag,price_tag_status,price_memos!inner(branch_id,memo_id,period,memo_type,created_at:imported_at)", { count: "exact" })
    .order("brand", { ascending: true })
    .order("model", { ascending: true })
    .order("id", { ascending: true });
  if (q.length >= 2) {
    const safeQ = q.replace(/[,%()]/g, "");
    const matches = ["barcode.ilike.%" + safeQ + "%", "model.ilike.%" + safeQ + "%", "brand.ilike.%" + safeQ + "%"];
    const masterMatches = await admin.from("product_master").select("barcode").ilike("description", "%" + safeQ + "%").limit(100);
    if (masterMatches.error) return respond(origin, fail("Could not search product descriptions."), 500);
    const matchingBarcodes = [...new Set((masterMatches.data ?? []).map(row => String(row.barcode || "").trim()).filter(Boolean))];
    if (matchingBarcodes.length) matches.push("barcode.in.(" + matchingBarcodes.join(",") + ")");
    query = query.or(matches.join(","));
  }
  if (session.role !== "SYSTEM_ADMIN") {
    query = session.branchId
      ? query.or("branch_id.is.null,branch_id.eq." + session.branchId, { referencedTable: "price_memos" })
      : query.is("price_memos.branch_id", null);
  }
  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) return respond(origin, fail("Could not search imported memo products."), 500);
  const rows = data ?? [];
  const barcodes = [...new Set(rows.map(row => row.barcode).filter(Boolean))];
  const barcodeVariants = (barcode: string) => {
    if (!/^\d+$/.test(barcode)) return [barcode];
    const unpadded = barcode.replace(/^0+(?=\d)/, "");
    return [...new Set([barcode, unpadded, unpadded.padStart(8, "0")])];
  };
  const lookupBarcodes = [...new Set(barcodes.flatMap(barcodeVariants))];
  const descriptions = lookupBarcodes.length
    ? await admin.from("product_master").select("barcode,description,sub_category").in("barcode", lookupBarcodes)
    : { data: [], error: null };
  if (descriptions.error) return respond(origin, fail("Could not load product descriptions."), 500);
  const detail = new Map((descriptions.data ?? []).map(item => [item.barcode, item]));
  const products = rows.map(row => {
    const match = barcodeVariants(row.barcode ?? "").map(barcode => detail.get(barcode)).find(Boolean);
    return {
      ...row,
      description: match?.description?.trim() || row.model,
      sub_category: match?.sub_category ?? "",
    };
  });
  const memoCount = count ?? products.length;
  const fallbackFrom = Math.max(0, from - memoCount);
  const remaining = pageSize - products.length;
  const fallback = await admin.rpc("ptg_search_srp_fallback", {
    p_query: q, p_branch_id: session.branchId ?? null, p_system_admin: session.role === "SYSTEM_ADMIN",
  }, { count: "exact" }).order("brand").order("model").order("id")
    .range(fallbackFrom, fallbackFrom + Math.max(1, remaining) - 1);
  if (fallback.error) return respond(origin, fail("Could not search the product SRP register."), 500);
  const srpProducts = (fallback.data ?? []).slice(0, remaining).map(row => ({
    ...row, description: row.model, cash_payment: row.srp, tag_this: row.srp,
    eligible_for_price_tag: false, price_tag_status: "SRP ONLY", price_memos: null,
  }));
  return respond(origin, { ok: true, products: [...products, ...srpProducts],
    total: memoCount + (fallback.count ?? srpProducts.length), page, pageSize });
}

async function searchProductMaster(origin: string, session: ActiveSession, body: Record<string, unknown>) {
  if (session.mustChangePassword) return respond(origin, fail("Password change required."), 403);
  const q = clean(body.q, 200);
  if (q.length < 2) return respond(origin, { ok: true, products: [] });
  const pattern = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
  const fields = ["barcode", "description", "brand"] as const;
  const results = await Promise.all(fields.map(field => admin.from("product_master")
    .select("barcode,description,brand,category,sub_category").ilike(field, pattern).limit(50)));
  if (results.some(result => result.error)) return respond(origin, fail("Product search failed."), 500);
  const unique = new Map<string, NonNullable<(typeof results)[number]["data"]>[number]>();
  for (const result of results) for (const product of result.data ?? []) unique.set(product.barcode, product);
  const products = [...unique.values()]
    .sort((a, b) => String(a.brand).localeCompare(String(b.brand)) || a.description.localeCompare(b.description))
    .slice(0, 50);
  return respond(origin, { ok: true, products });
}

async function importProductMaster(origin: string, session: ActiveSession, body: Record<string, unknown>) {
  if (session.mustChangePassword) return respond(origin, fail("Password change required."), 403);
  if (session.role !== "SYSTEM_ADMIN") return respond(origin, fail("Only the System Admin can import the product master."), 403);
  const maxRows = 10000;
  const sourceFile = clean(body.sourceFile, 240);
  const input = body.rows;
  if (!sourceFile || !Array.isArray(input) || input.length === 0 || input.length > maxRows) {
    return respond(origin, fail("Provide a source file name and 1–" + maxRows + " product rows."), 400);
  }
  const importedAt = new Date().toISOString();
  const deduped = new Map<string, { barcode: string; description: string; brand: string; category: string; sub_category: string; source_file: string; imported_at: string; updated_at: string }>();
  let invalidRows = 0;
  for (const value of input) {
    const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const barcode = clean(row.barcode, 100);
    const description = clean(row.description, 500);
    if (!barcode || !description) { invalidRows++; continue; }
    deduped.set(barcode, {
      barcode, description, brand: clean(row.brand, 100), category: clean(row.category, 160),
      sub_category: clean(row.sub_category, 160), source_file: sourceFile, imported_at: importedAt, updated_at: importedAt,
    });
  }
  if (!deduped.size) return respond(origin, fail("No valid rows found. Barcode and description are required."), 400);
  const rows = [...deduped.values()];
  // Keep lookup URLs short and each result below the Data API row limit.
  const barcodes = rows.map(row => row.barcode);
  const lookupSize = 100;
  const batches = Array.from({ length: Math.ceil(barcodes.length / lookupSize) }, (_, index) =>
    barcodes.slice(index * lookupSize, (index + 1) * lookupSize),
  );
  const existing = new Set<string>();
  for (let index = 0; index < batches.length; index += 8) {
    const results = await Promise.all(batches.slice(index, index + 8).map(batch =>
      admin.from("product_master").select("barcode").in("barcode", batch),
    ));
    for (const result of results) {
      if (result.error) return respond(origin, fail("Could not validate existing product records."), 500);
      for (const row of result.data ?? []) existing.add(row.barcode);
    }
  }
  const { error } = await admin.from("product_master").upsert(rows, { onConflict: "barcode" });
  if (error) return respond(origin, fail("Product import failed; no success was recorded."), 500);
  const inserted = rows.filter(row => !existing.has(row.barcode)).length;
  const updated = rows.length - inserted;
  const duplicateRows = input.length - invalidRows - rows.length;
  await admin.from("security_audit_logs").insert({
    actor_user_id: session.userId, branch_id: null, event_category: "PRODUCT_MASTER", action: "IMPORT",
    target_identifier: sourceFile, outcome: "SUCCESS", message: "Product master import completed.",
    metadata: { received: input.length, unique_valid: rows.length, inserted, updated, invalid_rows: invalidRows, duplicate_rows: duplicateRows },
  });
  return respond(origin, { ok: true, summary: { received: input.length, uniqueValid: rows.length, inserted, updated, invalidRows, duplicateRows } });
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
    const body = await request.json() as Record<string, unknown>;
    switch (String(body.action ?? "")) {
      case "search": return await searchMemoProducts(origin, session, body);
      case "master-search": return await searchProductMaster(origin, session, body);
      case "master-import": return await importProductMaster(origin, session, body);
      default: return respond(origin, fail("Unknown product action."), 400);
    }
  } catch {
    return respond(origin, fail("Product service is temporarily unavailable."), 503);
  }
});
