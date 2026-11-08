"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { requestPtgLogos, usesEdgeAssets } from "@/lib/ptg/edge-assets";
import { invokePtgData, usesEdgeData } from "@/lib/ptg/edge-api";
import { withBasePath } from "@/lib/base-path";

type MemoInfo = {
  memo_id: string;
  period: string;
  memo_type: string;
  created_at?: string;
};
type Product = {
  id: string;
  memo_id: string;
  brand: string;
  category: string;
  barcode: string;
  model: string;
  description: string;
  sub_category: string;
  srp: number;
  cash_payment: number;
  tag_this: number;
  months_6: number;
  months_9: number;
  months_12: number;
  months_18: number;
  months_24: number;
  remarks: string;
  eligible_for_price_tag?: boolean;
  price_tag_status?: string;
  price_memos: MemoInfo | MemoInfo[];
};
type FormatKey = "ONE" | "TWO" | "FOUR" | "SIX" | "AIRCON" | "SMALL_APPS" | "CARAVAN";
type LogoKey = "header" | "promo" | "social" | "appHeader";
type LogoMap = Partial<Record<LogoKey, { url: string; originalFileName: string; updatedAt: string }>>;

const formats: { key: FormatKey; label: string }[] = [
  { key: "ONE", label: "1 WHOLE" },
  { key: "TWO", label: "1/2" },
  { key: "FOUR", label: "2 X 2" },
  { key: "SIX", label: "2 X 3" },
  { key: "AIRCON", label: "AIRCON" },
  { key: "SMALL_APPS", label: "SMALL APPS" },
  { key: "CARAVAN", label: "CARAVAN" },
];
const pageSize = 5;

function Pagination({ page, totalPages, label, busy = false, onPage }: {
  page: number;
  totalPages: number;
  label: string;
  busy?: boolean;
  onPage: (page: number) => void;
}) {
  return <form className="legacy-pagination" aria-label={label} onSubmit={event => {
    event.preventDefault();
    const value = Number(new FormData(event.currentTarget).get("page"));
    if (!busy && Number.isSafeInteger(value) && value >= 1 && value <= totalPages) onPage(value);
  }}>
    <button type="button" aria-label="First page" disabled={busy || page <= 1} onClick={() => onPage(1)}>«</button>
    <button type="button" aria-label="Previous page" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>‹</button>
    <label><input key={page} name="page" type="number" min={1} max={totalPages} required aria-label={label + " page number"} defaultValue={page} disabled={busy} /> of {totalPages}</label>
    <button type="button" aria-label="Next page" disabled={busy || page >= totalPages} onClick={() => onPage(page + 1)}>›</button>
    <button type="button" aria-label="Last page" disabled={busy || page >= totalPages} onClick={() => onPage(totalPages)}>»</button>
    <button type="submit" disabled={busy}>Go</button>
  </form>;
}

function BlankRows({ used }: { used: number }) {
  return Array.from({ length: pageSize - used }, (_, index) =>
    <tr className="legacy-blank-row" aria-hidden="true" key={index}><td colSpan={8}>&nbsp;</td></tr>
  );
}
const amount = (value: number | null | undefined) => Number(value || 0);
const peso = (value: number | null | undefined) => "₱ " + amount(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const priceNow = (product: Product) => amount(product.tag_this);
const memoInfo = (product: Product | null): MemoInfo | null => {
  if (!product) return null;
  return Array.isArray(product.price_memos) ? product.price_memos[0] ?? null : product.price_memos;
};
const endDate = (period: string) => {
  const raw = String(period || "").trim();
  let match = raw.match(/^([A-Za-z]+)\s+\d{1,2}\s*[-–—]\s*(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})$/i);
  if (match) {
    const date = new Date(Number(match[3]), new Date(match[1] + " 1, " + match[3]).getMonth(), Number(match[2]));
    return isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  match = raw.match(/([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4})\s*(?:to|[-–—])\s*([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4})/i);
  if (match) {
    const date = new Date(match[2].replace(/(st|nd|rd|th)/gi, ""));
    return isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  match = raw.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|[-–—])\s*(\d{4}-\d{2}-\d{2})/i);
  if (match) {
    const date = new Date(match[2] + "T00:00:00");
    return isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  const dates = raw.match(/[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?/g) || [];
  if (dates.length) {
    const date = new Date(dates[dates.length - 1].replace(/(st|nd|rd|th)/gi, ""));
    return isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  return "";
};
const displayStatus = (product: Product) => {
  if (product.eligible_for_price_tag === true || String(product.price_tag_status || "").toUpperCase().includes("ELIGIBLE")) return "YES";
  if (product.eligible_for_price_tag === false || product.price_tag_status) return "NO";
  return "NO";
};
const shortText = (value: string, max = 40) => value.length > max ? value.slice(0, max - 1) + "…" : value;

export default function ProductSearch({
  branchCode,
  branchName = "",
  username = "",
  legacyRole = "",
  systemRole = "",
}: {
  branchCode: string;
  branchName?: string;
  username?: string;
  legacyRole?: string;
  systemRole?: string;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [queue, setQueue] = useState<Product[]>([]);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [queuePage, setQueuePage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [format, setFormat] = useState<FormatKey>("ONE");
  const [logoVersion, setLogoVersion] = useState(0);
  const [logos, setLogos] = useState<LogoMap>({});

  const refreshLogos = useCallback(async () => {
    try {
      const response = usesEdgeAssets
        ? await requestPtgLogos("GET")
        : await fetch("/api/logos", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.ok) setLogos(payload.logos || {});
    } catch {
      // Keep the built-in artwork if managed logos cannot be loaded.
    }
  }, []);

  useEffect(() => { void refreshLogos(); }, [refreshLogos]);

  const loadProducts = useCallback(async (query: string, requestedPage: number) => {
    setLoading(true);
    try {
      let payload: { ok: boolean; products: Product[]; total: number; page: number };
      if (usesEdgeData) {
        payload = await invokePtgData("ptg-products", {
          action: "search",
          q: query.trim(),
          page: requestedPage,
        }) as typeof payload;
      } else {
        const params = new URLSearchParams({ page: String(requestedPage) });
        if (query.trim()) params.set("q", query.trim());
        const response = await fetch("/api/products/search?" + params.toString(), { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || "Search failed.");
        payload = result;
      }
      if (!payload.ok) throw new Error("Search failed.");
      setSearchQuery(query);
      setResults(payload.products as Product[]);
      setTotal(Number(payload.total || 0));
      setPage(Number(payload.page || requestedPage));
      setMessage(query.trim()
        ? (payload.total ? payload.total + " matching product(s)." : "No matching products found.")
        : (payload.total ? "Imported price memo products." : "No imported price memo products found."));
    } catch (error) {
      setResults([]);
      setTotal(0);
      setMessage(error instanceof Error ? error.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProducts("", 1); }, [loadProducts]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const queueTotalPages = Math.max(1, Math.ceil(queue.length / pageSize));
  const visibleQueuePage = Math.min(queuePage, queueTotalPages);
  const queueRows = queue.slice((visibleQueuePage - 1) * pageSize, visibleQueuePage * pageSize);
  const firstResult = total ? (page - 1) * pageSize + 1 : 0;
  const lastResult = Math.min(page * pageSize, total);
  const currentMemo = memoInfo(activeProduct);
  const canImport = systemRole === "SYSTEM_ADMIN" || legacyRole.trim().toUpperCase() === "BRANCH ADMIN";
  const canManageUsers = systemRole === "SYSTEM_ADMIN" || legacyRole.trim().toUpperCase() === "BRANCH ADMIN";
  const isBranchToolsUser = systemRole === "SYSTEM_ADMIN" || ["BRANCH ADMIN", "TEAM LEADER"].includes(legacyRole.trim().toUpperCase());

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadProducts(term, 1);
  }

  function toggleProduct(product: Product, checked: boolean) {
    const next = checked
      ? (queue.some(item => item.id === product.id) ? queue : [...queue, product])
      : queue.filter(item => item.id !== product.id);
    setQueue(next);
    setQueuePage(current => Math.min(current, Math.max(1, Math.ceil(next.length / pageSize))));
    setActiveProduct(checked ? product : (activeProduct?.id === product.id ? next[next.length - 1] ?? null : activeProduct));
  }

  function toggleVisible(checked: boolean) {
    const next = checked
      ? [...queue, ...results.filter(product => !queue.some(item => item.id === product.id))]
      : queue.filter(item => !results.some(product => product.id === item.id));
    setQueue(next);
    setQueuePage(current => Math.min(current, Math.max(1, Math.ceil(next.length / pageSize))));
    setActiveProduct(checked ? results[0] ?? activeProduct : (next[next.length - 1] ?? null));
  }

  function setPrintFormat(next: FormatKey) {
    setFormat(next);
    if (next !== "ONE") setMessage(next + " template is coming from the current PTG migration.");
    else if (queue.length) setMessage(queue.length + " selected product(s) ready to print.");
  }

  function printTags() {
    if (!queue.length) {
      setMessage("Select at least one product before printing.");
      return;
    }
    if (format !== "ONE") {
      setMessage(format + " is not ready to print yet. The 1 WHOLE template is available first.");
      return;
    }
    const date = new Date();
    document.title = "FIRST_MEGASAVER_PRICE_TAGS_" + date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    window.print();
  }

  const currentBranchLabel = branchName || ({ CAU: "Cauayan", ILA: "Ilagan", STG: "Santiago", TUG: "Tuguegarao" } as Record<string, string>)[branchCode.toUpperCase()] || branchCode;

  return (
    <main className="ptg-main legacy-ptg-main">
      <img src={withBasePath(logos.appHeader?.url || "/legacy-ptg/app-header.png") + (logos.appHeader?.url ? "&" : "?") + "refresh=" + logoVersion} alt="1st Megasaver · Appliance · Gadgets · Furniture" className="ptg-print-hide" style={{ display: "block", width: "100%", height: "auto", margin: "0 0 9px", padding: 0, border: 0, borderRadius: 5 }} />

      {isBranchToolsUser && <section className="legacy-branch-tools ptg-print-hide">
        <div className="legacy-tools-heading"><strong>BRANCH TOOLS</strong><small>{username} · {branchCode} — {legacyRole}</small></div>
        <nav>
          {canManageUsers && <a href={withBasePath("/admin/accounts")}>CHANGE BRANCH USER PASSWORD</a>}
          <a href={withBasePath("/change-password")}>CHANGE MY PASSWORD</a>
          {canImport && <a href={withBasePath("/price-memos/import")}>IMPORT PRICE MEMOS</a>}
          {systemRole === "SYSTEM_ADMIN" && <a href={withBasePath("/admin/logos")}>LOGO MANAGER</a>}
          <button type="button" disabled title="Memo cleanup tools are being migrated">DELETE OLD MEMO</button>
        </nav>
      </section>}

      <section className="legacy-search-workflow ptg-print-hide">
        <div className="legacy-search-card">
          <h2>1. Select Product</h2>
          <div className="legacy-search-fields">
            <form onSubmit={submitSearch} className="legacy-search-form">
              <label htmlFor="legacy-product-search">SEARCH PRODUCT</label>
              <div><input id="legacy-product-search" value={term} onChange={event => setTerm(event.target.value)} placeholder="Search brand, model, barcode, description..." aria-label="Search brand, model, barcode, description" /><button type="submit" disabled={loading}>{loading ? "SEARCHING…" : "SEARCH"}</button></div>
            </form>
            <div className="legacy-format-controls">
              <strong>PRINT FORMAT</strong>
              <div>{formats.map(option => <button key={option.key} type="button" className={format === option.key ? "active" : ""} onClick={() => setPrintFormat(option.key)}>{option.label}</button>)}</div>
            </div>
            <div className="legacy-memo-info">
              <label>MEMO_ID<input readOnly value={currentMemo?.memo_id || ""} /></label>
              <label>PERIOD<input readOnly value={currentMemo?.period || ""} /></label>
              <label>IMPORT_DATE<input readOnly value={currentMemo?.created_at ? new Date(currentMemo.created_at).toLocaleDateString("en-US") : ""} /></label>
            </div>
          </div>
        </div>

        <aside className="legacy-installment-panel">
          <h3>INSTALLMENT PRICE</h3>
          <p>{activeProduct ? (activeProduct.brand + " " + activeProduct.model) : "Select a product to view installment prices."}</p>
          <table>
            <thead><tr><th>TERM</th><th>TOTAL INSTALLMENT</th><th>MONTHLY PAYMENT</th></tr></thead>
            <tbody>
              {activeProduct ? ([6, 9, 12, 18, 24] as const).map(months => {
                const totalInstallment = amount(activeProduct["months_" + months as "months_6"]);
                return <tr key={months}><td>{months} MONTHS</td><td>{totalInstallment ? peso(totalInstallment) : "—"}</td><td>{totalInstallment ? peso(totalInstallment / months) : "—"}</td></tr>;
              }) : <tr><td colSpan={3}>Select a product.</td></tr>}
            </tbody>
          </table>
        </aside>
      </section>

      <section className="legacy-results-panel ptg-print-hide">
        {message && <p className="legacy-status-message" role="status">{message}</p>}
        <div className="legacy-table-frame" aria-busy={loading}>
          <table className="legacy-products-table">
            <thead><tr>
              <th><input type="checkbox" aria-label="Select all visible products" checked={results.length > 0 && results.every(item => queue.some(queued => queued.id === item.id))} onChange={event => toggleVisible(event.target.checked)} /></th>
              <th>Brand</th><th>Model</th><th>Barcode</th><th>Remarks</th><th>SRP</th><th>PAY NOW</th><th>Status</th>
            </tr></thead>
            <tbody>
              {loading && !results.length ? <tr><td colSpan={8} className="legacy-empty-row">Loading products…</td></tr> : results.length ? results.map(product => <tr key={product.id} onClick={event => { if ((event.target as HTMLElement).tagName !== "INPUT") setActiveProduct(product); }}>
                <td><input type="checkbox" aria-label={"Select " + product.brand + " " + product.model} checked={queue.some(item => item.id === product.id)} onChange={event => toggleProduct(product, event.target.checked)} /></td>
                <td><strong>{product.brand || "—"}</strong></td><td title={product.model}>{shortText(product.model || "", 25)}</td><td>{product.barcode}</td><td title={product.remarks}>{product.remarks ? shortText(product.remarks, 28) : "N/A"}</td><td>{peso(product.srp)}</td><td>{peso(priceNow(product))}</td><td><span className={"legacy-status-pill " + (displayStatus(product) === "YES" ? "eligible" : "")}>{displayStatus(product)}</span></td>
              </tr>) : <tr><td colSpan={8} className="legacy-empty-row">No products found.</td></tr>}
              <BlankRows used={Math.max(1, results.length)} />
            </tbody>
          </table>
        </div>
        <p className="legacy-result-count" role="status">{loading ? "Loading products…" : `Search Results ${firstResult}–${lastResult} of ${total}`}</p>
        <Pagination page={page} totalPages={totalPages} label="Product results" busy={loading} onPage={next => void loadProducts(searchQuery, next)} />
      </section>

      <section className="legacy-queue-panel ptg-print-hide">
        <h2>2. Selected Products / Print Queue</h2>
        <div className="legacy-table-frame">
          <table className="legacy-products-table">
            <thead><tr>
              <th><input type="checkbox" aria-label="Select all queued products" checked={queue.length > 0} onChange={event => { if (!event.target.checked) { setQueue([]); setQueuePage(1); setActiveProduct(null); } }} /></th>
              <th>Brand</th><th>Model</th><th>Barcode</th><th>Remarks</th><th>SRP</th><th>PAY NOW</th><th>Status</th>
            </tr></thead>
            <tbody>
              {queueRows.length ? queueRows.map(product => <tr key={product.id}>
                <td><input type="checkbox" checked aria-label={"Remove " + product.model + " from print queue"} onChange={event => toggleProduct(product, event.target.checked)} /></td>
                <td><strong>{product.brand || "—"}</strong></td><td>{shortText(product.model || "", 25)}</td><td>{product.barcode}</td><td>{product.remarks ? shortText(product.remarks, 28) : "N/A"}</td><td>{peso(product.srp)}</td><td>{peso(priceNow(product))}</td><td><span className={"legacy-status-pill " + (displayStatus(product) === "YES" ? "eligible" : "")}>{displayStatus(product)}</span></td>
              </tr>) : <tr><td colSpan={8} className="legacy-queue-empty">No products selected for printing.</td></tr>}
              <BlankRows used={Math.max(1, queueRows.length)} />
            </tbody>
          </table>
        </div>
        <Pagination page={visibleQueuePage} totalPages={queueTotalPages} label="Print queue" onPage={setQueuePage} />
        <div className="legacy-queue-footer"><strong>Selected: {queue.length} product(s)</strong><button type="button" onClick={() => { setQueue([]); setQueuePage(1); setActiveProduct(null); }}>▤ CLEAR ALL</button></div>
      </section>

      <section className="legacy-preview-panel">
        <div className="legacy-preview-heading">
          <h2>3. Print Price Tags</h2>
          <div className="legacy-preview-controls">
            <div className="legacy-format-controls preview-format-controls"><strong>PRINT FORMAT</strong><div>{formats.map(option => <button key={option.key} type="button" className={format === option.key ? "active" : ""} onClick={() => setPrintFormat(option.key)}>{option.label}</button>)}</div></div>
            <div className="legacy-output-buttons ptg-print-hide">
              <button type="button" className="refresh-logos" onClick={() => { setLogoVersion(value => value + 1); void refreshLogos(); }}>↻ Refresh Logos</button>
              <button type="button" className="save-pdf" disabled={!queue.length || format !== "ONE"} onClick={printTags}>▣ SAVE AS PDF</button>
              <button type="button" className="print-tags" disabled={!queue.length || format !== "ONE"} onClick={printTags}>▣ Print Price Tags</button>
            </div>
          </div>
        </div>
        {format !== "ONE" && <div className="legacy-format-notice">The {formats.find(item => item.key === format)?.label} interface is ready; its print template is being migrated next.</div>}
        {format === "ONE" && queue.length > 0 && <div className="ptg-print-preview">
          {queue.map(product => {
            const modelDescription = product.description?.trim() || product.model;
            const memo = memoInfo(product);
            const pay = priceNow(product);
            const savings = amount(product.srp) - pay;
            return <div className="legacy-print-sheet" key={product.id}>
              <article className="legacy-price-tag">
                <div className="legacy-tag-header"><img src={withBasePath(logos.header?.url || "/legacy-ptg/price-tag-header.png") + (logos.header?.url ? "&" : "?") + "refresh=" + logoVersion} alt="1st Megasaver header" /></div>
                <div className="legacy-barcode-label">Barcode:</div><div className="legacy-barcode">{product.barcode}</div>
                <div className="legacy-brand-label">Brand:</div><div className="legacy-brand-value">{product.brand}</div>
                <div className="legacy-model-label">MODEL:</div><div className="legacy-model-value" style={{ fontSize: modelDescription.length > 90 ? 24 : modelDescription.length > 55 ? 30 : 38 }}>{modelDescription}</div>
                <div className="legacy-srp-label">SRP:</div><div className="legacy-srp">{peso(product.srp)}</div>
                <div className="legacy-cash">CASH / STRAIGHT</div>
                <div className="legacy-pay-label">PAY NOW:</div><div className="legacy-pay-value">{peso(pay)}</div>
                <div className="legacy-valid-until">{endDate(memo?.period || "") ? "Valid Until: " + endDate(memo?.period || "") : ""}</div>
                <div className="legacy-save-label">SAVE:</div><div className="legacy-save-value">{savings < 0 ? "−" : ""}{peso(Math.abs(savings))}</div>
                <div className="legacy-installment-logo"><span>FOR INSTALLMENT: CREDIT CARD</span></div>
                <div className="legacy-installments">
                  {[6, 9, 12, 18, 24].map(months => {
                    const installmentTotal = amount(product["months_" + months as "months_6"]);
                    return <div className="legacy-installment-row" key={months}><span>{months} months:</span><strong>{installmentTotal ? peso(installmentTotal / months) + " / month" : "—"}</strong></div>;
                  })}
                </div>
                <img className="legacy-tag-footer" src={withBasePath(logos.social?.url || "/legacy-ptg/price-tag-footer.png") + (logos.social?.url ? "&" : "?") + "refresh=" + logoVersion} alt="Megasaver payment and social footer" />
              </article>
            </div>;
          })}
        </div>}
        {format === "ONE" && queue.length === 0 && <div className="legacy-preview-empty ptg-print-hide">Select products above to print price tags.</div>}
      </section>

      <style jsx global>{`
        .legacy-ptg-main{width:min(1500px,calc(100% - 20px));margin:0 auto;padding:8px 0 18px!important;color:#123b72;font-family:Arial,Helvetica,sans-serif}
        .legacy-branch-tools,.legacy-search-card,.legacy-installment-panel,.legacy-results-panel,.legacy-queue-panel,.legacy-preview-panel{border:1px solid #dbe3ed;border-radius:6px;background:#fff}
        .legacy-branch-tools{margin-bottom:9px;padding:8px 10px}
        .legacy-tools-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;color:#123b72;font-size:10px}
        .legacy-tools-heading small{color:#71839a;font-size:9px}
        .legacy-branch-tools nav{display:flex;gap:6px;flex-wrap:wrap}
        .legacy-branch-tools a,.legacy-branch-tools button{display:inline-flex;align-items:center;min-height:24px;padding:0 9px;border:1px solid #2465c3;border-radius:4px;background:#fff;color:#124a9c;font-size:9px;font-weight:700;text-decoration:none}
        .legacy-branch-tools button:disabled{border-color:#d5dae2;color:#999;background:#f6f7f9}
        .legacy-search-workflow{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(260px,1fr);gap:10px;margin-bottom:10px}
        .legacy-search-card{padding:8px}
        .legacy-search-card h2,.legacy-queue-panel h2,.legacy-preview-heading h2{margin:0 0 6px;color:#0647a7;font-size:14px;font-weight:800}
        .legacy-search-fields{display:grid;grid-template-columns:minmax(0,1fr);gap:7px}
        .legacy-search-form>label,.legacy-format-controls>strong{display:block;margin-bottom:4px;color:#1d3e67;font-size:9px;font-weight:800}
        .legacy-search-form>div{display:grid;grid-template-columns:minmax(0,1fr) 90px;gap:5px}
        .legacy-search-form input{min-width:0;height:25px;padding:0 8px;border:1px solid #d3d8e0;border-radius:4px;font:inherit;font-size:10px}
        .legacy-search-form button{height:27px;border:1px solid #2465c3;border-radius:4px;background:#fff;color:#124a9c;font-size:9px;font-weight:800}
        .legacy-format-controls>div{display:flex;gap:4px;flex-wrap:wrap}
        .legacy-format-controls button{min-width:62px;height:23px;padding:0 9px;border:1px solid #2465c3;border-radius:4px;background:#fff;color:#124a9c;font-size:9px;font-weight:800;cursor:pointer}
        .legacy-format-controls button.active{background:#0647a7;color:#fff}
        .legacy-format-controls button:hover:not(.active){background:#edf4ff}
        .legacy-memo-info{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:6px;border:1px solid #dbe3ed;border-radius:4px;background:#fbfcfe}
        .legacy-memo-info label{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:6px;color:#164a8a;font-size:9px;font-weight:800}
        .legacy-memo-info label:first-child{grid-column:1/-1}
        .legacy-memo-info input{min-width:0;width:100%;height:24px;padding:0 5px;border:1px solid #d8e0eb;border-radius:3px;background:#fff;color:#3e4c5d;font:inherit;font-size:9px}
        .legacy-installment-panel{min-height:176px;overflow:hidden}
        .legacy-installment-panel h3{margin:0;padding:7px 9px;background:#0647a7;color:#fff;font-size:11px}
        .legacy-installment-panel p{min-height:24px;margin:0;padding:6px 9px;color:#6e7887;font-size:9px}
        .legacy-installment-panel table,.legacy-products-table{width:100%;border-collapse:collapse;table-layout:fixed}
        .legacy-installment-panel th{padding:5px 3px;border-top:1px solid #d8e0eb;border-bottom:1px solid #d8e0eb;background:#f4f7fb;color:#0647a7;font-size:8px;text-align:center}
        .legacy-installment-panel td{padding:5px 3px;border-bottom:1px solid #e6e9ee;color:#32445c;font-size:9px;text-align:center}
        .legacy-results-panel{margin-bottom:10px;padding:8px}
        .legacy-status-message{min-height:0;margin:0;padding:0 2px 5px;color:#536781;font-size:9px}
        .legacy-table-frame{border:1px solid #d6d6d6}
        .legacy-products-table{font-size:9px;table-layout:fixed;width:100%}
        .legacy-products-table thead{background:#0647a7;color:#fff}
        .legacy-products-table th{height:28px;padding:4px 6px;background:#0647a7;color:#fff;text-align:left;font-size:9px;font-weight:700;white-space:nowrap}
        .legacy-products-table th:first-child,.legacy-products-table td:first-child{width:36px;text-align:center}
        .legacy-products-table th:nth-child(2){width:17%}.legacy-products-table th:nth-child(3){width:18%}.legacy-products-table th:nth-child(4){width:11%}.legacy-products-table th:nth-child(5){width:30%}.legacy-products-table th:nth-child(6),.legacy-products-table th:nth-child(7){width:9%}.legacy-products-table th:nth-child(8){width:7%}
        .legacy-products-table td{height:38px;padding:4px 6px;border-bottom:1px solid #d6d6d6;color:#143d75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .legacy-products-table tbody tr:not(.legacy-blank-row){cursor:pointer}
        .legacy-products-table tbody tr:hover:not(.legacy-blank-row){background:#f5f8fc}
        .legacy-products-table td strong{font-weight:800}
        .legacy-products-table input{width:13px;height:13px;margin:0;accent-color:#0647a7}
        .legacy-empty-row,.legacy-queue-empty{text-align:center!important;color:#245291!important}
        .legacy-blank-row td{color:transparent!important}
        .legacy-status-pill{display:inline-block;min-width:28px;padding:3px 6px;border-radius:999px;background:#eee;color:#5a5a5a;font-size:8px;font-weight:800;text-align:center}
        .legacy-status-pill.eligible{background:#e7f6ec;color:#207345}
        .legacy-pagination{display:flex;align-items:center;justify-content:center;gap:4px;padding:6px 0 0;color:#3e526d;font-size:9px}
        .legacy-pagination button{width:30px;height:26px;border:1px solid #6ba9ff;border-radius:5px;background:#fff;color:#165aaa;font-size:15px}
        .legacy-pagination button:disabled{opacity:.4}
        .legacy-pagination label{display:flex;align-items:center;gap:4px}
        .legacy-pagination label input{width:42px;height:26px;border:1px solid #333;border-radius:4px;text-align:center;font-size:10px}
        .legacy-queue-panel{display:flex;flex-direction:column;min-height:285px;margin-bottom:9px;padding:8px}
        .legacy-queue-panel h2{margin-bottom:7px}
        .legacy-queue-footer{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:auto;padding-top:7px;color:#143d75;font-size:9px}
        .legacy-queue-footer button{height:24px;padding:0 9px;border:0;border-radius:4px;background:#dedede;color:#425064;font-size:9px;font-weight:700}
        .legacy-preview-panel{padding:8px}
        .legacy-preview-heading h2{margin-bottom:5px}
        .legacy-preview-controls{display:flex;align-items:end;justify-content:space-between;gap:10px}
        .preview-format-controls{min-width:0;flex:1}
        .legacy-output-buttons{display:flex;gap:4px;flex:0 0 auto}
        .legacy-output-buttons button{height:24px;padding:0 8px;border:0;border-radius:4px;color:#fff;font-size:8px;font-weight:800;white-space:nowrap}
        .legacy-output-buttons .refresh-logos{background:#d8d8d8;color:#425064}
        .legacy-output-buttons .save-pdf,.legacy-output-buttons .print-tags{background:#0647a7}
        .legacy-output-buttons button:disabled{opacity:.48;cursor:not-allowed}
        .legacy-format-notice,.legacy-preview-empty{margin-top:8px;padding:11px;border:1px solid #dbe3ed;border-radius:4px;background:#fbfcfe;color:#546981;font-size:10px}
        .legacy-result-count{margin:6px 0 0;text-align:center;font-size:9px}
        .ptg-print-preview{display:none}
        .legacy-print-sheet{box-sizing:border-box;display:grid;place-items:start center;width:8.5in;height:11in;margin:0 auto 16px;padding-top:.3in;background:#fff;page-break-after:always;break-after:page}
        .legacy-print-sheet:last-child{page-break-after:auto;break-after:auto}
        .legacy-price-tag{box-sizing:border-box;position:relative;display:grid;grid-template-columns:20fr 51fr 26fr 46fr 70fr 60fr 74fr 101fr 21fr;grid-template-rows:17fr 19fr 19fr 19fr 19fr 19fr 19fr 33fr 33fr 33fr 19fr 12fr 19fr 23fr 21fr 19fr 19fr 19fr 19fr 19fr 22fr 19fr 19fr 19fr 19fr 19fr 7fr 19fr 19fr 19fr 19fr 19fr 19fr 19fr;width:7.8in;height:10.4in;overflow:hidden;border:1px solid #003da5;background:#fff;color:#003da5;font-family:Arial,Helvetica,sans-serif}
        .legacy-tag-header{grid-column:1/10;grid-row:1/6;overflow:hidden}
        .legacy-tag-header img{display:block;width:100%;height:100%;object-fit:contain}
        .legacy-barcode-label{grid-column:7/8;grid-row:6;align-self:center;text-align:right;padding-right:5px;font-size:24px;font-weight:bold}
        .legacy-barcode{grid-column:8/9;grid-row:6;display:flex;align-items:center;justify-content:center;align-self:stretch;padding:0 4px;background:#d9d9d9;color:#555;font-size:24px;font-weight:bold}
        .legacy-brand-label{grid-column:1/3;grid-row:7;align-self:center;padding-left:6%;font-size:30px;font-weight:bold}
        .legacy-brand-value{grid-column:3/6;grid-row:7;align-self:center;font-size:34px;font-weight:bold}
        .legacy-model-label{grid-column:1/3;grid-row:8/10;align-self:start;padding:3px 0 0 6%;font-size:32px;font-weight:bold}
        .legacy-model-value{grid-column:3/10;grid-row:8/11;align-self:center;padding:0 4%;line-height:1.15;font-weight:bold;text-align:center;overflow-wrap:anywhere}
        .legacy-srp-label{grid-column:1/3;grid-row:11;align-self:center;padding-left:6%;font-size:24px;font-weight:bold}
        .legacy-srp{grid-column:3/6;grid-row:11;align-self:center;font-size:26px;font-weight:bold;text-decoration:line-through}
        .legacy-cash{grid-column:1/5;grid-row:13;align-self:center;padding-left:6%;font-size:19px;font-weight:bold}
        .legacy-pay-label{grid-column:1/5;grid-row:14/16;align-self:center;justify-self:end;margin-right:14px;font-size:35px;font-weight:bold;white-space:nowrap}
        .legacy-pay-value{grid-column:5/9;grid-row:14/16;display:flex;align-items:center;justify-content:center;background:#fff500;color:#003da5;font-size:68px;font-weight:900;white-space:nowrap}
        .legacy-valid-until{grid-column:5/9;grid-row:17;align-self:center;justify-self:stretch;overflow:visible;color:#003da5;font-size:20px;font-weight:700;text-align:center;white-space:nowrap}
        .legacy-save-label{grid-column:2/4;grid-row:18/20;align-self:center;padding-right:10px;font-size:24px;font-weight:bold;text-align:right}
        .legacy-save-value{grid-column:4/7;grid-row:18/20;align-self:center;font-size:44px;font-weight:bold;white-space:nowrap}
        .legacy-installment-logo{position:relative;grid-column:1/10;grid-row:20/23;display:flex;align-items:flex-start;justify-content:center;overflow:hidden;width:100%;height:100%}
        .legacy-installment-logo:before{content:"";position:absolute;top:10px;left:2%;right:2%;height:3px;background:#003da5}
        .legacy-installment-logo span{position:relative;z-index:1;padding:3px 16px 4px;border-radius:0 0 5px 5px;background:#003da5;color:white;font-size:18px;font-weight:bold}
        .legacy-installments{grid-column:2/9;grid-row:23/28;display:grid;grid-template-rows:repeat(5,1fr);align-items:center;padding:0 3%}
        .legacy-installment-row{display:grid;grid-template-columns:150px 1fr;align-items:center;gap:12px;color:#003da5;font-size:22px;font-weight:bold;white-space:nowrap}
        .legacy-installment-row span{text-align:right}
        .legacy-installment-row strong{font-weight:bold}
        .legacy-tag-footer{grid-column:1/10;grid-row:28/34;width:100%;height:100%;object-fit:contain;object-position:center}
        @media(max-width:850px){.legacy-search-workflow{grid-template-columns:1fr}.legacy-installment-panel{min-height:155px}.legacy-preview-controls{align-items:flex-start;flex-direction:column}.legacy-output-buttons{flex-wrap:wrap}}
        @media print{
          @page{size:letter portrait;margin:0}
          html,body{margin:0!important;padding:0!important;background:#fff!important}
          body *{visibility:hidden!important}
          .ptg-print-preview,.ptg-print-preview *{visibility:visible!important}
          .ptg-print-preview{display:block!important;position:absolute!important;left:0!important;top:0!important;width:100%!important;margin:0!important;padding:0!important}
          .ptg-print-hide,.legacy-preview-heading,.legacy-format-notice,.legacy-preview-empty{display:none!important}
          .legacy-print-sheet{width:8.5in!important;height:11in!important;margin:0!important;padding-top:.3in!important;box-shadow:none!important}
          .legacy-price-tag{width:7.8in!important;height:10.4in!important;border:1px solid #003da5!important}
          .legacy-tag-header img,.legacy-tag-footer{print-color-adjust:exact;-webkit-print-color-adjust:exact}
        }
      `}</style>
    </main>
  );
}
