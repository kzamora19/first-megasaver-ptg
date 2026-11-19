import test from "node:test";
import assert from "node:assert/strict";
import { groupPriceRevisionEvents } from "./revision-diff.mjs";

const event = (id, operation, extra = {}) => ({
  id, transactionId: 12345, memoNumber: "NOV-001", barcode: "00000528",
  operation, tagThis: operation === "DELETE" ? "1940" : "1860",
  srp: "2200", remarks: "Free Installation", sourcePeriod: "November 2026",
  recordedAt: "2026-11-18T00:00:00Z", importedBy: "System Admin", ...extra,
});
test("old/new are paired only in the same transaction and matching variant", () => {
  const result = groupPriceRevisionEvents([event(1,"DELETE"),event(2,"INSERT")]);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, "Replacement (both sides recorded)");
  assert.equal(result[0].oldPrice, 1940);
  assert.equal(result[0].newPrice, 1860);
  assert.equal(result[0].oldSrp, 2200);
});
test("unit-only and installation are distinct; ambiguous duplicate offers are not paired", () => {
  const rows = groupPriceRevisionEvents([
    event(1,"DELETE"), event(2,"INSERT", { remarks: "UNIT ONLY" }),
  ]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => !row.status.includes("Replacement")));
  const multi = groupPriceRevisionEvents([event(1,"DELETE"),event(2,"DELETE"),event(3,"INSERT")]);
  assert.match(multi[0].status, /Multiple variants/);
  assert.equal(multi[0].oldPrice, null);
});
test("page boundaries do not invent nonexistent old prices", () => {
  const alone = groupPriceRevisionEvents([event(2,"INSERT")]);
  assert.equal(alone.length, 1);
  assert.equal(alone[0].oldPrice, null);
  assert.match(alone[0].status, /page-local/i);
});
