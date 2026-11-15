"use client";

import { useState } from "react";
import { invokePtgData, usesEdgeData } from "@/lib/ptg/edge-api";
import { inspectSubdealerPdf, type SubdealerPreview } from "@/lib/ptg/subdealer-pdf";

type ImportState = "READY" | "REVIEW" | "IMPORTED" | "SKIPPED" | "FAILED";
type Entry = { id: number; fileName: string; preview?: SubdealerPreview; error?: string; state: ImportState };
type ImportResult = { ok?: boolean; summary?: { skipped?: boolean; duplicate?: boolean; totalProducts?: number }; message?: string };

export default function SubdealerMemoImporter() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [duplicateAction, setDuplicateAction] = useState<"SKIP" | "REPLACE">("SKIP");
  const [message, setMessage] = useState("");

  async function selectFiles(files: FileList | null) {
    const input = [...(files ?? [])];
    setEntries([]);
    setMessage("");
    if (!input.length) return;
    setBusy(true);
    try {
      const next: Entry[] = [];
      for (const [id, file] of input.entries()) {
        try {
          const preview = await inspectSubdealerPdf(file);
          next.push({ id, fileName: file.name, preview,
            state: preview.issues.length ? "REVIEW" : "READY" });
        } catch (error) {
          next.push({ id, fileName: file.name,
            error: error instanceof Error ? error.message : "Could not read PDF.",
            state: "REVIEW" });
        }
      }
      // Different memos with the same effective start date must never
      // silently overwrite each other's price for a shared barcode.
      const seen = new Map<string, { memoId: string; fileName: string; entry: Entry }>();
      for (const entry of next) {
        const preview = entry.preview;
        if (!preview) continue;
        for (const product of preview.products) {
          const key = product.barcode.replace(/^0+(?=\d)/, "") + ":" + preview.period.slice(0, 10);
          const prior = seen.get(key);
          if (prior && prior.memoId !== preview.memoId) {
            entry.preview!.issues.push("Conflicting same-date price for " + product.barcode +
              " in " + prior.fileName + ". Both files require review.");
            prior.entry.preview!.issues.push("Conflicting same-date price for " + product.barcode +
              " in " + entry.fileName + ". Both files require review.");
            entry.state = "REVIEW";
            prior.entry.state = "REVIEW";
          } else {
            seen.set(key, { memoId: preview.memoId, fileName: entry.fileName, entry });
          }
        }
      }
      setEntries(next);
      const review = next.filter(item => item.state === "REVIEW").length;
      setMessage(next.length + " PDFs reviewed; " + review +
        " require attention before import. No files have been uploaded.");
    } finally {
      setBusy(false);
    }
  }

  async function importReady() {
    if (!usesEdgeData || busy) return;
    // Import chronologically, regardless of file chooser or ZIP order.
    // The newest effective memo then supersedes prices in earlier ones.
    const pending = entries.filter(item => item.state === "READY" && item.preview)
      .sort((a, b) => a.preview!.period.localeCompare(b.preview!.period)
        || a.preview!.memoId.localeCompare(b.preview!.memoId));
    if (!pending.length) return;
    if (duplicateAction === "REPLACE" &&
        !window.confirm("Replace matching memo numbers and their existing products?")) return;
    setBusy(true);
    let imported = 0, skipped = 0, failed = 0;
    try {
      for (const entry of pending) {
        const preview = entry.preview!;
        try {
          const result = await invokePtgData("ptg-memos", {
            action: "import", importKind: "SUBDEALER_PDF",
            memoId: preview.memoId, period: preview.period,
            memoType: "MEMO_LIST", sourceFile: preview.fileName,
            duplicateAction, products: preview.products,
          }) as ImportResult;
          if (!result.ok) throw Error(result.message || "Import failed.");
          const state = result.summary?.skipped ? "SKIPPED" : "IMPORTED";
          if (state === "SKIPPED") skipped++; else imported++;
          setEntries(current => current.map(item => item.id === entry.id ? { ...item, state } : item));
        } catch (error) {
          failed++;
          setEntries(current => current.map(item => item.id === entry.id ?
            { ...item, state: "FAILED", error: error instanceof Error ? error.message : "Import failed." } : item));
        }
      }
      setMessage("Batch complete: " + imported + " imported, " +
        skipped + " skipped, " + failed + " failed.");
    } finally {
      setBusy(false);
    }
  }

  const ready = entries.filter(entry => entry.state === "READY");
  const totals = entries.reduce((s, e) => s + (e.preview?.extractedRows ?? 0), 0);

  return <div className="admin-layout">
    <section className="admin-card">
      <h2>SUBDEALER MEMO IMPORTER</h2>
      <p className="admin-muted">Import subdealer promotional PDF memos. Required fields:
        barcode, brand, model/description, SRP and a price (Tag This or Cash Payment).
        Category is required; missing optional fields remain blank. Tag This falls back to Cash Payment
        only when Tag This is absent. Dates are normalized before import.</p>
      <p className="admin-muted">Choose one or more PDF files. For a ZIP folder,
        extract the PDFs first. Files with missing or misaligned values are held for review;
        nothing is imported automatically.</p>
      <label className="upload-drop">
        <input type="file" accept=".pdf,application/pdf" multiple disabled={busy}
          onChange={event => void selectFiles(event.target.files)} />
        <strong>Select subdealer PDF memos</strong>
        <span>Multiple PDFs · Maximum 20 MB each · Up to 10,000 products per memo</span>
      </label>
      {message && <p role="status" className="admin-muted">{message}</p>}
      {!!entries.length && <>
        <p><strong>{entries.length} PDF(s)</strong> · {totals.toLocaleString()} detected product rows ·
          {" "}{ready.length} ready to import</p>
        <div className="admin-table-wrap"><table className="admin-table">
          <thead><tr><th>Memo number</th><th>Period</th><th>PDF</th><th>Rows</th><th>Issues</th><th>Status</th></tr></thead>
          <tbody>{entries.map(entry => <tr key={entry.id}>
            <td>{entry.preview?.memoId || "—"}</td><td>{entry.preview?.period || "—"}</td>
            <td>{entry.fileName}</td><td>{entry.preview?.extractedRows ?? "—"}</td>
            <td>{entry.preview?.issues.length ?? (entry.error ? 1 : 0)}</td><td>{entry.state}</td>
          </tr>)}</tbody>
        </table></div>
        {entries.filter(entry => entry.state === "REVIEW" || entry.state === "FAILED").map(entry =>
          <section className="admin-card" key={entry.id}>
            <h3>{entry.fileName}: review required</h3>
            <ul>{[entry.error, ...(entry.preview?.issues ?? [])].filter(Boolean).slice(0, 20)
              .map((issue, i) => <li key={i}>{issue}</li>)}</ul>
            {(entry.preview?.issues.length ?? 0) > 20 &&
              <p>Additional issues: {(entry.preview?.issues.length ?? 0) - 20}. This memo has not been imported.</p>}
          </section>)}
        {ready.length > 0 && <section className="admin-card">
          <h3>Price preview — first ready memo</h3>
          <p className="admin-muted">Verify the prices against the original PDF before importing.</p>
          <div className="admin-table-wrap"><table className="admin-table">
            <thead><tr><th>Barcode</th><th>Brand</th><th>Category</th><th>Model</th><th>SRP</th><th>Cash Payment</th><th>Tag This</th></tr></thead>
            <tbody>{ready[0].preview!.products.slice(0, 10).map((row, i) => <tr key={row.barcode + ":" + i}>
              <td>{row.barcode}</td><td>{row.brand}</td><td>{row.category}</td><td>{row.model}</td>
              <td>{row.srp.toFixed(2)}</td><td>{row.cash_payment.toFixed(2)}</td>
              <td>{row.tag_this.toFixed(2)}</td>
            </tr>)}</tbody>
          </table></div>
        </section>}
        <label className="admin-field"><span>Existing memo number</span>
          <select disabled={busy} value={duplicateAction}
            onChange={event => setDuplicateAction(event.target.value as "SKIP" | "REPLACE")}>
            <option value="SKIP">Skip existing (recommended)</option>
            <option value="REPLACE">Replace existing memo and products</option>
          </select>
        </label>
        <button type="button" className="admin-button" disabled={busy || !ready.length || !usesEdgeData}
          onClick={() => void importReady()}>{busy ? "PROCESSING…" : "IMPORT " + ready.length + " SUBDEALER MEMO(S)"}</button>
      </>}
    </section>
  </div>;
}
