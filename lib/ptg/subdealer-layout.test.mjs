import assert from "node:assert/strict";
import test from "node:test";
import { positionedPromotionRows } from "./promotion-pdf-layout.mjs";

const item = (text, x, y, width = 30) => ({
  text, width, height: 8, transform: [1, 0, 0, 1, x, y],
});
const table = (includeTag) => {
  const columns = [
    item("BRAND", 20, 720, 35), item("CATEGORY", 100, 720, 55),
    item("BARCODE", 190, 720, 48), item("MODEL", 265, 720, 40),
    item("SRP", 355, 720, 30), item("CASH PAYMENT", 420, 720, 65),
  ];
  if (includeTag) columns.push(item("TAG THIS", 510, 720, 50));
  const row = [
    item("CARRIER", 20, 700, 35), item("AIRCON", 100, 700, 55),
    item("00038505", 190, 700, 48), item("WCARZ006EC1", 265, 700, 65),
    item("₱13,990.00", 355, 700, 56), item("₱11,085.79", 420, 700, 58),
  ];
  if (includeTag) row.push(item("₱12,000.00", 510, 700, 60));
  return { sourceName: "SUB2026-327 SAMPLE.pdf", pages: [{ number: 1, items: [...columns, ...row] }] };
};

test("subdealer portrait memo extracts Cash Payment and leaves Tag This missing", () => {
  const [row] = positionedPromotionRows(table(false));
  assert.ok(row);
  assert.equal(row.barcode, "00038505");
  assert.equal(row.brand, "CARRIER");
  assert.equal(row.category, "AIRCON");
  assert.equal(row.description, "WCARZ006EC1");
  assert.equal(row.memoSrp, 13990);
  assert.equal(row.cashPayment, 11085.79);
  assert.equal(row.tagPrice, null);
  assert.equal(row.tagPrice ?? row.cashPayment, 11085.79);
});

test("subdealer landscape memo preserves distinct cash and tag values", () => {
  const [row] = positionedPromotionRows(table(true));
  assert.ok(row);
  assert.equal(row.cashPayment, 11085.79);
  assert.equal(row.tagPrice, 12000);
  assert.notEqual(row.tagPrice, row.cashPayment);
});
