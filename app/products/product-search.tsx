"use client";

import { useState } from "react";

type Product = {
  id: string; brand: string; category: string; barcode: string; model: string;
  description: string; sub_category: string; srp: number; cash_payment: number;
  tag_this: number; months_6: number; months_9: number; months_12: number;
  months_18: number; months_24: number; remarks: string;
  price_memos: { memo_id: string; period: string; memo_type: string };
};

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value || 0));

export default function ProductSearch({ branchCode }: { branchCode: string }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [queue, setQueue] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

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

  return (
    <main className="ptg-main ptg-product-page">
      <header className="ptg-topbar">
        <div><span className="ptg-breadcrumb">FIRST MEGASAVER / PRICE TAG WORKFLOW</span><h1>Product Search &amp; Tag Queue</h1></div>
        <a className="ptg-module-link" href="/dashboard">← Dashboard</a>
      </header>
      <section className="ptg-product-intro">
        <div><p className="ptg-kicker">PRODUCT SELECTION</p><h2>Find products. Build your tag queue.</h2><p>Search imported price memo records by barcode, model, or brand. Select products to prepare for tag generation.</p></div>
        <span className="ptg-branch-pill">{branchCode}</span>
      </section>
      <section className="ptg-product-layout">
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
              <div className="ptg-result-price"><strong>{money(product.tag_this || product.cash_payment || product.srp)}</strong><small>Tag / Pay Now</small><button type="button" onClick={() => add(product)} disabled={queue.some(item => item.id === product.id)}>{queue.some(item => item.id === product.id) ? "Added" : "＋ Add"}</button></div>
            </article>)}
            {!results.length && <div className="ptg-empty-state">Search imported memo products to see matching items here.</div>}
          </div>
        </div>
        <aside className="ptg-queue-panel">
          <div className="ptg-panel-heading"><div><h2>Tag queue</h2><p>Selected items for the next workflow step.</p></div><span className="ptg-queue-count">{queue.length}</span></div>
          {queue.length ? <div className="ptg-queue-list">{queue.map(item => <div className="ptg-queue-item" key={item.id}><div><strong>{item.brand} {item.model}</strong><small>{item.barcode}</small><b>{money(item.tag_this || item.cash_payment || item.srp)}</b></div><button type="button" onClick={() => remove(item.id)} aria-label={`Remove ${item.model}`}>×</button></div>)}</div> : <div className="ptg-queue-empty">Your queue is empty.<br/>Add products from the search results.</div>}
          <div className="ptg-queue-footer"><span>Selected products</span><strong>{queue.length}</strong><button type="button" disabled={!queue.length} onClick={() => setMessage("Queue is held in this browser session for this preview. Tag designer integration is the next development phase.")}>Continue to tag preparation</button><small>Queue is temporary in this preview; it is not saved to the database.</small></div>
        </aside>
      </section>
    </main>
  );
}
