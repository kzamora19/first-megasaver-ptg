import { matchPromotionComponents } from "./promotion-pdf-matching.mjs";
import type { BatchJob, Branch } from "./batch-import";
import type { PromotionPdfOffer } from "./promotion-pdf-workbook";

export type CatalogProduct = { branch_id: string; barcode: string; brand: string; model_description: string; srp: number | null };
export type PromotionComponent = { id: string; barcode: string; quantity: number; free: boolean };
type Selection = { sales: boolean; ptg: boolean; start: string; end: string; barcode?: string };
type Exception = { destination: string; barcode: string; file: string; page: number; reason: string };
const code = (value: string) => /^\d{1,7}$/.test(value) ? value.padStart(8, "0") : value;
const words = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

function offerBrand(offer: PromotionPdfOffer, catalog: CatalogProduct[], brands: string[]) {
  if (offer.brand) return offer.brand;
  const sameBarcode = [...new Set(catalog.filter(product => code(product.barcode) === code(offer.barcode))
    .map(product => product.brand).filter(brand => brand && !/^unclassified$/i.test(brand)))];
  if (sameBarcode.length === 1) return sameBarcode[0];
  const description = " " + words(offer.description) + " ";
  const named = brands.filter(brand => description.includes(" " + words(brand) + " "));
  const distinct = named.filter(brand => !named.some(other => other !== brand && words(other).includes(words(brand))));
  return distinct.length > 1 ? "MULTI-BRAND" : distinct[0] || "Unclassified";
}

export function competingPromotionPrices(offers: PromotionPdfOffer[]) {
  const byBarcode = new Map<string, PromotionPdfOffer[]>();
  for (const row of offers) {
    const barcode = code(row.barcode);
    const group = byBarcode.get(barcode) ?? [];
    group.push(row);
    byBarcode.set(barcode, group);
  }
  return [...byBarcode].filter(([, rows]) =>
    new Set(rows.map(row => row.tagPrice ?? row.cashPayment)).size > 1);
}

export async function planPromotionPdfImport(offers: PromotionPdfOffer[], selection: Selection,
  branches: Branch[], catalog: CatalogProduct[], brands: string[]) {
  const jobs: BatchJob[] = [];
  const exceptions: Exception[] = [];
  const addException = (destination: string, offer: PromotionPdfOffer, reason: string) =>
    exceptions.push({ destination, barcode: code(offer.barcode), file: offer.sourceName, page: offer.sourcePage, reason });
  const requestedBarcode = code(selection.barcode?.trim() ?? "").toUpperCase();
  const unique = new Map<string, PromotionPdfOffer>();
  for (const row of offers) {
    if (requestedBarcode && code(row.barcode).toUpperCase() !== requestedBarcode) continue;
    const key = JSON.stringify([row.fileDigest, code(row.barcode), row.sourceExcerpt]);
    if (!unique.has(key)) unique.set(key, { ...row, validFrom: row.validFrom || selection.start, validTo: row.validTo || selection.end });
  }
  const rows = [...unique.values()];
  if (requestedBarcode && !rows.length) throw new Error("No selected PDF offer matches barcode " + requestedBarcode + ".");
  const issue = (row: PromotionPdfOffer) => row.warnings.length ? row.warnings.join(" ")
    : !row.validTo ? "Confirm the offer end date."
    : row.validFrom && row.validTo < row.validFrom ? "The offer end date is earlier than its start date."
    : "";

  if (selection.ptg) {
    const memoGroups = new Map<string, { file: string; period: string; products: Record<string, unknown>[] }>();
    for (const row of rows) {
      const brand = offerBrand(row, catalog, brands);
      const reason = issue(row) || (row.tagPrice == null && row.cashPayment == null ? "This offer has installment terms only. PTG needs a tag or cash amount."
        : row.description.length > 240 ? "PTG needs a description of 240 characters or fewer." : "");
      if (reason) { addException("PTG", row, reason); continue; }
      const period = row.validFrom ? row.validFrom + " to " + row.validTo : "Until " + row.validTo;
      const key = row.fileDigest + "|" + period;
      const group = memoGroups.get(key) ?? { file: row.sourceName, period, products: [] as Record<string, unknown>[] };
      const installments = Object.fromEntries(row.installments.map(term =>
        ["months_" + term.months, term.basis === "monthly" ? Math.round(term.amount * term.months * 100) / 100 : term.amount]));
      group.products.push({
        brand, category: row.category, barcode: code(row.barcode), model: row.description,
        remarks: row.remarks || row.category, period, source_file: row.sourceName,
        srp: row.memoSrp ?? 0, cash_payment: row.cashPayment ?? 0,
        tag_this: row.tagPrice ?? row.cashPayment, ...installments,
        eligible_for_price_tag: true, price_tag_status: "ELIGIBLE",
      });
      memoGroups.set(key, group);
    }
    for (const [key, group] of memoGroups) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
      const memoId = "PDF-" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      jobs.push({
        key: memoId, label: group.products.length + " promo offers · " + group.file,
        scope: "PTG shared offers · " + group.period, target: "ptg", state: "pending",
        ptg: { functionName: "ptg-memos", body: { action: "import", memoId, period: group.period,
          memoType: "MEMO_LIST", sourceFile: group.file, duplicateAction: "SKIP", products: group.products } },
      });
    }
  }

  if (selection.sales) for (const branch of branches) {
    const available = catalog.filter(product => product.branch_id === branch.id);
    const approved = [];
    for (const item of matchPromotionComponents(rows, available)) {
      const row = item.row as PromotionPdfOffer;
      const reason = issue(row) || item.reasons.join(" ");
      if (reason) { addException("Sales Tracker · " + branch.name, row, reason); continue; }
      approved.push({
        p_barcode: item.code, p_description: [row.description, row.remarks].filter(Boolean).join(" · "),
        p_valid_from: row.validFrom || null, p_valid_to: row.validTo, p_price_conflict: false,
        p_source_name: row.sourceName, p_source_page: row.sourcePage, p_source_excerpt: row.sourceExcerpt,
        p_components: item.components, p_memo_srp: row.memoSrp, p_tag_price: row.tagPrice ?? row.cashPayment ?? null,
      });
    }
    for (let index = 0; index < approved.length; index += 500) {
      const group = approved.slice(index, index + 500);
      jobs.push({ key: branch.id + "-" + index, label: group.length + " promo offers", scope: "Sales Tracker · " + branch.name,
        target: "sales", state: "pending", sales: {
          label: branch.name, rpc: "import_source_priced_promotions", status: "pending", params: { p_branch: branch.id, p_offers: group },
        } });
    }
  }
  return { jobs, exceptions };
}
