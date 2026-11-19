import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const edge = readFileSync(new URL("supabase/functions/ptg-products/index.ts", root), "utf8");
const ui = readFileSync(new URL("app/products/product-search.tsx", root), "utf8");

test("cross-page offers reuse verified session role and barcode filtering, not arbitrary memo history", () => {
  const start = edge.indexOf("async function comparableOffers(");
  const end = edge.indexOf("async function productInsights(", start);
  assert.ok(start > edge.indexOf("async function getSession(") && end > start);
  const body = edge.slice(start, end);
  assert.match(body, /session\.mustChangePassword/);
  assert.match(body, /Subdealer pricing is restricted to authorized managers/);
  assert.match(body, /p_branch_id: session\.branchId \?\? null/);
  assert.match(body, /ptg_ordered_product_search_secure/);
  assert.match(body, /ptg_ordered_product_search", params/);
  assert.match(body, /identity\(clean\(product\.barcode/);
  assert.match(body, /maxPages = 10/);
  assert.match(body, /partial: count > maxPages \* 5/);
  assert.match(edge, /case "comparable-offers": return await comparableOffers/);
});

test("complete only within search cap, no cash prices or raw memo-product rows leave server", () => {
  const body = edge.slice(edge.indexOf("async function comparableOffers("), edge.indexOf("async function productInsights("));
  const data = body.slice(body.indexOf("eligible.push({"), body.indexOf("});", body.indexOf("eligible.push({")));
  for (const field of ["id:", "barcode:", "memo_id:", "campaign:", "remarks:", "tag_this:", "srp:", "price_memos:"]) {
    assert.ok(data.includes(field), field + " is needed for comparison");
  }
  assert.doesNotMatch(data, /\bcash_payment\s*:|\bunit_only_offer\s*:|\bserials\s*:/);
  assert.match(body, /not all historical memo revisions/);
});

test("PTG UI distinguishes partially fetched results and cannot queue comparison-only offer data", () => {
  assert.match(ui, /action: "comparable-offers"/);
  assert.match(ui, /setComparisonPartial\(payload\.partial === true\)/);
  assert.match(ui, /Only the first 50 searchable offer rows/);
  assert.doesNotMatch(ui, /Compare only — search to select/);
  assert.doesNotMatch(ui, /Price options for this barcode/);
  assert.match(ui, /older replaced memo prices are not included/i);
  assert.match(ui, /reviewOfferConflicts\(detailProduct, visible\)/);
  assert.match(ui, /Price options — selected memo/);
});
