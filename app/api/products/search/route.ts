import { NextResponse } from "next/server";
import { getActiveAppSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PAGE_SIZE = 5;

export async function GET(request: Request) {
  const session = await getActiveAppSession();
  if (!session) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
  if (session.mustChangePassword) return NextResponse.json({ ok: false, message: "Password change required." }, { status: 403 });
  const isAllowed = ["SYSTEM_ADMIN", "BRANCH_ADMIN", "BRANCH_USER"].includes(session.role);
  if (!isAllowed) return NextResponse.json({ ok: false, message: "PTG access is not enabled for this account." }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const page = Math.max(1, Math.trunc(Number(params.get("page") || 1)) || 1);
  const admin = createAdminClient();
  let query = admin.from("memo_products")
    .select("id,memo_id,brand,category,barcode,model,srp,cash_payment,tag_this,months_6,months_9,months_12,months_18,months_24,remarks,eligible_for_price_tag,price_tag_status,price_memos!inner(branch_id,memo_id,period,memo_type,created_at)", { count: "exact" })
    .order("brand", { ascending: true })
    .order("model", { ascending: true });

  if (q.length >= 2) {
    const safeQ = q.replace(/[,%()]/g, "");
    const matches = [
      "barcode.ilike.%" + safeQ + "%",
      "model.ilike.%" + safeQ + "%",
      "brand.ilike.%" + safeQ + "%",
    ];
    const masterMatches = await admin.from("product_master")
      .select("barcode")
      .ilike("description", "%" + safeQ + "%")
      .limit(100);
    if (masterMatches.error) return NextResponse.json({ ok: false, message: "Could not search product descriptions." }, { status: 500 });
    const matchingBarcodes = [...new Set((masterMatches.data ?? []).map(row => String(row.barcode || "").trim()).filter(Boolean))];
    if (matchingBarcodes.length) matches.push("barcode.in.(" + matchingBarcodes.join(",") + ")");
    query = query.or(matches.join(","));
  }

  if (session.role !== "SYSTEM_ADMIN") {
    query = session.branchId
      ? query.or("branch_id.is.null,branch_id.eq." + session.branchId, { referencedTable: "price_memos" })
      : query.is("price_memos.branch_id", null);
  }

  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) return NextResponse.json({ ok: false, message: "Could not search imported memo products." }, { status: 500 });

  const rows = data ?? [];
  const barcodes = [...new Set(rows.map(row => row.barcode).filter(Boolean))];
  const descriptions = barcodes.length
    ? await admin.from("product_master").select("barcode,description,sub_category").in("barcode", barcodes)
    : { data: [], error: null };
  if (descriptions.error) return NextResponse.json({ ok: false, message: "Could not load product descriptions." }, { status: 500 });
  const detail = new Map((descriptions.data ?? []).map(item => [item.barcode, item]));
  const products = rows.map(row => ({
    ...row,
    description: detail.get(row.barcode)?.description ?? row.model,
    sub_category: detail.get(row.barcode)?.sub_category ?? "",
  }));
  return NextResponse.json({
    ok: true,
    products,
    total: count ?? products.length,
    page,
    pageSize: PAGE_SIZE,
  }, { headers: { "Cache-Control": "no-store" } });
}
