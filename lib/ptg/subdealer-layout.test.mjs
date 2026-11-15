import assert from "node:assert/strict";
import test from "node:test";
import { positionedSubdealerRows } from "./subdealer-pdf-layout.mjs";

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
  const [row] = positionedSubdealerRows(table(false));
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
  const [row] = positionedSubdealerRows(table(true));
  assert.ok(row);
  assert.equal(row.cashPayment, 11085.79);
  assert.equal(row.tagPrice, 12000);
  assert.notEqual(row.tagPrice, row.cashPayment);
});


test("landscape subdealer PDF multiline header normalizes CASH  PAYMENT and distinct TAG THIS", () => {
  const headers = [
    item("BRAND", 29, 460, 35), item("CATEGORY", 70, 460, 48),
    item("BARCODE", 118, 460, 41), item("MODEL", 168, 460, 36),
    item("SRP", 222, 460, 20),
    item(" CASH  PAYMENT ", 250, 462, 65),
    item("ONLY", 261, 457, 24),
    item("CASH TERM / H.C", 296, 472, 62),
    item("TAG THIS", 299, 442, 55),
    item("6 Months 0%", 347, 492, 40),
    item("9 Months 0%", 388, 492, 40),
    item("12 Months 0%", 428, 492, 40),
    item("18 Months 0%", 468, 492, 40),
    item("24 Months 0%", 508, 492, 40),
    item(" H.C  /  CARD ", 347, 462, 40),
  ];
  const data = {
    sourceName: "SUBCON-86 SAMPLE.pdf",
    pages: [{ number: 1, items: [
      ...headers,
      item("SAMSUNG", 30, 433, 30),
      item("WASHER & DRYER", 65, 433, 49),
      item("00033929", 119, 433, 40),
      item("WA75H4200SW", 148, 433, 65),
      item("₱15,995.00", 207, 433, 51),
      item("12,951.85", 246, 433, 62),
      item("13,520", 324, 433, 26),
      item("13,808", 364, 433, 26),
      item("14,264", 405, 433, 26),
      item("14,752", 445, 433, 26),
      item("15,834", 486, 433, 26),
    ] }],
  };
  const [row] = positionedSubdealerRows(data);
  assert.ok(row, "First real-style landscape row must be detected");
  assert.equal(row.barcode, "00033929");
  assert.equal(row.memoSrp, 15995);
  assert.equal(row.cashPayment, 12951.85);
  assert.equal(row.tagPrice, 13520);
});


test("TCL TV portrait memo keeps unlabelled remarks out of Cash Payment", () => {
  const data = { sourceName: "SUB2026-039 TCL TV.pdf", pages: [{ number: 1, items: [
    item("BRAND", 33, 651, 22), item("CATEGORY", 88, 651, 32),
    item("BARCODE", 150, 651, 30), item("MODEL", 215, 651, 22),
    item("SRP", 285, 651, 12), item("CASH  PAYMENT ", 320, 654, 40),
    item("1", 20, 614, 3), item("TCL", 44, 615, 10),
    item("TV", 101, 615, 7), item("00053479", 151, 614, 26),
    item("55P635", 188, 614, 20), item("₱30,995.00", 265, 614, 30),
    item("17,817", 343, 614, 18), item("EOL", 461, 614, 12),
  ] }] };
  const [row] = positionedSubdealerRows(data);
  assert.equal(row.brand, "TCL");
  assert.equal(row.model, "55P635");
  assert.equal(row.cashPayment, 17817);
  assert.equal(row.remarks, "EOL");
  assert.deepEqual(row.warnings, []);
});

test("short model codes next to barcode are not swallowed into barcode field", () => {
  const data = { sourceName: "SUB2026-329 DAIKIN.pdf", pages: [{ number: 1, items: [
    item("BRAND", 29, 630, 21), item("CATEGORY", 85, 630, 32),
    item("BARCODE", 150, 630, 31), item("MODEL", 231, 630, 23),
    item("SRP", 295, 630, 18), item("CASH PAYMENT", 360, 632, 45),
    item("DAIKIN", 29, 608, 21), item("Air Purifier", 85, 608, 29),
    item("00051072", 151, 608, 28), item("MC30", 191, 608, 17),
    item("₱12,900.00", 296, 608, 32), item("5,859.90", 354, 608, 52),
  ] }] };
  const [row] = positionedSubdealerRows(data);
  assert.equal(row.barcode, "00051072");
  assert.equal(row.model, "MC30");
  assert.equal(row.cashPayment, 5859.9);
  assert.deepEqual(row.warnings, []);
});

test("TAG THIS heading near first row is not mistaken for part of its price", () => {
  const data = { sourceName: "SUBCON-89 SAMSUNG.pdf", pages: [{ number: 2, items: [
    item("BRAND", 35, 520, 20), item("CATEGORY", 75, 520, 30),
    item("BARCODE", 120, 520, 22), item("MODEL", 168, 520, 24),
    item("SRP", 206, 520, 22), item("CASH PAYMENT", 247, 522, 39),
    item("TAG THIS", 298, 489, 28), item("REMARKS", 640, 557, 30),
    item("HAIER", 35, 484, 20), item("WASHER & DRYER", 69, 484, 30),
    item("00060973", 119, 484, 20), item("HWM110-B1678ES8", 147, 484, 27),
    item("₱30,998.00", 206, 484, 23), item("15,829.94", 247, 484, 39),
    item("16,524", 324, 483, 16),
  ] }] };
  const [row] = positionedSubdealerRows(data);
  assert.equal(row.tagPrice, 16524);
  assert.equal(row.cashPayment, 15829.94);
  assert.deepEqual(row.warnings, []);
});
