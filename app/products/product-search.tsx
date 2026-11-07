"use client";

import { useState } from "react";

type Product = {
  id: string; brand: string; category: string; barcode: string; model: string;
  description: string; sub_category: string; srp: number; cash_payment: number;
  tag_this: number; months_6: number; months_9: number; months_12: number;
  months_18: number; months_24: number; remarks: string;
  price_memos: { memo_id: string; period: string; memo_type: string };
};

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(Number(value || 0));
const amount = (value: number | null | undefined) => Number(value || 0);
const payNow = (product: Product) => amount(product.tag_this ?? product.cash_payment ?? product.srp);
const installment = (total: number, months: number) => total > 0 ? money(total / months) : "—";

export default function ProductSearch({ branchCode }: { branchCode: string }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [queue, setQueue] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (term.trim().length < 2) { setMessage("Enter at least 2 characters."); return; }
    setLoading(true); setMessage("");
    try {
      const response = await fetch(`/api/products/search?q=${encodeURIComponent(term.trim())}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Search failed.");
      setResults(payload.products as Product[]);
      setMessage(payload.products.length ? `${payload.products.length} matching memo product(s).` : "No matching products found in imported price memos.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Search failed."); }
    finally { setLoading(false); }
  }

  function add(product: Product) {
    setQueue(current => current.some(item => item.id === product.id) ? current : [...current, product]);
  }
  function remove(id: string) { setQueue(current => current.filter(item => item.id !== id)); }
  function printTags() {
    if (!queue.length) return;
    document.title = "FIRST_MEGASAVER_PRICE_TAGS";
    window.print();
  }

  return (
    <main className="ptg-main ptg-product-page">
      <header className="ptg-topbar ptg-print-hide">
        <div><span className="ptg-breadcrumb">FIRST MEGASAVER / PRICE TAG WORKFLOW</span><h1>Product Search &amp; Tag Queue</h1></div>
        <a className="ptg-module-link" href="/dashboard">← Dashboard</a>
      </header>
      <section className="ptg-product-intro ptg-print-hide">
        <div><p className="ptg-kicker">PRODUCT SELECTION</p><h2>Find products. Build your tag queue.</h2><p>Search imported price memo records by barcode, model, or brand. Select products to prepare for tag generation.</p></div>
        <span className="ptg-branch-pill">{branchCode}</span>
      </section>
      <section className="ptg-product-layout ptg-print-hide">
        <div className="ptg-product-panel">
          <div className="ptg-panel-heading"><div><h2>Search price references</h2><p>Results are limited to the signed-in branch, except System Admin.</p></div></div>
          <form className="ptg-search-form" onSubmit={search}>
            <input value={term} onChange={event => setTerm(event.target.value)} placeholder="Search barcode, model, or brand…" aria-label="Search products" />
            <button disabled={loading}>{loading ? "Searching…" : "Search"}</button>
          </form>
          {message && <p className="ptg-search-message" role="status">{message}</p>}
          <div className="ptg-results-list">
            {results.map(product => <article className="ptg-product-result" key={product.id}>
              <div className="ptg-result-main"><strong>{product.brand || "UNBRANDED"} · {product.model}</strong><span>{product.description}</span><small>{product.barcode} · {product.category || "Uncategorized"} {product.sub_category ? `/ ${product.sub_category}` : ""}</small><small>Memo {product.price_memos.memo_id} · {product.price_memos.period} · {product.price_memos.memo_type.replaceAll("_", " ")}</small></div>
              <div className="ptg-result-price"><strong>{money(payNow(product))}</strong><small>Tag / Pay Now</small><button type="button" onClick={() => add(product)} disabled={queue.some(item => item.id === product.id)}>{queue.some(item => item.id === product.id) ? "Added" : "＋ Add"}</button></div>
            </article>)}
            {!results.length && <div className="ptg-empty-state">Search imported memo products to see matching items here.</div>}
          </div>
        </div>
        <aside className="ptg-queue-panel">
          <div className="ptg-panel-heading"><div><h2>Tag queue</h2><p>Selected items for the next workflow step.</p></div><span className="ptg-queue-count">{queue.length}</span></div>
          {queue.length ? <div className="ptg-queue-list">{queue.map(item => <div className="ptg-queue-item" key={item.id}><div><strong>{item.brand} {item.model}</strong><small>{item.barcode}</small><b>{money(payNow(item))}</b></div><button type="button" onClick={() => remove(item.id)} aria-label={`Remove ${item.model}`}>×</button></div>)}</div> : <div className="ptg-queue-empty">Your queue is empty.<br/>Add products from the search results.</div>}
          <div className="ptg-queue-footer"><span>Selected products</span><strong>{queue.length}</strong><button type="button" disabled={!queue.length} onClick={() => setShowPreview(true)}>Preview 1 WHOLE tags</button><small>This first print preview uses one product per Letter portrait page. More current PTG formats will be ported separately.</small></div>
        </aside>
      </section>

      {showPreview && <section className="ptg-print-preview">
        <div className="ptg-preview-toolbar ptg-print-hide">
          <div><p className="ptg-kicker">PRINT PREVIEW · 1 WHOLE</p><h2>{queue.length} price tag{queue.length === 1 ? "" : "s"}</h2><p>Choose Print or Save as PDF in the browser print dialog.</p></div>
          <div className="ptg-preview-actions"><button type="button" className="ptg-preview-secondary" onClick={() => setShowPreview(false)}>Back to queue</button><button type="button" className="ptg-preview-primary" onClick={printTags}>Print / Save PDF</button></div>
        </div>
        {queue.map(product => {
          const price = payNow(product);
          const savings = amount(product.srp) - price;
          return <article className="ptg-one-tag" key={product.id}>
            <header className="ptg-one-tag-header"><span>FIRST MEGASAVER</span><small>PRICE TAG</small></header>
            <div className="ptg-one-tag-id"><span>Barcode</span><strong>{product.barcode || "—"}</strong></div>
            <div className="ptg-one-tag-brand"><span>Brand</span><strong>{product.brand || "—"}</strong></div>
            <div className="ptg-one-tag-model"><span>MODEL</span><strong>{product.description || product.model || "—"}</strong></div>
            <div className="ptg-one-tag-price-row"><div><span>SRP</span><strong>{money(amount(product.srp))}</strong></div><div><span>CASH / STRAIGHT</span><b>PAY NOW</b><strong>{money(price)}</strong></div><div><span>SAVE</span><strong>{savings < 0 ? "−" : ""}{money(Math.abs(savings))}</strong></div></div>
            <p className="ptg-one-tag-valid">{product.price_memos.period ? `Memo period: ${product.price_memos.period}` : ""}</p>
            <section className="ptg-one-tag-installments"><h3>FOR INSTALLMENT: CREDIT CARD</h3><div><span>6 months</span><b>{installment(amount(product.months_6), 6)}</b></div><div><span>9 months</span><b>{installment(amount(product.months_9), 9)}</b></div><div><span>12 months</span><b>{installment(amount(product.months_12), 12)}</b></div><div><span>18 months</span><b>{installment(amount(product.months_18), 18)}</b></div><div><span>24 months</span><b>{installment(amount(product.months_24), 24)}</b></div></section>
            <footer className="ptg-one-tag-footer">{product.remarks || ""}</footer>
          </article>;
        })}
      </section>}

      <style jsx global>{`
        .ptg-preview-toolbar{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:0 0 18px;padding:18px 20px;border:1px solid #dfe6ef;border-radius:12px;background:#fff}
        .ptg-preview-toolbar h2{margin:0;color:#1b3554;font-size:18px}.ptg-preview-toolbar p:last-child{margin:7px 0 0;color:#78869a;font-size:11px}
        .ptg-preview-actions{display:flex;gap:8px}.ptg-preview-actions button{min-height:39px;padding:0 14px;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer}
        .ptg-preview-secondary{border:1px solid #d5deea;background:#fff;color:#29415f}.ptg-preview-primary{border:0;background:#164a8a;color:#fff}
        .ptg-one-tag{width:min(8.5in,100%);min-height:10.5in;margin:0 auto 18px;padding:.42in .48in;display:flex;flex-direction:column;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#15243a;box-shadow:0 8px 25px rgba(18,45,78,.10);font-family:Arial,Helvetica,sans-serif}
        .ptg-one-tag-header{display:flex;justify-content:space-between;align-items:center;padding:0 0 12px;border-bottom:4px solid #164a8a;color:#164a8a}
        .ptg-one-tag-header span{font-size:24px;font-weight:900;letter-spacing:.015em}.ptg-one-tag-header small{font-size:10px;font-weight:800;letter-spacing:.14em}
        .ptg-one-tag-id,.ptg-one-tag-brand{display:flex;justify-content:space-between;gap:15px;padding:10px 2px 5px}.ptg-one-tag-id span,.ptg-one-tag-brand span,.ptg-one-tag-model span,.ptg-one-tag-price-row span{color:#52657c;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em}.ptg-one-tag-id strong{font-size:16px;letter-spacing:.12em}
        .ptg-one-tag-brand strong{font-size:23px;text-align:right}.ptg-one-tag-model{display:grid;gap:6px;margin:8px 0 12px;padding:11px 2px;border-top:1px solid #dbe3ed;border-bottom:1px solid #dbe3ed}.ptg-one-tag-model strong{font-size:24px;line-height:1.1}
        .ptg-one-tag-price-row{display:grid;grid-template-columns:1fr 1.5fr 1fr;gap:8px;align-items:stretch}.ptg-one-tag-price-row>div{display:flex;flex-direction:column;justify-content:center;gap:7px;padding:12px;border:1px solid #d9e1eb;border-radius:8px}.ptg-one-tag-price-row>div:nth-child(2){border-color:#164a8a;background:#164a8a;color:#fff;text-align:center}.ptg-one-tag-price-row>div:nth-child(2) span,.ptg-one-tag-price-row>div:nth-child(2) b{color:#dce9f8}.ptg-one-tag-price-row strong{font-size:17px}.ptg-one-tag-price-row>div:nth-child(2) strong{font-size:30px}.ptg-one-tag-price-row>div:nth-child(2) b{font-size:11px;letter-spacing:.08em}.ptg-one-tag-valid{min-height:16px;margin:8px 0;color:#52657c;font-size:10px}
        .ptg-one-tag-installments{margin-top:8px;border-top:2px solid #15243a}.ptg-one-tag-installments h3{margin:8px 0;font-size:12px;letter-spacing:.04em}.ptg-one-tag-installments div{display:flex;justify-content:space-between;padding:5px 3px;border-top:1px solid #e1e7ef;font-size:12px}
        .ptg-one-tag-footer{margin-top:auto;padding-top:9px;border-top:1px solid #dbe3ed;color:#52657c;font-size:10px}
        @media print{
          @page{size:Letter portrait;margin:0}
          html,body{margin:0!important;padding:0!important;background:#fff!important}
          body *{visibility:hidden!important}
          .ptg-print-preview,.ptg-print-preview *{visibility:visible!important}
          .ptg-print-preview{position:absolute!important;left:0!important;top:0!important;width:100%!important;margin:0!important;padding:0!important}
          .ptg-print-hide{display:none!important}
          .ptg-one-tag{width:8.5in!important;height:11in!important;min-height:11in!important;margin:0!important;padding:.42in .48in!important;border:0!important;border-radius:0!important;box-shadow:none!important;page-break-after:always;break-after:page}
          .ptg-one-tag:last-child{page-break-after:auto;break-after:auto}
        }
      `}</style>
    </main>
  );
}
