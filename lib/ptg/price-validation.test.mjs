import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkProductPrice, philippineToday } from "./price-validation.mjs";

const base = { barcode: "00000528", srp: 1940, tag_this: 1720, campaign: null };
const codes = value => checkProductPrice(value, "2026-11-18").map(entry => entry.code);

test("valid SRP and tagged price do not generate false warnings", () => {
  assert.deepEqual(codes(base), []);
  assert.equal(philippineToday(new Date("2026-11-17T17:00:00Z")), "2026-11-18");
});

test("missing SRP and price raise warnings but never mutate or block", () => {
  const missing = Object.freeze({ ...base, srp: 0, tag_this: 0, barcode: "" });
  assert.deepEqual(codes(missing), ["NO_BARCODE", "NO_SRP", "NO_TAG_PRICE"]);
  assert.equal(missing.srp, 0);
  assert.equal(missing.tag_this, 0);
  assert.deepEqual(codes({ ...base, tag_this: 2500 }), ["ABOVE_SRP"]);
  assert.ok(checkProductPrice({ ...base, tag_this: 2500 }, "2026-11-18").every(x => x.level === "warning"));
});

test("early-print and expired promo periods are informational or warning-only", () => {
  const future = { ...base, campaign: "7MBDS", selling_starts_on: "2026-11-20",
    selling_ends_on: "2026-11-22", early_print_only: true };
  assert.deepEqual(codes(future), ["PROMO_EARLY"]);
  assert.equal(checkProductPrice(future, "2026-11-18")[0].level, "info");
  assert.deepEqual(codes({ ...future, early_print_only: false }), ["PROMO_EARLY"]);
  assert.deepEqual(checkProductPrice(future, "2026-11-23").map(x => x.code), ["PROMO_ENDED"]);
  assert.deepEqual(codes({ ...future, selling_starts_on: "2026-11-25",
    selling_ends_on: "2026-11-22" }), ["PROMO_EARLY", "INVALID_PROMO_DATES"]);
  assert.deepEqual(codes({ ...future, selling_starts_on: "2026-02-30",
    selling_ends_on: "2026-11-22" }), []);
});

test("unit-only pair mismatches are review notes, never data edits", () => {
  const paired = Object.freeze({ ...base, tag_this: 1700, unit_only_offer: { tag_this: 1850 } });
  assert.deepEqual(codes(paired), ["UNIT_ONLY_HIGHER"]);
  assert.equal(checkProductPrice(paired, "2026-11-18")[0].level, "info");
  assert.equal(paired.unit_only_offer.tag_this, 1850);
});

test("PTG page displays checks in existing detail modal and queue; print output unchanged", () => {
  const code = readFileSync(new URL("../../app/products/product-search.tsx", import.meta.url), "utf8");
  const modalAt = code.indexOf('<dl className="legacy-product-details">');
  const printAt = code.indexOf('@media print{');
  assert.ok(code.includes('import { checkProductPrice, philippineToday }'));
  assert.ok(code.includes('aria-label="Price review warnings"'));
  assert.ok(code.includes('role="status"'));
  assert.ok(modalAt > 0 && printAt > modalAt);
  assert.ok(code.includes('printing is not blocked.'));
  assert.ok(code.includes('ptg-price-checks'));
  assert.ok(code.includes('@page{size:letter'));
  assert.ok(code.includes('.legacy-print-sheet{width:8.5in!important'));
});
