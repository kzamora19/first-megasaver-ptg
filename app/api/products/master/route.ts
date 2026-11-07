import { NextResponse } from "next/server";
import { getActiveAppSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_IMPORT_ROWS = 5000;
type ProductRow = { barcode?: unknown; description?: unknown; brand?: unknown; category?: unknown; sub_category?: unknown };
function canUsePTG(session: { role: string; legacyRole: string }) {
  return session.role === "SYSTEM_ADMIN" || session.role === "BRANCH_ADMIN" ||
    (session.role === "BRANCH_USER" && session.legacyRole === "TEAM LEADER");
}
function clean(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}
export async function GET(request: Request) {
  const session = await getActiveAppSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.mustChangePassword) return NextResponse.json({ ok: false, message: "Password change required." }, { status: 403 });
  if (!canUsePTG(session)) return NextResponse.json({ ok: false, message: "PTG access is restricted to Team Leaders and above." }, { status: 403 });
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ ok: true, products: [] }, { headers: { "Cache-Control": "no-store" } });
  const admin = createAdminClient();
  const pattern = `%${q.replace(/[\\\\%_]/g, "\\\\$&")}%`;
  const fields = ["barcode", "description", "brand"] as const;
  const results = await Promise.all(fields.map(field => admin.from("product_master")
    .select("barcode,description,brand,category,sub_category").ilike(field, pattern).limit(50)));
  if (results.some(result => result.error)) return NextResponse.json({ ok: false, message: "Product search failed." }, { status: 500 });
  const unique = new Map<string, (typeof results)[number]["data"] extends (infer T)[] | null ? T : never>();
  for (const result of results) for (const product of result.data ?? []) unique.set(product.barcode, product);
  const products = [...unique.values()].sort((a, b) => String(a.brand).localeCompare(String(b.brand)) || a.description.localeCompare(b.description)).slice(0, 50);
  return NextResponse.json({ ok: true, products }, { headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const session = await getActiveAppSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.mustChangePassword) return NextResponse.json({ ok: false, message: "Password change required." }, { status: 403 });
  if (session.role !== "SYSTEM_ADMIN") return NextResponse.json({ ok: false, message: "Only the System Admin can import the product master." }, { status: 403 });
  let body: { sourceFile?: string; rows?: ProductRow[] };
  try { body = await request.json() as { sourceFile?: string; rows?: ProductRow[] }; }
  catch { return NextResponse.json({ ok: false, message: "Invalid JSON payload." }, { status: 400 }); }
  const sourceFile = clean(body.sourceFile, 240);
  if (!sourceFile || !Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({ ok: false, message: `Provide a source file name and 1–${MAX_IMPORT_ROWS} product rows.` }, { status: 400 });
  }
  const deduped = new Map<string, { barcode: string; description: string; brand: string; category: string; sub_category: string; source_file: string; imported_at: string; updated_at: string }>();
  let invalidRows = 0;
  const importedAt = new Date().toISOString();
  for (const row of body.rows) {
    const barcode = clean(row.barcode, 100);
    const description = clean(row.description, 500);
    if (!barcode || !description) { invalidRows++; continue; }
    deduped.set(barcode, { barcode, description, brand: clean(row.brand, 100), category: clean(row.category, 160), sub_category: clean(row.sub_category, 160), source_file: sourceFile, imported_at: importedAt, updated_at: importedAt });
  }
  if (!deduped.size) return NextResponse.json({ ok: false, message: "No valid rows found. Barcode and description are required." }, { status: 400 });
  const admin = createAdminClient();
  const rows = [...deduped.values()];
  const { data: before, error: readError } = await admin.from("product_master").select("barcode").in("barcode", rows.map(r => r.barcode));
  if (readError) return NextResponse.json({ ok: false, message: "Could not validate existing product records." }, { status: 500 });
  const existing = new Set((before ?? []).map(r => r.barcode));
  const { error } = await admin.from("product_master").upsert(rows, { onConflict: "barcode" });
  if (error) return NextResponse.json({ ok: false, message: "Product import failed; no success was recorded." }, { status: 500 });
  const inserted = rows.filter(r => !existing.has(r.barcode)).length;
  const updated = rows.length - inserted;
  await admin.from("security_audit_logs").insert({ actor_user_id: session.userId, branch_id: null, event_category: "PRODUCT_MASTER", action: "IMPORT", target_identifier: sourceFile, outcome: "SUCCESS", message: "Product master import completed.", metadata: { received: body.rows.length, unique_valid: rows.length, inserted, updated, invalid_rows: invalidRows, duplicate_rows: body.rows.length - invalidRows - rows.length } });
  return NextResponse.json({ ok: true, summary: { received: body.rows.length, uniqueValid: rows.length, inserted, updated, invalidRows, duplicateRows: body.rows.length - invalidRows - rows.length } });
}
