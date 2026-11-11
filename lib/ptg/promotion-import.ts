import type { MemoProduct } from "../price-memos/parse-price-memo";
import type { BatchJob, Branch } from "./batch-import";

export type Component = { id: string; barcode: string; quantity: number; free: boolean };
export type PromotionRow = {
  id: string; barcode: string; description: string; brand: string; category: string; remarks: string;
  model: string; sourceName: string; sourcePage: number; sourceExcerpt: string;
  validFrom: string; validTo: string; memoSrp: number | null; tagPrice: number | null; cashPayment: number | null;
  installments: { months: number; amount: number; basis: "monthly" | "total"; raw: string }[];
  sourceColumns: Record<string, string>; warnings: string[];
  priceConflict?: boolean;
};
export type Product = { branch_id: string; barcode: string; brand: string; model_description: string; srp: number | null };
type Prepared = { row: PromotionRow; code: string; ready: boolean; reasons: string[]; components: Component[] };
export type PromotionEngine = {
  inspectPromotionPdf(reader: unknown, bytes: Uint8Array, name: string): Promise<unknown>;
  promotionPdfCandidates(document: unknown): PromotionRow[];
  promotionVariantKey(row: PromotionRow): string;
  preparePromotionImport(rows: PromotionRow[], products: Product[], existing: unknown[]): Prepared[];
  brands: string[];
};
export type PdfSource = { name: string; digest: string; url: string; rows: PromotionRow[] };
export type PromotionPlan = { jobs: BatchJob[]; exceptions: { rowId: string; app: string; detail: string }[] };
export const normalizeCode = (value: string) => /^\d{1,7}$/.test(value.trim()) ? value.trim().padStart(8, "0") : value.trim();

export async function loadPromotionReader() {
  const root = "/branchline/import-engine/";
  const readerUrl = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.mjs";
  const [pdf, matching, brands, reader] = await Promise.all([
    import(/* webpackIgnore: true */ /* turbopackIgnore: true */ (root + "promotion-pdf.mjs")),
    import(/* webpackIgnore: true */ /* turbopackIgnore: true */ (root + "promotion-import.mjs")),
    import(/* webpackIgnore: true */ /* turbopackIgnore: true */ (root + "brand-reference.mjs")),
    import(/* webpackIgnore: true */ /* turbopackIgnore: true */ readerUrl),
  ]);
  reader.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.mjs";
  return { engine: { ...pdf, ...matching, brands: brands.BRAND_REFERENCE.brands.map((brand: { name: string }) => brand.name) } as PromotionEngine, reader };
}

function printedBrand(row: PromotionRow, brands: string[]) {
  if (row.brand.trim()) return row.brand.trim();
  const words = " " + row.description.toUpperCase().replace(/[^A-Z0-9]+/g, " ") + " ";
  const matches = brands.filter(brand => words.includes(" " + brand.toUpperCase().replace(/[^A-Z0-9]+/g, " ") + " "));
  const distinct = matches.filter(brand => !matches.some(other => other !== brand && other.includes(brand)));
  return distinct.length > 1 ? "MULTI-BRAND" : distinct[0] || "";
}

export function toPromotionMemo(row: PromotionRow, brands: string[]): MemoProduct {
  const brand = printedBrand(row, brands);
  if (!brand) throw new Error("The source brand needs to be identified before importing this price tag.");
  if (brand.length > 120 || row.category.length > 160) throw new Error("The brand or category is too long for PTG.");
  if (row.validFrom && row.validTo && row.validFrom > row.validTo) throw new Error("The promotion end date precedes its start date.");
  if (row.description.length > 240) throw new Error("The complete description exceeds PTG's 240-character limit.");
  if (row.tagPrice === null) throw new Error("No cash/tag price is printed. The installment amount remains separate.");
  const months = Object.fromEntries(row.installments.map(rate => [
    "months_" + rate.months,
    rate.basis === "monthly" ? Math.round(rate.amount * 100) * rate.months / 100 : rate.amount,
  ]));
  return {
    period: row.validFrom && row.validTo ? row.validFrom + " to " + row.validTo : "Period not printed in source",
    source_file: row.sourceName, brand, category: row.category || "",
    barcode: normalizeCode(row.barcode), model: row.description,
    srp: row.memoSrp ?? 0, cash_payment: row.cashPayment ?? 0, tag_this: row.tagPrice,
    months_6: months.months_6 ?? 0, months_9: months.months_9 ?? 0, months_12: months.months_12 ?? 0,
    months_18: months.months_18 ?? 0, months_24: months.months_24 ?? 0,
    remarks: row.remarks || row.category || "", eligible_for_price_tag: true, price_tag_status: "ELIGIBLE",
  };
}

export async function buildPromotionPlan(
  engine: PromotionEngine, sources: PdfSource[], selected: Set<string>, targets: { ptg: boolean; sales: boolean },
  branches: Branch[], products: Product[], overrides: Record<string, Component[]>,
): Promise<PromotionPlan> {
  const rows = sources.flatMap(source => source.rows).filter(row => selected.has(row.id));
  const jobs: BatchJob[] = [];
  const exceptions: PromotionPlan["exceptions"] = [];
  const variants = new Map<string, PromotionRow[]>();
  for (const row of rows) {
    const key = engine.promotionVariantKey(row);
    variants.set(key, [...(variants.get(key) ?? []), row]);
  }
  const safeRows = rows.flatMap(row => {
    const duplicates = variants.get(engine.promotionVariantKey(row))!;
    if (duplicates.length === 1) return [row];
    const signature = (value: PromotionRow) => JSON.stringify([value.description, value.memoSrp, value.tagPrice, value.cashPayment, value.installments, value.validFrom, value.validTo]);
    if (duplicates.some(other => signature(other) !== signature(row))) {
      return [{ ...row, priceConflict: true }];
    }
    return duplicates[0] === row ? [row] : [];
  }).map(row => ({ ...row, warnings: row.warnings.filter(warning => !/more than once/.test(warning)) }));

  if (targets.ptg) for (const source of sources) {
    const products: MemoProduct[] = [];
    for (const row of safeRows.filter(row => row.sourceName === source.name)) {
      try {
        if (row.warnings.length) throw new Error(row.warnings.join(" "));
        products.push(toPromotionMemo(row, engine.brands));
      } catch (error) { exceptions.push({ rowId: row.id, app: "PTG", detail: error instanceof Error ? error.message : "Review the source row." }); }
    }
    const periods = new Map<string, MemoProduct[]>();
    for (const product of products) periods.set(product.period, [...(periods.get(product.period) ?? []), product]);
    for (const [period, periodProducts] of periods) {
      const payload = periodProducts.map(product => ({ ...product, source_file: "" }));
      const fingerprint = new TextEncoder().encode(JSON.stringify([source.digest, payload]));
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", fingerprint)),
        value => value.toString(16).padStart(2, "0")).join("");
      jobs.push({
        key: "ptg-" + digest, target: "ptg", state: "pending", label: source.name + " · " + periodProducts.length + " offers", scope: "All PTG branches · " + period,
        ptg: { functionName: "ptg-memos", body: { action: "import", memoId: "PDF-" + digest,
          period, memoType: "MEMO_LIST", sourceFile: source.name, duplicateAction: "SKIP", products: periodProducts } },
      });
    }
  }
  if (targets.sales) for (const branch of branches) {
    const catalog = products.filter(product => product.branch_id === branch.id);
    for (const item of engine.preparePromotionImport(safeRows, catalog, [])) {
      let reasons = item.reasons;
      if (item.row.priceConflict) reasons = reasons.filter(reason => !/more than once/.test(reason));
      const components = overrides[item.row.id] ?? item.components;
      if (overrides[item.row.id]) {
        reasons = reasons.filter(reason => !/product mapping|matching inventory barcode|positive standard SRP/.test(reason));
        if (!components.length) reasons.push("Add the actual products included in this offer.");
        for (const part of components) {
          const product = catalog.find(product => normalizeCode(product.barcode) === normalizeCode(part.barcode));
          if (!product || !Number.isInteger(part.quantity) || part.quantity < 1 || part.quantity > 999999 ||
              (!part.free && !(Number(product.srp) > 0))) reasons.push("Check the component barcodes, quantities and standard SRPs in " + branch.name + ".");
        }
        if (!components.some(part => !part.free)) reasons.push("At least one bundle component must be paid.");
      }
      if (reasons.length) { exceptions.push({ rowId: item.row.id, app: "Sales Tracker · " + branch.name, detail: [...new Set(reasons)].join(" ") }); continue; }
      jobs.push({
        key: "sales-" + branch.id + "-" + item.row.id, target: "sales", state: "pending",
        label: item.code + " · " + item.row.description + " · " + components.map(part => part.quantity + " × " + part.barcode + (part.free ? " free" : " paid")).join(", "),
        scope: branch.name,
        sales: { label: item.row.description, rpc: "import_source_priced_promotion", status: "pending", params: {
          p_branch: branch.id, p_barcode: item.code, p_description: [item.row.brand, item.row.description, item.row.remarks].filter(Boolean).join(" · "),
          p_valid_from: item.row.validFrom || null, p_valid_to: item.row.validTo || null, p_price_conflict: item.row.priceConflict === true,
          p_source_name: item.row.sourceName, p_source_page: item.row.sourcePage, p_source_excerpt: item.row.sourceExcerpt,
          p_components: components.map(part => ({ ...part, barcode: normalizeCode(part.barcode) })),
          p_memo_srp: item.row.memoSrp, p_tag_price: item.row.tagPrice,
        } },
      });
    }
  }
  const grouped = jobs.filter(job => job.target === "ptg");
  for (const branch of branches) {
    const offers = jobs.filter(job => job.sales?.params.p_branch === branch.id);
    if (offers.length) grouped.push({
      key: "sales-" + branch.id, target: "sales", state: "pending", scope: branch.name,
      label: offers.length + " promotional offers with mapped products",
      sales: { label: branch.name + " promotions", rpc: "import_source_priced_promotions", status: "pending",
        params: { p_branch: branch.id, p_offers: offers.map(job => job.sales!.params) } },
    });
  }
  return { jobs: grouped, exceptions };
}
