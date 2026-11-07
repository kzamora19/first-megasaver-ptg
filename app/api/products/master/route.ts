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
