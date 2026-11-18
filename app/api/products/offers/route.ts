import { NextResponse } from "next/server";
import { getActiveAppSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only, branch-scoped memo offer comparison for a product barcode.
 * The current selling period is still plain text: do not infer effective or
 * early-print dates from it. The UI must display that uncertainty honestly.
 */
export async function GET(request: Request) {
  const session = await getActiveAppSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
  }
  if (session.mustChangePassword) {
    return NextResponse.json({ ok: false, message: "Password change required." }, { status: 403 });
  }
  if (!["SYSTEM_ADMIN", "BRANCH_ADMIN", "BRANCH_USER"].includes(session.role)) {
    return NextResponse.json({ ok: false, message: "PTG access is not enabled." }, { status: 403 });
  }

  const barcode = (new URL(request.url).searchParams.get("barcode") ?? "").trim();
  if (!barcode || barcode.length > 100) {
    return NextResponse.json({ ok: false, message: "A valid barcode is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  let query = admin.from("memo_products")
    .select("id,memo_id,brand,category,barcode,model,srp,cash_payment,tag_this,months_6,months_9,months_12,months_18,months_24,remarks,eligible_for_price_tag,price_tag_status,price_memos!inner(branch_id,memo_id,period,memo_type,created_at,expired_at)")
    .eq("barcode", barcode)
    .is("price_memos.expired_at", null)
    .order("created_at", { referencedTable: "price_memos", ascending: false })
    .limit(200);

  if (session.role !== "SYSTEM_ADMIN") {
    query = session.branchId
      ? query.or("branch_id.is.null,branch_id.eq." + session.branchId, { referencedTable: "price_memos" })
      : query.is("price_memos.branch_id", null);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, message: "Could not retrieve product offers." }, { status: 500 });
  }

  const rows = data ?? [];
  const descriptions = await admin.from("product_master")
    .select("description,sub_category")
    .eq("barcode", barcode)
    .maybeSingle();

  if (descriptions.error) {
    return NextResponse.json({ ok: false, message: "Could not load product description." }, { status: 500 });
  }

  const products = rows.map(row => ({
    ...row,
    description: descriptions.data?.description ?? row.model,
    sub_category: descriptions.data?.sub_category ?? "",
  }));

  return NextResponse.json({
    ok: true,
    products,
    limited: rows.length >= 200,
    note: "The memo period is a text label; effective selling and early-print dates need explicit metadata.",
  }, { headers: { "Cache-Control": "no-store" } });
}
