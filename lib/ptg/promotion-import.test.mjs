import assert from "node:assert/strict";
import test from "node:test";
import { buildPromotionPlan, toPromotionMemo } from "./promotion-import.ts";
import { preparePromotionImport } from "../../../branchline-main/import-engine/promotion-import.mjs";
import { promotionVariantKey } from "../../../branchline-main/import-engine/promotion-pdf.mjs";

const engine = { preparePromotionImport, promotionVariantKey, brands: ["CAMEL", "ASAHI", "LG"] };
const row = {
  id: "one", barcode: "65433", description: "BUY5 GET1 CK-2010S CAMEL", brand: "CAMEL", category: "",
  remarks: "BUY5 GET1", sourceName: "offers.pdf", sourcePage: 1, sourceExcerpt: "BUY5 GET1 CK-2010S CAMEL",
  validFrom: "2026-10-01", validTo: "2026-12-31", memoSrp: null, tagPrice: 3479, cashPayment: null,
  model: "", installments: [], sourceColumns: { description: "BUY5 GET1 CK-2010S CAMEL" }, warnings: [],
};
const branches = [{ id: "stg", name: "Santiago", code: "STG" }];
const catalog = [{ branch_id: "stg", barcode: "00056682", brand: "CAMEL", model_description: "CAMEL CK-2010S KETTLE", srp: 710 }];
const source = rows => [{ name: "offers.pdf", digest: "a".repeat(64), url: "", rows }];

test("one promotion barcode maps to five paid and one free stock unit", async () => {
  const plan = await buildPromotionPlan(engine, source([row]), new Set(["one"]), { sales: true, ptg: true }, branches, catalog, {});
  assert.equal(plan.exceptions.length, 0);
  assert.equal(plan.jobs.length, 2);
  assert.equal(plan.jobs[0].ptg.body.products.length, 1);
  assert.equal(plan.jobs[0].ptg.body.products[0].barcode, "00065433");
  const offer = plan.jobs[1].sales.params.p_offers[0];
  assert.equal(offer.p_barcode, "00065433");
  assert.deepEqual(offer.p_components.map(part => [part.barcode, part.quantity, part.free]),
    [["00056682", 5, false], ["00056682", 1, true]]);
});

test("monthly amounts keep their printed rate and PTG receives the corresponding term total", () => {
  const furniture = { ...row, description: "ICONS DINING SET", brand: "ICONS", tagPrice: 48599,
    installments: [{ months: 12, amount: 4415, basis: "monthly", raw: "4415/MO." }] };
  const product = toPromotionMemo(furniture, []);
  assert.equal(product.months_12 / 12, 4415);
  assert.equal(product.tag_this, 48599);
  assert.equal(furniture.installments[0].amount, 4415);
  assert.throws(() => toPromotionMemo({ ...furniture, tagPrice: null }, []), /installment amount remains separate/);
});

test("different source offers stay selectable and an amended PTG selection receives a different stable memo identity", async () => {
  const other = { ...row, id: "two", tagPrice: 3499 };
  const both = await buildPromotionPlan(engine, source([row, other]), new Set(["one", "two"]), { ptg: true, sales: true }, branches, catalog, {});
  assert.equal(both.jobs.length, 2);
  assert.equal(both.exceptions.length, 0);
  assert.equal(both.jobs[0].ptg.body.products.length, 2);
  assert.deepEqual(both.jobs[1].sales.params.p_offers.map(offer => offer.p_price_conflict), [true, true]);
  const first = await buildPromotionPlan(engine, source([row, other]), new Set(["one"]), { ptg: true, sales: false }, [], [], {});
  const again = await buildPromotionPlan(engine, source([row, other]), new Set(["one"]), { ptg: true, sales: false }, [], [], {});
  const amended = await buildPromotionPlan(engine, source([row, other]), new Set(["two"]), { ptg: true, sales: false }, [], [], {});
  assert.equal(first.jobs[0].ptg.body.memoId, again.jobs[0].ptg.body.memoId);
  assert.notEqual(first.jobs[0].ptg.body.memoId, amended.jobs[0].ptg.body.memoId);
});

test("a manually mapped combination still requires valid inventory codes and paid quantities", async () => {
  const combo = { ...row, description: "BUNDLE CAMEL CK-2010S + OTHER PRODUCT", category: "BUNDLE", remarks: "" };
  const valid = [{ id: "paid", barcode: "56682", quantity: 1, free: false }];
  const plan = await buildPromotionPlan(engine, source([combo]), new Set(["one"]), { ptg: false, sales: true }, branches, catalog, { one: valid });
  assert.equal(plan.jobs.length, 1);
  const invalid = await buildPromotionPlan(engine, source([combo]), new Set(["one"]), { ptg: false, sales: true }, branches, catalog,
    { one: [{ ...valid[0], barcode: "99999" }] });
  assert.equal(invalid.jobs.length, 0);
  assert.match(invalid.exceptions[0].detail, /component barcodes/);
});

test("different covered periods keep separate PTG memo headers", async () => {
  const later = { ...row, id: "two", barcode: "65434", validFrom: "2026-11-01" };
  const plan = await buildPromotionPlan(engine, source([row, later]), new Set(["one", "two"]),
    { ptg: true, sales: false }, [], [], {});
  assert.equal(plan.jobs.length, 2);
  assert.notEqual(plan.jobs[0].key, plan.jobs[1].key);
  assert.equal(plan.jobs[0].ptg.body.period, "2026-10-01 to 2026-12-31");
  assert.equal(plan.jobs[1].ptg.body.period, "2026-11-01 to 2026-12-31");
});
