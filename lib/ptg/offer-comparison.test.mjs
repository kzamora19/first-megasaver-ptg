import test from "node:test";
import assert from "node:assert/strict";
import { visibleOffersForBarcode, memoEntriesForOffer } from "./offer-comparison.mjs";

test("compare only currently visible same-barcode offer records, without altering queue", () => {
  const regular = Object.freeze({ id: "reg", barcode: "00000123", tag_this: 2500, campaign: null });
  const promo = Object.freeze({ id: "promo", barcode: "00000123", tag_this: 2200, campaign: "7MBDS" });
  const unrelated = Object.freeze({ id: "else", barcode: "00000345", tag_this: 1400 });
  const results = Object.freeze([regular, promo, unrelated]);
  const queued = Object.freeze([promo]);
  const rows = visibleOffersForBarcode(regular, results, queued);
  assert.deepEqual(rows.map(row => row.id), ["reg", "promo"]);
  assert.equal(regular.tag_this, 2500);
  assert.equal(queued.length, 1);
});

test("subdealer records never leak into regular comparison and missing barcodes do not combine products", () => {
  const selected = { id: "selected", barcode: "123", campaign: null };
  const subdealer = { id: "secret", barcode: "123", campaign: "SUBDEALER" };
  const others = [subdealer, { id: "other", barcode: "999" }];
  assert.deepEqual(visibleOffersForBarcode(selected, others).map(row => row.id), ["selected"]);
  assert.deepEqual(visibleOffersForBarcode(selected, others, [], { includeSubdealer: true }).map(row => row.id), ["selected", "secret"]);
  assert.deepEqual(visibleOffersForBarcode({ id: "blank", barcode: "" }, [{ id: "otherblank", barcode: "" }]).map(row => row.id), ["blank"]);
});

test("memo references are deduplicated, without inventing entries or interpreting them as full history", () => {
  const memo = { memo_id: "NOV-2026-012", period: "Nov 1-30, 2026", created_at: "2026-11-01", source_file: "November.pdf" };
  assert.deepEqual(memoEntriesForOffer({ price_memos: [memo, { ...memo }] }), [memo]);
  assert.deepEqual(memoEntriesForOffer({ price_memos: null }), []);
  assert.equal(memoEntriesForOffer({ price_memos: memo }).length, 1);
});
