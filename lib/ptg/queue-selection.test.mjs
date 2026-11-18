import test from "node:test";
import assert from "node:assert/strict";
import { appendVisibleBrandOffers } from "./queue-selection.mjs";

test("bulk add is limited to current search-page offers, without modifying selected products", () => {
  const current = Object.freeze([{ id: "a", brand: "LG", barcode: "001" }]);
  const results = Object.freeze([
    { id: "a", brand: "LG", barcode: "001" },
    { id: "b", brand: " LG ", barcode: "001" },
    { id: "c", brand: "TCL", barcode: "002" },
    { id: "d", brand: "LG", barcode: "003" },
  ]);
  const output = appendVisibleBrandOffers(current, results, "lg");
  assert.deepEqual(output.queue.map(item => item.id), ["a", "b", "d"]);
  assert.deepEqual(output.additions.map(item => item.id), ["b", "d"]);
  assert.equal(current.length, 1);
  assert.equal(results.length, 4);
});

test("legitimate separate same-barcode offers remain separate, and empty filter adds nothing", () => {
  const promo = { id: "promo", brand: "ASAHI", barcode: "123" };
  const regular = { id: "monthly", brand: "ASAHI", barcode: "123" };
  assert.deepEqual(appendVisibleBrandOffers([], [promo, regular], "ASAHI").queue.map(v => v.id),
    ["promo", "monthly"]);
  assert.deepEqual(appendVisibleBrandOffers([promo], [regular], "").queue, [promo]);
  assert.deepEqual(appendVisibleBrandOffers([promo], [regular], "LG").queue, [promo]);
});
