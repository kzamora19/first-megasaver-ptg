import { matchPromotionComponents } from "./promotion-pdf-matching.mjs";
import type { BatchJob, Branch } from "./batch-import";
import type { PromotionPdfOffer } from "./promotion-pdf-workbook";

export type CatalogProduct = { branch_id: string; barcode: string; brand: string; model_description: string; srp: number | null };
export type SavedPromotion = { branch_id: string; barcode: string; source_name: string; source_page: number; source_excerpt: string };
export type PromotionComponent = { id: string; barcode: string; quantity: number; free: boolean };
type Selection = { sales: boolean; ptg: boolean; start: string; end: string; barcode?: string };
type Exception = { destination: string; barcode: string; description: string; file: string; page: number; reason: string };
type BranchCoverage = { branch: string; total: number; alreadyPresent: number; ready: number; needsReview: number };
const code = (value: string) => /^\d{1,7}$/.test(value) ? value.padStart(8, "0") : value;
const words = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const sourceKey = (branch: string, barcode: string, file: string, page: number, excerpt: string) =>
  JSON.stringify([branch, code(barcode), file, page, excerpt]);

function printedBundleParts(description: string, knownBrands: string[]) {
  if (!/^BUNDLE\s/i.test(description)) return null;
  const parts = description.replace(/^BUNDLE\s+/i, "").toUpperCase().split("+").map(part => part.trim());
  if (parts.length < 2) return null;
  const parsed = parts.map(part => {
    const brand = knownBrands.find(name => part.startsWith(name + " ")) ?? "";
    const model = part.slice(brand.length).trim();
    return { brand, model };
  });
  return parsed.every(({model}) => /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(model) && /[A-Z]/.test(model) && /\d/.test(model))
    ? parsed : null;
}

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
  branches: Branch[], catalog: CatalogProduct[], brands: string[], saved: SavedPromotion[] = []) {
  const jobs: BatchJob[] = [];
  const exceptions: Exception[] = [];
  const coverage: BranchCoverage[] = [];
  const addException = (destination: string, offer: PromotionPdfOffer, reason: string) =>
    exceptions.push({ destination, barcode: code(offer.barcode), description: offer.description,
      file: offer.sourceName, page: offer.sourcePage, reason });
  const requestedBarcode = code(selection.barcode?.trim() ?? "").toUpperCase();
  const unique = new Map<string, PromotionPdfOffer>();
  for (const row of offers) {
    if (requestedBarcode && code(row.barcode).toUpperCase() !== requestedBarcode) continue;
    const key = JSON.stringify([row.fileDigest, code(row.barcode), row.sourceExcerpt]);
    if (!unique.has(key)) unique.set(key, { ...row, validFrom: row.validFrom || selection.start, validTo: row.validTo || selection.end });
  }
  if (requestedBarcode && !unique.size) throw new Error("No selected PDF offer matches barcode " + requestedBarcode + ".");
  const rows: PromotionPdfOffer[] = [];
  const equivalents = new Map<PromotionPdfOffer, PromotionPdfOffer[]>();
  const knownBrands = [...new Set([...brands, ...catalog.map(product => product.brand)]
    .filter(Boolean).map(brand => brand.trim().toUpperCase()))].sort((a, b) => b.length - a.length);
  const printedGroups = new Map<string, { row: PromotionPdfOffer; parts: NonNullable<ReturnType<typeof printedBundleParts>> }[]>();
  for (const row of unique.values()) {
    const parts = row.warnings.length ? null : printedBundleParts(row.description, knownBrands);
    if (parts) {
      const key = JSON.stringify([row.fileDigest, row.sourcePage, code(row.barcode), row.validFrom, row.validTo,
        words(row.category), words(row.remarks), row.memoSrp, row.cashPayment, row.tagPrice,
        row.installments.map(term => [term.months, term.amount, term.basis]), parts.map(part => part.model)]);
      const group = printedGroups.get(key) ?? [];
      const prior = group.find(item => item.parts.every((part, index) =>
        !part.brand || !parts[index].brand || part.brand === parts[index].brand));
      if (prior) {
        equivalents.get(prior.row)!.push(row);
        // Preserve explicit brand evidence when comparing another repeated row.
        prior.parts = prior.parts.map((part, index) => part.brand ? part : parts[index]);
        continue;
      }
      group.push({ row, parts });
      printedGroups.set(key, group);
    }
    equivalents.set(row, [row]);
    rows.push(row);
  }
  const savedKeys = new Set(saved.map(row => sourceKey(row.branch_id, row.barcode, row.source_name, row.source_page, row.source_excerpt)));
  const selectedCodes = new Set(rows.map(row => code(row.barcode)).filter(Boolean));
  let alreadySaved = 0;
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
    const alreadyPresent = new Set(saved.filter(row => row.branch_id === branch.id)
      .map(row => code(row.barcode)).filter(barcode => selectedCodes.has(barcode)));
    const pending = rows.filter(row => {
      if (!equivalents.get(row)!.some(source => savedKeys.has(sourceKey(branch.id, source.barcode, source.sourceName, source.sourcePage, source.sourceExcerpt)))) return true;
      alreadySaved++;
      return false;
    });
    const approved = [];
    for (const item of matchPromotionComponents(pending, available)) {
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
    const ready = new Set(approved.map(offer => offer.p_barcode).filter(barcode => !alreadyPresent.has(barcode)));
    coverage.push({ branch: branch.name, total: selectedCodes.size, alreadyPresent: alreadyPresent.size,
      ready: ready.size, needsReview: selectedCodes.size - alreadyPresent.size - ready.size });
    for (let index = 0; index < approved.length; index += 500) {
      const group = approved.slice(index, index + 500);
      jobs.push({ key: branch.id + "-" + index, label: group.length + " promo offers", scope: "Sales Tracker · " + branch.name,
        target: "sales", state: "pending", sales: {
          label: branch.name, rpc: "import_source_priced_promotions", status: "pending", params: { p_branch: branch.id, p_offers: group },
        } });
    }
  }
  return { jobs, exceptions, coverage, alreadySaved, repeatedRows: unique.size - rows.length };
}
