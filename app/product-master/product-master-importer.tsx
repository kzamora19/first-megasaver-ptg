"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Product = { barcode: string; description: string; brand: string; category: string; sub_category: string };
type ImportSummary = { received: number; uniqueValid: number; inserted: number; updated: number; invalidRows: number; duplicateRows: number };

const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[\\s_\\-]+/g, "");
const aliases = {
  barcode: ["barcode", "itemcode", "itemnumber", "itemno", "sku"],
  description: ["description", "itemname", "productdescription", "model"],
  brand: ["brand", "brandname"],
  category: ["category", "majorcategory"],
  sub_category: ["subcategory", "subcategoryname", "minorcategory"],
};

function parseSheet(fileName: string, rows: unknown[][]): Product[] {
  const headerIndex = rows.findIndex(row => {
    const headers = row.map(normalize);
    return aliases.barcode.some(a => headers.includes(a)) && aliases.description.some(a => headers.includes(a));
  });
  if (headerIndex < 0) throw new Error("Could not identify the required columns. Include Barcode or Item Code, and Description or Item Name.");
  const headers = rows[headerIndex].map(normalize);
  const findColumn = (keys: readonly string[]) => headers.findIndex(h => keys.includes(h));
  const columns = {
    barcode: findColumn(aliases.barcode),
    description: findColumn(aliases.description),
    brand: findColumn(aliases.brand),
    category: findColumn(aliases.category),
    sub_category: findColumn(aliases.sub_category),
  };
  const get = (row: unknown[], index: number) => index < 0 ? "" : String(row[index] ?? "").trim();
  return rows.slice(headerIndex + 1).map(row => ({
    barcode: get(row, columns.barcode),
    description: get(row, columns.description),
    brand: get(row, columns.brand),
    category: get(row, columns.category),
    sub_category: get(row, columns.sub_category),
  })).filter(row => row.barcode || row.description);
}

export default function ProductMasterImporter() {
  const [fileName, setFileName] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const preview = useMemo(() => products.slice(0, 8), [products]);

  async function handleFile(file?: File) {
    setMessage(""); setError(false); setSummary(null); setProducts([]); setFileName("");
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setError(true); setMessage("File is larger than 15 MB. Please split it into smaller files."); return; }
    try {
      const buffer = await file.arrayBuffer();
      let rows: unknown[][];
      if (/\\.csv$/i.test(file.name)) {
        const text = new TextDecoder("utf-8").decode(buffer);
        const workbook = XLSX.read(text, { type: "string" });
        rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: false, defval: "" }) as unknown[][];
      } else {
        const workbook = XLSX.read(buffer, { type: "array", cellText: true, cellDates: false });
        if (!workbook.SheetNames.length) throw new Error("The workbook has no worksheets.");
        rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: false, defval: "" }) as unknown[][];
      }
      const parsed = parseSheet(file.name, rows);
      if (!parsed.length) throw new Error("No product rows were found below the header.");
      if (parsed.length > 5000) throw new Error("This file contains more than 5,000 product rows. Split it before importing.");
      setProducts(parsed); setFileName(file.name);
      setMessage("File read successfully. Review the sample below before importing.");
    } catch (e) {
      setError(true); setMessage(e instanceof Error ? e.message : "Unable to read this file.");
    }
  }

  async function importProducts() {
    if (!products.length || !fileName || busy) return;
    setBusy(true); setMessage(""); setError(false); setSummary(null);
    try {
      const response = await fetch("/api/products/master", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceFile: fileName, rows: products }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "Import failed.");
      setSummary(result.summary as ImportSummary);
      setMessage("Product Master import completed.");
      setProducts([]);
    } catch (e) {
      setError(true); setMessage(e instanceof Error ? e.message : "Import failed.");
    } finally { setBusy(false); }
  }

  return (
    <section className="admin-layout">
      <div className="admin-card">
        <h3>Import product reference file</h3>
        <p className="admin-muted">Supported formats: Excel (.xlsx, .xls) and CSV. Required columns: Barcode or Item Code, and Description or Item Name. Brand, Category and Sub-category are optional.</p>
        <label className="upload-drop">
          <input type="file" accept=".xlsx,.xls,.csv" onChange={e => void handleFile(e.target.files?.[0])} />
          <strong>Choose an Excel or CSV file</strong>
          <span>Maximum 15 MB · Up to 5,000 product rows</span>
        </label>
        {fileName && <p className="admin-muted">Selected: <strong>{fileName}</strong> · {products.length.toLocaleString()} rows</p>}
        {message && <p className={error ? "admin-alert error" : "admin-alert success"} role="status">{message}</p>}
        {products.length > 0 && <>
          <div className="admin-list-heading"><div><h3>Import preview</h3><p className="admin-muted">Showing {preview.length} of {products.length.toLocaleString()} rows. Barcode values are kept as text.</p></div></div>
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Barcode</th><th>Description</th><th>Brand</th><th>Category</th><th>Sub-category</th></tr></thead><tbody>
            {preview.map((row, index) => <tr key={index}><td>{row.barcode}</td><td>{row.description}</td><td>{row.brand || "—"}</td><td>{row.category || "—"}</td><td>{row.sub_category || "—"}</td></tr>)}
          </tbody></table></div>
          <button className="admin-button" onClick={() => void importProducts()} disabled={busy}>{busy ? "IMPORTING…" : `IMPORT ${products.length.toLocaleString()} ROWS`}</button>
        </>}
        {summary && <div className="import-summary"><strong>Import summary</strong><div className="import-summary-grid">
          <span>Received <b>{summary.received.toLocaleString()}</b></span><span>Inserted <b>{summary.inserted.toLocaleString()}</b></span><span>Updated <b>{summary.updated.toLocaleString()}</b></span><span>Invalid <b>{summary.invalidRows.toLocaleString()}</b></span><span>Duplicates <b>{summary.duplicateRows.toLocaleString()}</b></span>
        </div></div>}
        <p className="admin-footnote">Import matches records by barcode. Existing barcodes are updated; new barcodes are inserted. The original source file is not modified.</p>
      </div>
    </section>
  );
}
