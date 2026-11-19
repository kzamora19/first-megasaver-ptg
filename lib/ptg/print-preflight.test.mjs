import test from "node:test";
import assert from "node:assert/strict";
import { reviewPrintQueue } from "./print-preflight.mjs";

test("every format calculates page count without altering queue", () => {
  const one = Object.freeze({ brand: "LG", barcode: "123", model: "ABC", srp: 1200, tag_this: 1100 });
  const queue = Object.freeze(Array(7).fill(one));
  for (const [format, expected] of Object.entries({ ONE: 7, TWO: 4, FOUR: 2, SIX: 2, SMALL_APPS: 2, CARAVAN: 2 })) {
    const result = reviewPrintQueue(queue, format);
    assert.equal(result.pages, expected, format);
    assert.deepEqual(result.problems, []);
  }
  assert.equal(reviewPrintQueue(queue, "AIRCON", { airconPages: 3 }).pages, 3);
  assert.equal(queue.length, 7);
});

test("review detects missing fields, long text and unsupported aircon but never blocks", () => {
  const product = Object.freeze({ brand: "", barcode: "", description: "Long ".repeat(25), srp: 0, tag_this: 0 });
  const result = reviewPrintQueue([product], "SIX");
  assert.ok(result.problems.some(issue => issue.code === "TEXT_FIT"));
  assert.ok(result.problems.some(issue => issue.code === "BARCODE"));
  assert.ok(result.problems.some(issue => issue.code === "PRICE"));
  const aircon = reviewPrintQueue([product], "AIRCON", { airconPages: 0 });
  assert.ok(aircon.problems.some(issue => issue.code === "AIRCON"));
  assert.equal(product.srp, 0);
});

test("small appliances and caravan print using SRP even when a promotional Tag This exists", () => {
  const product = { brand: "ASAHI", barcode: "1", model: "ABC", srp: 1200, tag_this: 0 };
  assert.ok(!reviewPrintQueue([product], "SMALL_APPS").problems.some(issue => issue.code === "PRICE"));
  assert.ok(!reviewPrintQueue([product], "CARAVAN").problems.some(issue => issue.code === "PRICE"));
  assert.ok(reviewPrintQueue([product], "TWO").problems.some(issue => issue.code === "PRICE"));
});

test("print validation is UI-only, queue contents and print layout remain unchanged", () => {
  assert.equal(reviewPrintQueue([], "TWO").pages, 0);
  assert.throws(() => reviewPrintQueue([], "FOURTEEN"), /Unsupported/);
});
