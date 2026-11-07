"use client";

import * as XLSX from "xlsx";

export type MemoProduct = {
  period: string; source_file: string; brand: string; category: string; barcode: string;
  model: string; srp: number; cash_payment: number; tag_this: number;
  months_6: number; months_9: number; months_12: number; months_18: number;
  months_24: number; remarks: string; eligible_for_price_tag: boolean; price_tag_status: string;
};
export type MemoType = "MEMO_LIST" | "KIOSK_MEMO_LIST";
export type ParsedMemo = {
  memoId: string; period: string; memoType: MemoType; products: MemoProduct[];
  eligible: number;
};
const norm = (v: unknown) => String(v ?? "").normalize("NFKC").trim().toUpperCase().replace(/[\s_\-]+/g, " ");
const clean = (v: unknown) => String(v ?? "").trim();
const money = (v: unknown): number => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
  const s = clean(v).replace(/[₱,$,\s]/g, "").replace(/[()]/g, "");
  if (!s || s === "-" || s.toUpperCase() === "N/A") return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
function classify(remarks: string) {
  // Remarks are descriptive metadata (including aircon installation identification),
  // never a gate for price-tag eligibility. Every imported product is eligible.
  void remarks;
  return { eligible: true, status: "ELIGIBLE" };
}
function findHeaderColumn(rows: unknown[][], headerRow: number, name: string) {
  // Some Head Office memos split labels across multiple header rows
  // (for example REMARKS may be above BRAND / CATEGORY / BARCODE / MODEL).
  // Resolve each column independently, preferring the row nearest the product headers.
  for (let r = headerRow; r >= 0; r--) {
    const i = rows[r].findIndex(v => norm(v) === name);
    if (i >= 0) return i;
  }
  return -1;
}
function findHeaderAbove(rows: unknown[][], headerRow: number, name: string) {
  // Head Office memos can have merged/grouped header rows several lines above
  // the product headings. Search the entire preceding header area.
  for (let r = headerRow - 1; r >= 0; r--) {
    const i = rows[r].findIndex(v => norm(v).includes(name));
    if (i >= 0) return i;
  }
  throw new Error(`Could not locate the ${name} installment column above the product headers.`);
}
function memoInfo(rows: unknown[][], fileName: string) {
  let memoId = "", period = "";
  for (const row of rows.slice(0, 25)) for (const cell of row) {
    const value = clean(cell);
    const upper = norm(value);
    if (upper.includes("MEMO NUMBER")) memoId = value.replace(/.*MEMO NUMBER\s*:?\s*/i, "").trim();
    if (upper.includes("PERIOD COVERED")) period = value.replace(/.*PERIOD COVERED\s*:?\s*/i, "").trim();
  }
  if (!memoId) memoId = `NO-MEMO-NUMBER-${fileName.replace(/[^a-z0-9]+/gi,"-").slice(0,80)}`;
  return { memoId, period };
}
export async function parsePriceMemo(file: File): Promise<ParsedMemo> {
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error("Use an Excel (.xlsx/.xls) or CSV Head Office price memo.");
  if (file.size > 20 * 1024 * 1024) throw new Error("File exceeds the 20 MB limit.");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellText: true, cellDates: false });
  if (!workbook.SheetNames.length) throw new Error("The workbook has no worksheets.");
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
  if (!rows.length) throw new Error("The uploaded memo is empty.");
  const headerRow = rows.findIndex(row => {
    const h = row.map(norm);
    return ["BRAND","CATEGORY","BARCODE","MODEL"].every(k => h.includes(k));
  });
  if (headerRow < 0) throw new Error("Could not find the product header row (BRAND / CATEGORY / BARCODE / MODEL).");
  const required = ["BRAND","CATEGORY","BARCODE","MODEL","SRP","REMARKS"];
  const columns = Object.fromEntries(required.map(k => [k, findHeaderColumn(rows,headerRow,k)])) as Record<string,number>;
  const missing = required.filter(k => columns[k] < 0);
  if (missing.length) throw new Error(`Missing required memo columns: ${missing.join(", ")}.`);
  const c = {
    brand: columns.BRAND, category: columns.CATEGORY,
    barcode: columns.BARCODE, model: columns.MODEL,
    srp: columns.SRP, cash: findHeaderColumn(rows,headerRow,"CASH PAYMENT ONLY"),
    tag: findHeaderColumn(rows,headerRow,"TAG THIS"), remarks: columns.REMARKS,
    m6: findHeaderAbove(rows,headerRow,"6 MONTHS"), m9: findHeaderAbove(rows,headerRow,"9 MONTHS"),
    m12: findHeaderAbove(rows,headerRow,"12 MONTHS"), m18: findHeaderAbove(rows,headerRow,"18 MONTHS"),
    m24: findHeaderAbove(rows,headerRow,"24 MONTHS")
  };
  const meta = memoInfo(rows,file.name);
  const products: MemoProduct[] = [];
  let eligible=0;
  for (const row of rows.slice(headerRow+1)) {
    const brand=clean(row[c.brand]), category=clean(row[c.category]), barcode=clean(row[c.barcode]), model=clean(row[c.model]);
    if (!brand && !category && !barcode && !model) continue;
    if (!brand || !barcode || !model) continue;
    const remarks=clean(row[c.remarks]), status=classify(remarks);
    eligible++;
    products.push({
      period:meta.period, source_file:file.name, brand, category, barcode, model,
      srp:money(row[c.srp]), cash_payment:c.cash<0?0:money(row[c.cash]), tag_this:c.tag<0?0:money(row[c.tag]),
      months_6:c.m6<0?0:money(row[c.m6]), months_9:c.m9<0?0:money(row[c.m9]),
      months_12:c.m12<0?0:money(row[c.m12]), months_18:c.m18<0?0:money(row[c.m18]),
      months_24:c.m24<0?0:money(row[c.m24]), remarks,
      eligible_for_price_tag:status.eligible, price_tag_status:status.status
    });
  }
  if (!products.length) throw new Error("No valid product rows found. Each row needs Brand, Barcode and Model.");
  if (products.length > 10000) throw new Error("This memo exceeds 10,000 product rows. Split the file before importing.");
  return { memoId:meta.memoId, period:meta.period, memoType:c.cash < 0 ? "KIOSK_MEMO_LIST" : "MEMO_LIST", products, eligible };
}
