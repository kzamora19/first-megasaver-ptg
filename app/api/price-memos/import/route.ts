import { NextResponse } from "next/server";
import { getActiveAppSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MemoProduct } from "@/lib/price-memos/parse-price-memo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_ROWS = 10000;
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0,max);

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) {
    return NextResponse.json({ok:false,message:"Cross-origin requests are not allowed."},{status:403});
  }
  const session = await getActiveAppSession();
  if (!session) return NextResponse.json({ok:false,message:"Please sign in again."},{status:401});
  if (session.mustChangePassword) return NextResponse.json({ok:false,message:"Password change required."},{status:403});
  if (!["SYSTEM_ADMIN","BRANCH_ADMIN"].includes(session.role)) {
    return NextResponse.json({ok:false,message:"Only Branch Admin and System Admin can import price memos."},{status:403});
  }
  let body: { branchId?: string; memoId?: string; period?: string; memoType?: string; sourceFile?: string; duplicateAction?: string; products?: MemoProduct[] };
  try { body = await request.json(); }
  catch { return NextResponse.json({ok:false,message:"Invalid import payload."},{status:400}); }
  const branchId = session.role === "BRANCH_ADMIN" ? session.branchId : clean(body.branchId,64);
  const memoId = clean(body.memoId,120);
  const sourceFile = clean(body.sourceFile,240);
  const memoType = clean(body.memoType,40).toUpperCase();
  const period = clean(body.period,120);
  const action = clean(body.duplicateAction,20).toUpperCase();
  if (!branchId || !memoId || !sourceFile || !["MEMO_LIST","KIOSK_MEMO_LIST"].includes(memoType) || !Array.isArray(body.products) || !body.products.length || body.products.length > MAX_ROWS || !["SKIP","REPLACE"].includes(action)) {
    return NextResponse.json({ok:false,message:"A destination branch, memo number, source file and valid product rows are required."},{status:400});
  }
  const products = body.products.map(p => ({
    period, source_file:sourceFile, brand:clean(p.brand,120), category:clean(p.category,160),
    barcode:clean(p.barcode,100), model:clean(p.model,240),
    srp:Number(p.srp)||0, cash_payment:Number(p.cash_payment)||0, tag_this:Number(p.tag_this)||0,
    months_6:Number(p.months_6)||0, months_9:Number(p.months_9)||0, months_12:Number(p.months_12)||0,
    months_18:Number(p.months_18)||0, months_24:Number(p.months_24)||0,
    remarks:clean(p.remarks,500), eligible_for_price_tag:p.eligible_for_price_tag===true,
    price_tag_status:clean(p.price_tag_status,40)
  }));
  if (products.some(p => !p.brand || !p.barcode || !p.model || [p.srp,p.cash_payment,p.tag_this,p.months_6,p.months_9,p.months_12,p.months_18,p.months_24].some(n => !Number.isFinite(n) || n < 0))) {
    return NextResponse.json({ok:false,message:"One or more product rows contain missing identifiers or invalid prices."},{status:400});
  }
  const admin = createAdminClient();
  const {data: branch,error:branchError} = await admin.from("branches").select("id").eq("id",branchId).eq("status","ACTIVE").maybeSingle();
  if (branchError || !branch) return NextResponse.json({ok:false,message:"The selected branch is unavailable."},{status:400});
  if (session.role === "BRANCH_ADMIN" && session.branchId !== branchId) {
    return NextResponse.json({ok:false,message:"You can only import memos for your assigned branch."},{status:403});
  }
  const {data,error} = await admin.rpc("import_price_memo",{
    p_branch_id:branchId,p_memo_id:memoId,p_period:period,p_memo_type:memoType,p_source_file:sourceFile,
    p_imported_by:session.userId,p_duplicate_action:action,p_products:products
  });
  if (error) {
    return NextResponse.json({ok:false,message:"Price memo import failed. The existing memo was not changed."},{status:500});
  }
  const result = data as {skipped?:boolean;duplicate?:boolean;totalProducts?:number};
  if (!result.skipped) {
    await admin.from("security_audit_logs").insert({
      actor_user_id:session.userId,branch_id:branchId,event_category:"PRICE_MEMO",action:result.duplicate?"REPLACE":"IMPORT",
      target_identifier:memoId,outcome:"SUCCESS",message:"Price memo import completed.",
      metadata:{source_file:sourceFile,period,memo_type:memoType,total_products:result.totalProducts,eligible_products:products.filter(p=>p.eligible_for_price_tag).length}
    });
  }
  return NextResponse.json({ok:true,summary:{skipped:result.skipped===true,duplicate:result.duplicate===true,totalProducts:result.totalProducts??0}});
}
