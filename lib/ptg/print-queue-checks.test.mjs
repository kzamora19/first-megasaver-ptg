import test from "node:test";
import assert from "node:assert/strict";
import { summarizePrintQueue } from "./print-queue-checks.mjs";

test("queue brand counts do not mutate order or product records", () => {
  const queue = Object.freeze([
    Object.freeze({ id: "a", brand: "TCL", barcode: "100" }),
    Object.freeze({ id: "b", brand: " LG ", barcode: "200" }),
    Object.freeze({ id: "c", brand: "TCL", barcode: "300" }),
  ]);
  const result = summarizePrintQueue(queue);
  assert.deepEqual(result.brands, [{ brand: "LG", count: 1 }, { brand: "TCL", count: 2 }]);
  assert.equal(result.total, 3);
  assert.deepEqual(result.sharedBarcodes, []);
  assert.equal(queue.length, 3);
});

test("shared barcodes are a warning, not an automatic removal", () => {
  const queue = [
    { id: "installed", brand: "LG", barcode: "00000123" },
    { id: "unit-only", brand: "LG", barcode: "00000123" },
    { id: "other", brand: "TCL", barcode: "00000001" },
  ];
  const result = summarizePrintQueue(queue);
  assert.deepEqual(result.sharedBarcodes, ["00000123"]);
  assert.equal(result.total, 3);
  assert.deepEqual(result.brands, [{ brand: "LG", count: 2 }, { brand: "TCL", count: 1 }]);
});
