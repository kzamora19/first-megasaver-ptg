import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { publishCatalog, readCatalog } from "./catalog-pilot.ts";

function workbook(rows, status) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Barcode", "Description", "Brand", "Category", "Subcategory", "SRP"], ...rows,
  ]), "Products");
  if (status) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["property", "value"], ["review_status", status],
  ]), "Import Manifest");
  return book;
}

const product = ["00012345", "Sample refrigerator", "Sample Brand", "Appliance", "Refrigerator", 12000];
test("read catalog keeps text barcodes and excludes prices", () => {
  assert.deepEqual(readCatalog(workbook([product], "VALIDATED_FOR_EXTRACTOR_RULES"), XLSX), [{
    barcode: "00012345", description: "Sample refrigerator", brand: "Sample Brand",
    category: "Appliance", sub_category: "Refrigerator",
  }]);
});

test("read catalog rejects unresolved review, incomplete data and normalized duplicates", () => {
  assert.throws(() => readCatalog(workbook([product], "REVIEW_REQUIRED"), XLSX), /Resolve the Data Desk/);
  assert.throws(() => readCatalog(workbook([product.slice(0, 4)]), XLSX), /Fill in all five/);
  assert.throws(() => readCatalog(workbook([product, ["12345", ...product.slice(1)]]), XLSX), /duplicate barcode/);
});

test("retry checks the failed destination again and skips the one that saved", async () => {
  let results = { sales: { state: "pending" }, ptg: { state: "pending" } };
  const sends = [];
  const authorize = async destination => {
    if (destination === "ptg" && results.ptg.state === "pending") throw new Error("Session expired");
  };
  const send = async destination => {
    sends.push(destination);
    return { state: "saved" };
  };
  await publishCatalog(results, authorize, send, value => { results = value; });
  assert.deepEqual(results, { sales: { state: "saved" }, ptg: { state: "blocked", detail: "Session expired" } });
  await publishCatalog(results, authorize, send, value => { results = value; });
  assert.deepEqual(sends, ["sales", "ptg"]);
  assert.equal(results.ptg.state, "saved");
});

test("a lost response is flagged for verification and never retried automatically", async () => {
  let results = { sales: { state: "pending" } };
  let attempts = 0;
  const send = async () => { attempts++; throw new Error("Connection lost"); };
  await publishCatalog(results, async () => {}, send, value => { results = value; });
  await publishCatalog(results, async () => {}, send, value => { results = value; });
  assert.equal(attempts, 1);
  assert.equal(results.sales.state, "verify");
});
