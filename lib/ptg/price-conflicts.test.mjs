import test from "node:test";
import assert from "node:assert/strict";
import { reviewOfferConflicts, reviewInstallments } from "./price-conflicts.mjs";

const offer = (id, extra = {}) => ({
  id, barcode: "00000528", memo_id: "NOV-2026", campaign: null,
  tag_this: 1940, months_6: 0, months_9: 0, months_12: 0,
  months_18: 0, months_24: 0, remarks: "", ...extra,
});
test("same-memo identical variant conflicting price or installments is warned", () => {
  const regular = offer("regular");
  const other = offer("other", { tag_this: 1910 });
  assert.equal(reviewOfferConflicts(regular, [other])[0]?.code, "SAME_MEMO_CONFLICT");
  assert.equal(reviewOfferConflicts(regular, [offer("inst", { months_6: 2100 })])[0]?.code, "SAME_MEMO_CONFLICT");
  assert.deepEqual(reviewOfferConflicts(regular, [offer("equal")]), []);
});

test("regular, 7MBDS and subdealer offers can intentionally differ without conflict", () => {
  const regular = offer("regular");
  const promo = offer("promo", { campaign: "7MBDS", memo_id: "7MBDS-11", tag_this: 1680 });
  const subdealer = offer("dealer", { campaign: "SUBDEALER", tag_this: 1350 });
  assert.deepEqual(reviewOfferConflicts(regular, [promo, subdealer]), []);
  assert.deepEqual(reviewOfferConflicts(promo, [regular, subdealer]), []);
});

test("unit-only and free-installation offers under one memo remain different variants", () => {
  const installation = offer("installed", { remarks: "FREE FIRST 10FT INSTALLATION" });
  const unit = offer("unit", { tag_this: 1500, remarks: "UNIT ONLY" });
  assert.deepEqual(reviewOfferConflicts(installation, [unit]), []);
  assert.deepEqual(reviewOfferConflicts(unit, [installation]), []);
});

test("different promotion memos conflict only when actual selling dates overlap", () => {
  const promo = offer("a", { memo_id: "PROMO-A", campaign: "7MBDS", tag_this: 1600,
    selling_starts_on: "2026-11-16", selling_ends_on: "2026-11-22" });
  const overlap = offer("b", { memo_id: "PROMO-B", campaign: "7MBDS", tag_this: 1800,
    selling_starts_on: "2026-11-20", selling_ends_on: "2026-11-28" });
  assert.equal(reviewOfferConflicts(promo, [overlap])[0]?.code, "OVERLAPPING_PROMO_CONFLICT");
  assert.deepEqual(reviewOfferConflicts(promo, [{ ...overlap, selling_starts_on: "2026-11-23" }]), []);
  assert.deepEqual(reviewOfferConflicts(promo, [{ ...overlap, selling_starts_on: null }]), []);
});

test("missing installments flag explicit requirements and internal gaps, not cash-only SRP offers", () => {
  assert.deepEqual(reviewInstallments(offer("srp")), []);
  assert.deepEqual(reviewInstallments(offer("cash", { remarks: "Cash Price Only" })), []);
  assert.equal(reviewInstallments(offer("promo", { installment_required: true }))[0].code, "MISSING_INSTALLMENT");
  assert.equal(reviewInstallments(offer("gap", { months_6: 2000, months_12: 2300 }))[0].code, "INSTALLMENT_GAP");
  assert.deepEqual(reviewInstallments(offer("short", { months_6: 2000, months_9: 2300 })), []);
});

test("barcodes with leading zeros compare safely without merging unrelated products", () => {
  const orig = offer("orig", { barcode: "00000528" });
  assert.equal(reviewOfferConflicts(orig, [offer("other", { barcode: "528", tag_this: 900 })]).length, 1);
  assert.deepEqual(reviewOfferConflicts(orig, [offer("other", { barcode: "529", tag_this: 900 })]), []);
});

test("identical memo and offer type also checks known SRP and restricted cash fields without inventing missing prices", () => {
  const selected = offer("primary", { srp: 2200, cash_payment: 1930 });
  assert.equal(reviewOfferConflicts(selected, [offer("updated-srp", { srp: 2300, cash_payment: 1930 })])[0]?.code, "SAME_MEMO_CONFLICT");
  assert.equal(reviewOfferConflicts(selected, [offer("updated-cash", { srp: 2200, cash_payment: 1880 })])[0]?.code, "SAME_MEMO_CONFLICT");
  assert.deepEqual(reviewOfferConflicts(selected, [offer("unknown-srp", { srp: null, cash_payment: null })]), []);
  assert.deepEqual(reviewOfferConflicts(selected, [offer("identical", { srp: 2200, cash_payment: 1930 })]), []);
});
