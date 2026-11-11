"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPtgAppSessionId } from "@/lib/ptg/auth-client";
import { invokePtgData } from "@/lib/ptg/edge-api";
import { runBatch, type Branch, type BatchJob } from "@/lib/ptg/batch-import";
import { buildPromotionPlan, loadPromotionReader,
  type Component, type PdfSource, type Product, type PromotionEngine, type PromotionRow, type PromotionPlan } from "@/lib/ptg/promotion-import";

type Access = { scope: { userId: string; branches: Branch[] }; client: SupabaseClient };
type Props = { verifyPtg: (id: string) => Promise<void>; verifySales: () => Promise<Access> };
const writes = process.env.NEXT_PUBLIC_PTG_ENABLE_PROMOTION_IMPORT_WRITES === "true";
const pageSize = 10;
const money = (value: number | null) => value === null ? "Not printed" : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const message = (error: unknown) => error instanceof Error ? error.message : "The promotion import could not be completed.";

export default function PromotionImport({ verifyPtg, verifySales }: Props) {
  const [sessionId] = useState(getPtgAppSessionId);
  const [sources, setSources] = useState<PdfSource[]>([]);
  const [engine, setEngine] = useState<PromotionEngine>();
  const [selected, setSelected] = useState(new Set<string>());
  const [targets, setTargets] = useState({ ptg: true, sales: true });
  const [overrides, setOverrides] = useState<Record<string, Component[]>>({});
  const [plan, setPlan] = useState<PromotionPlan>();
  const [scope, setScope] = useState<Access["scope"]>();
  const [products, setProducts] = useState<Product[]>([]);
  const [detail, setDetail] = useState<string>();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const running = useRef(false);
  const urls = useRef<string[]>([]);
  useEffect(() => {
    const created = urls.current;
    return () => created.forEach(url => URL.revokeObjectURL(url));
  }, []);

  const rows = sources.flatMap(source => source.rows);
  const matching = rows.filter(row => (row.barcode + " " + row.description + " " + row.sourceName).toLowerCase().includes(search.trim().toLowerCase()));
  const lastPage = Math.max(1, Math.ceil(matching.length / pageSize));
  const currentPage = Math.min(page, lastPage);
  const visible = matching.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const active = rows.find(row => row.id === detail);
  const started = plan?.jobs.some(job => job.state !== "pending") ?? false;
  const uncertain = plan?.jobs.some(job => job.state === "verify") ?? false;
  function invalidate() { setPlan(undefined); setConfirmed(false); setError(""); }

  async function inspect(files: File[]) {
    if (running.current || !files.length) return;
    if (files.length > 80 || files.some(file => !/\.pdf$/i.test(file.name) || file.size > 20 * 1024 * 1024) ||
        files.reduce((sum, file) => sum + file.size, 0) > 160 * 1024 * 1024 ||
        new Set(files.map(file => file.name)).size !== files.length) {
      setError("Choose up to 80 uniquely named PDFs, 20 MB each and 160 MB combined."); return;
    }
    running.current = true; invalidate(); setProgress("Checking your PTG System Admin session…");
    try {
      await verifyPtg(sessionId);
      const loaded = await loadPromotionReader();
      const next: PdfSource[] = [];
      for (const [index, file] of files.entries()) {
        setProgress("Reading PDF " + (index + 1) + " of " + files.length + " directly from its printed columns…");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const document = await loaded.engine.inspectPromotionPdf(loaded.reader, bytes, file.name);
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
        if (next.some(source => source.digest === digest)) continue;
        const candidates = loaded.engine.promotionPdfCandidates(document).map((row, rowIndex) => ({ ...row, id: digest + "-" + rowIndex }));
        if (!candidates.length) throw new Error(file.name + ": no readable promotion table was found.");
        const url = URL.createObjectURL(file); urls.current.push(url);
        next.push({ name: file.name, digest, url, rows: candidates });
      }
      setSources(next); setEngine(loaded.engine); setSelected(new Set(next.flatMap(source => source.rows.map(row => row.id))));
      setOverrides({}); setPage(1); setDetail(undefined); setProducts([]);
    } catch (failure) { setError(message(failure)); }
    finally { running.current = false; setProgress(""); }
  }

  async function review() {
    if (!engine || running.current) return;
    running.current = true; invalidate(); setProgress("Matching promotion products and checking destinations…");
    try {
      await verifyPtg(sessionId);
      const access = targets.sales ? await verifySales() : undefined;
      const catalog: Product[] = [];
      if (access) for (let first = 0; ; first += 1000) {
        const result = await access.client.from("products").select("branch_id,barcode,brand,model_description,srp")
          .in("branch_id", access.scope.branches.map(branch => branch.id)).eq("active", true)
          .order("branch_id").order("barcode").range(first, first + 999);
        if (result.error) throw new Error("Could not read the Sales Tracker product catalog.");
        catalog.push(...(result.data ?? []));
        if ((result.data?.length ?? 0) < 1000) break;
      }
      setProducts(catalog); setScope(access?.scope);
      setPlan(await buildPromotionPlan(engine, sources, selected, targets, access?.scope.branches ?? [], catalog, overrides));
    } catch (failure) { setError(message(failure)); }
    finally { running.current = false; setProgress(""); }
  }

  async function save() {
    if (!plan || !confirmed || !writes || running.current || uncertain) return;
    running.current = true; setProgress("Importing the reviewed promotional offers…"); setError("");
    let salesClient: SupabaseClient | undefined;
    try {
      await runBatch(plan.jobs, async job => {
        await verifyPtg(sessionId);
        if (job.target === "sales") {
          const access = await verifySales();
          if (JSON.stringify(access.scope) !== JSON.stringify(scope)) throw new Error("The Sales Tracker account or branch scope changed. Review again.");
          salesClient = access.client;
        }
      }, async (job: BatchJob) => {
        if (job.ptg) {
          const result = await invokePtgData(job.ptg.functionName, job.ptg.body);
          if (!result.summary) throw new Error("PTG did not confirm its import result.");
          return (result.summary as { skipped?: boolean }).skipped ? { state: "skipped", detail: "This PDF memo was already imported." } : { state: "saved" };
        }
        if (!job.sales || !salesClient) throw new Error("The Sales Tracker session could not be verified.");
        const result = await salesClient.rpc(job.sales.rpc, job.sales.params);
        if (result.error) {
          if (/^[0-9A-Z]{5}$/.test(result.error.code ?? "")) return { state: "blocked", detail: result.error.message };
          throw new Error(result.error.message);
        }
        if (!Number.isInteger(result.data?.imported) || !Number.isInteger(result.data?.skipped)) throw new Error("Sales Tracker did not confirm its import counts.");
        return { state: "saved", detail: result.data.imported + " imported · " + result.data.skipped + " already saved" };
      }, jobs => setPlan({ ...plan, jobs }));
    } catch (failure) { setError(message(failure)); }
    finally { running.current = false; setProgress(""); setConfirmed(false); }
  }

  const auto = active && engine && products.length
    ? engine.preparePromotionImport([{ ...active, warnings: [] }], products.filter(product => product.branch_id === scope?.branches[0]?.id), [])[0] : undefined;
  const components = active ? overrides[active.id] ?? (auto?.ready ? auto.components : []) : [];
  function updateComponents(next: Component[]) {
    if (!active) return;
    setOverrides(current => ({ ...current, [active.id]: next })); invalidate();
  }
  function updateRow(patch: Partial<PromotionRow>) {
    if (!active) return;
    setSources(current => current.map(source => ({ ...source, rows: source.rows.map(row => row.id === active.id ? { ...row, ...patch } : row) })));
    invalidate();
  }

  return <main className="ptg-main">
    <h1>Promotion PDF Import</h1>
    <p>Read the original PDF columns directly. One promotion barcode keeps its printed price and the actual paid/free products included in its bundle.</p>
    {!writes && <p role="status"><strong>Dry run only.</strong> Live saving is disabled in this build.</p>}
    <section className="admin-card">
      <fieldset disabled={!!progress || started}>
        <legend>Original PDFs and destinations</legend>
        <label className="upload-drop"><input type="file" multiple accept=".pdf,application/pdf" onChange={event => void inspect(Array.from(event.target.files ?? []))} />
          <strong>Choose promotional PDFs</strong><span>Up to 80 files · 20 MB each · 160 MB combined</span></label>
        <p><label><input type="checkbox" checked={targets.sales} onChange={event => { setTargets({ ...targets, sales: event.target.checked }); invalidate(); }} /> Sales Tracker</label>{" "}
          <label><input type="checkbox" checked={targets.ptg} onChange={event => { setTargets({ ...targets, ptg: event.target.checked }); invalidate(); }} /> PTG</label></p>
        {rows.length > 0 && <button type="button" className="admin-button" disabled={!selected.size || (!targets.ptg && !targets.sales)} onClick={() => void review()}>Check selected offers</button>}
      </fieldset>
      {progress && <p role="status">{progress}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
    {rows.length > 0 && <section className="admin-card">
      <h2>{rows.length} printed offer rows · {selected.size} selected</h2>
      <p className="admin-muted">Cash, tag and installment amounts remain separate. Dates missing from the source remain blank. Printed monthly rates are shown monthly and stored as term totals for PTG.</p>
      <label>Search offers <input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
      <p>
        <button className="admin-button small secondary" type="button" disabled={!!progress || started} onClick={() => {
          setSelected(current => new Set([...current, ...matching.map(row => row.id)])); invalidate();
        }}>Select matching offers</button>{" "}
        <button className="admin-button small secondary" type="button" disabled={!!progress || started} onClick={() => {
          const ids = new Set(matching.map(row => row.id));
          setSelected(current => new Set([...current].filter(id => !ids.has(id)))); invalidate();
        }}>Deselect matching offers</button>
      </p>
      <div className="admin-table-wrap"><table className="admin-table">
        <thead><tr><th>Select</th><th>Barcode</th><th>Printed description</th><th>Tag / now price</th><th>Terms</th><th>Source</th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.id}>
          <td><input type="checkbox" aria-label={"Include " + row.barcode + " from " + row.sourceName + " page " + row.sourcePage} checked={selected.has(row.id)} disabled={!!progress || started} onChange={event => {
            setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; }); invalidate();
          }} /></td>
          <td><button type="button" className="admin-link" onClick={() => setDetail(row.id)}>{row.barcode}</button></td>
          <td>{row.description}</td><td>{money(row.tagPrice)}</td><td>{row.remarks || row.category || "—"}</td>
          <td><a href={sources.find(source => source.name === row.sourceName)!.url + "#page=" + row.sourcePage} target="_blank" rel="noreferrer">{row.sourceName} · p. {row.sourcePage}</a></td>
        </tr>)}</tbody>
      </table></div>
      <nav className="security-pagination" aria-label="Promotion rows">
        <button className="admin-button small secondary" type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span>Page {currentPage} of {lastPage}</span>
        <button className="admin-button small secondary" type="button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button>
      </nav>
    </section>}
    {active && <section className="admin-card">
      <h2>{active.barcode} · {active.description}</h2>
      <p>{active.sourceName} · Page {active.sourcePage}</p>
      <dl>{Object.entries(active.sourceColumns).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
      <fieldset disabled={!!progress || started}>
        <legend>Offer details and actual bundle products</legend>
        <div className="admin-form">
          <label>Brand, if missing from the source<input value={active.brand} onChange={event => updateRow({ brand: event.target.value })} /></label>
          <label>Category<input value={active.category} onChange={event => updateRow({ category: event.target.value })} /></label>
          <label>Start date<input type="date" value={active.validFrom} onChange={event => updateRow({ validFrom: event.target.value })} /></label>
          <label>End date<input type="date" value={active.validTo} onChange={event => updateRow({ validTo: event.target.value })} /></label>
        </div>
        <p>Check the actual stock barcodes and quantities below. Buy 1/get 1 uses one paid and one free unit. Buy 5/get 1 uses five paid and one free unit.</p>
        {components.map((part, index) => <div className="admin-form" key={part.id}>
          <label>Actual product barcode<input value={part.barcode} onChange={event => updateComponents(components.map((value, i) => i === index ? { ...value, barcode: event.target.value } : value))} /></label>
          <label>Quantity<input type="number" min="1" step="1" value={part.quantity} onChange={event => updateComponents(components.map((value, i) => i === index ? { ...value, quantity: Number(event.target.value) } : value))} /></label>
          <label>Paid or free<select value={String(part.free)} onChange={event => updateComponents(components.map((value, i) => i === index ? { ...value, free: event.target.value === "true" } : value))}><option value="false">Paid</option><option value="true">Free</option></select></label>
          <button type="button" className="admin-button secondary" onClick={() => updateComponents(components.filter((_, i) => i !== index))}>Remove product</button>
        </div>)}
        <p><button type="button" className="admin-button secondary" onClick={() => updateComponents([...components, { id: crypto.randomUUID(), barcode: "", quantity: 1, free: false }])}>Add product</button></p>
      </fieldset>
    </section>}
    {plan && <section className="admin-card">
      <h2>Import review</h2>
      <p>Only the offers listed in the destination counts will be imported. Each destination saves separately.</p>
      <p>Different source offers remain separate choices. Sales Tracker asks the PS to choose the specific offer and enter the final selling price.</p>
      <ul>{plan.jobs.map(job => <li key={job.key}>{job.target === "ptg" ? "PTG" : "Sales Tracker"} · {job.label} · {job.scope} · {job.state}{job.detail && " · " + job.detail}</li>)}</ul>
      {plan.exceptions.length > 0 && <details open><summary>{new Set(plan.exceptions.map(item => item.rowId)).size} offers need attention</summary>
        <ul>{plan.exceptions.map((item, index) => <li key={index}><button type="button" className="admin-link" onClick={() => setDetail(item.rowId)}>{rows.find(row => row.id === item.rowId)?.barcode}</button> · {item.app} · {item.detail}</li>)}</ul>
      </details>}
      {writes && !uncertain && plan.jobs.some(job => job.state === "pending" || job.state === "blocked") && <fieldset disabled={!!progress}>
        <legend>Confirm destinations</legend>
        <p><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I reviewed the printed prices, offer dates, bundle products and quantities.</label></p>
        <button type="button" className="admin-button" disabled={!confirmed} onClick={() => void save()}>{started ? "Resume remaining imports" : "Import reviewed offers"}</button>
      </fieldset>}
      {uncertain && <p role="alert">A destination response was lost. Check that destination before starting another import.</p>}
    </section>}
  </main>;
}
