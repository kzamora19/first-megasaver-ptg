"use client";

import { useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPtgAppSessionId } from "@/lib/ptg/auth-client";
import { invokePtgData } from "@/lib/ptg/edge-api";
import { runBatch, type Branch } from "@/lib/ptg/batch-import";
import { competingPromotionPrices, planPromotionPdfImport, type CatalogProduct } from "@/lib/ptg/promotion-pdf-import";
import { downloadPromotionWorkbook, readPromotionPdfs } from "@/lib/ptg/promotion-pdf-workbook";

const mb = 1024 * 1024;
const live = (process.env.NEXT_PUBLIC_PTG_ENABLE_PROMOTION_PDF_WRITES ??
  process.env.NEXT_PUBLIC_PTG_ENABLE_BATCH_IMPORT_WRITES) === "true";
const pesos = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
type Scope = { userId: string; branches: Branch[] };
type Access = { scope: Scope; client: SupabaseClient };
type Props = { verifyPtg: (id: string) => Promise<void>; verifySales: () => Promise<Access> };

export default function PromotionPdfConverter({ verifyPtg, verifySales }: Props) {
  const busy = useRef(false);
  const [sessionId] = useState(getPtgAppSessionId);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof readPromotionPdfs>>>();
  const [excluded, setExcluded] = useState(new Set<string>());
  const competingPrices = useMemo(() => result ? competingPromotionPrices(result.offers) : [], [result]);
  const [destinations, setDestinations] = useState({ sales: true, ptg: true, start: "", end: "", barcode: "" });
  const [review, setReview] = useState<Awaited<ReturnType<typeof planPromotionPdfImport>> & { scope?: Scope }>();
  const [confirmed, setConfirmed] = useState(false);
  const started = review?.jobs.some(job => job.state !== "pending") ?? false;
  const pending = review?.jobs.some(job => job.state === "pending" || job.state === "blocked") ?? false;
  const uncertain = review?.jobs.some(job => job.state === "verify") ?? false;
  const completed = review?.jobs.filter(job => job.state === "saved" || job.state === "skipped").length ?? 0;

  function changeSelection(next: Partial<typeof destinations>) {
    setDestinations(current => ({ ...current, ...next }));
    setReview(undefined);
    setConfirmed(false);
    setError("");
  }

  async function convert(files: File[]) {
    if (busy.current || !files.length) return;
    setResult(undefined);
    setExcluded(new Set());
    setReview(undefined);
    setConfirmed(false);
    setError("");
    if (files.length > 80 || files.some(file => !/\.pdf$/i.test(file.name) || !file.size || file.size > 20 * mb) ||
        files.reduce((total, file) => total + file.size, 0) > 160 * mb) {
      setError("Choose up to 80 PDFs, 20 MB each and 160 MB combined.");
      return;
    }
    busy.current = true;
    setProgress("Reading the printed columns…");
    try { setResult(await readPromotionPdfs(files)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to convert the PDFs."); }
    finally { busy.current = false; setProgress(""); }
  }

  async function prepare() {
    if (!result || busy.current || (!destinations.sales && !destinations.ptg)) return;
    busy.current = true;
    setProgress("Checking promotion offers and destinations…");
    setError("");
    setReview(undefined);
    setConfirmed(false);
    try {
      await verifyPtg(sessionId);
      const access = destinations.sales ? await verifySales() : undefined;
      const catalog: CatalogProduct[] = [];
      if (access) for (let first = 0; ; first += 1000) {
        const response = await access.client.from("products").select("branch_id,barcode,brand,model_description,srp")
          .in("branch_id", access.scope.branches.map(branch => branch.id)).eq("active", true)
          .order("branch_id").order("barcode").range(first, first + 999);
        if (response.error) throw new Error("Could not read the Sales Tracker product catalog.");
        catalog.push(...(response.data ?? []));
        if ((response.data?.length ?? 0) < 1000) break;
      }
      const brandsUrl = "/branchline/import-engine/brand-reference.mjs";
      const brands = destinations.ptg
        ? (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ brandsUrl)).BRAND_REFERENCE.brands
          .map((brand: { name: string }) => brand.name) as string[] : [];
      const selectedOffers = result.offers.filter(offer => !excluded.has(offer.id));
      const plan = await planPromotionPdfImport(selectedOffers, destinations, access?.scope.branches ?? [], catalog, brands);
      setReview({ ...plan, scope: access?.scope });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to check the promotion offers."); }
    finally { busy.current = false; setProgress(""); }
  }

  async function save() {
    if (!live || !review || !confirmed || !pending || uncertain || busy.current) return;
    busy.current = true;
    setProgress("Importing approved promotion offers…");
    setError("");
    let sales: Access | undefined;
    try {
      await runBatch(review.jobs, async job => {
        await verifyPtg(sessionId);
        if (job.sales) {
          sales = await verifySales();
          if (JSON.stringify(sales.scope) !== JSON.stringify(review.scope)) throw new Error("The Sales Tracker account or branches changed. Review the PDFs again.");
        }
      }, async job => {
        if (job.ptg) {
          try {
            const result = await invokePtgData(job.ptg.functionName, job.ptg.body);
            const summary = result.summary as { skipped?: boolean; totalProducts?: number } | undefined;
            if (!summary || !Number.isInteger(summary.totalProducts)) throw new Error("PTG could not confirm its import.");
            return summary.skipped ? { state: "skipped", detail: "Offers already imported." }
              : { state: "saved", detail: summary.totalProducts + " offers in this memo." };
          } catch (failure) {
            if (failure instanceof Error && "status" in failure && [400, 401, 403, 429].includes(Number(failure.status))) {
              return { state: "blocked", detail: failure.message };
            }
            throw failure;
          }
        }
        if (!job.sales || !sales) throw new Error("Sales Tracker access could not be verified.");
        const { data, error } = await sales.client.rpc(job.sales.rpc, job.sales.params);
        if (error) {
          if (/^[0-9A-Z]{5}$/.test(error.code ?? "")) return { state: "blocked", detail: error.message };
          throw new Error(error.message);
        }
        if (!Number.isInteger(data?.imported) || !Number.isInteger(data?.skipped)) throw new Error("Sales Tracker could not confirm its import.");
        return { state: data.imported ? "saved" : "skipped", detail: data.imported + " saved · " + data.skipped + " already present." };
      }, jobs => setReview({ ...review, jobs }));
    } finally { busy.current = false; setProgress(""); setConfirmed(false); }
  }

  return <main className="ptg-main">
    <h1>Promotion PDF Import</h1>
    <p>Upload the original PDFs, then review and import the offers here.</p>
    <section className="admin-card">
      <label className="upload-drop">
        <input type="file" accept=".pdf,application/pdf" multiple disabled={Boolean(progress) || started} onChange={event => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void convert(files);
        }} />
        <strong>Choose promotion PDFs</strong>
        <span>Up to 80 files · 20 MB each · 160 MB combined</span>
      </label>
      {progress && <p role="status">{progress}</p>}
      {error && <p role="alert">{error}</p>}
      {result && <>
        <p role="status">{result.offerCount} offer rows converted · {result.reviewCount} review notes</p>
        {result.reviewCount > 0 && <p>Open the Review sheet for the PDF pages and rows that need attention.</p>}
        <button type="button" className="admin-button" onClick={() => downloadPromotionWorkbook(result.book)}>Download Excel for reference</button>
        {result.offerCount > 0 && <fieldset disabled={Boolean(progress) || started}>
          <legend>Promotion destinations</legend>
          <p><label><input type="checkbox" checked={destinations.sales} onChange={event => changeSelection({ sales: event.target.checked })} /> Sales Tracker</label>{" "}
            <label><input type="checkbox" checked={destinations.ptg} onChange={event => changeSelection({ ptg: event.target.checked })} /> PTG</label></p>
          <p><label>Only this barcode <input type="search" value={destinations.barcode} placeholder="Optional"
            onChange={event => changeSelection({ barcode: event.target.value })} /></label></p>
          <p>Supply dates where the PDF leaves them blank.</p>
          <p><label>Start date <input type="date" value={destinations.start} onChange={event => changeSelection({ start: event.target.value })} /></label>{" "}
            <label>End date <input type="date" value={destinations.end} onChange={event => changeSelection({ end: event.target.value })} /></label></p>
          {competingPrices.length > 0 && <details>
            <summary>{competingPrices.length} barcodes with different offer prices · {excluded.size} offers excluded</summary>
            <p>Keep separate offers or uncheck a source offer to exclude it from both destinations.</p>
            {competingPrices.map(([barcode, offers]) => <fieldset key={barcode}>
              <legend>{barcode}</legend>
              {offers.map(offer => {
                const price = offer.tagPrice ?? offer.cashPayment;
                return <p key={offer.id}><label><input type="checkbox" checked={!excluded.has(offer.id)} onChange={event => {
                  const next = new Set(excluded);
                  if (event.target.checked) next.delete(offer.id);
                  else next.add(offer.id);
                  setExcluded(next);
                  changeSelection({});
                }} /> {price == null ? "Installment terms only" : pesos.format(price)} · {offer.description}
                {" · "}{offer.remarks ? offer.remarks + " · " : ""}{offer.sourceName}, page {offer.sourcePage}</label></p>;
              })}
            </fieldset>)}
          </details>}
          <button type="button" className="admin-button" disabled={!destinations.sales && !destinations.ptg} onClick={() => void prepare()}>Review import</button>
        </fieldset>}
      </>}
    </section>
    {review && <section className="admin-card">
      <h2>Confirm promotion import</h2>
      <p role="status">{started ? completed + " of " + review.jobs.length + " import batches confirmed." : "Review ready. Nothing saved yet."}</p>
      <ul>{review.jobs.map(job => <li key={job.key}>{job.scope} · {job.label} · {job.state}{job.detail ? " · " + job.detail : ""}</li>)}</ul>
      {!review.jobs.length && <p>No offers are ready to import.</p>}
      {!live && <p>This build supports conversion and import review.</p>}
      {live && pending && !uncertain && <fieldset disabled={Boolean(progress)}>
        <legend>Confirm destinations and offers</legend>
        <p><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I reviewed these offers and destinations.</label></p>
        <button type="button" className="admin-button" disabled={!confirmed} onClick={() => void save()}>Import ready offers</button>
      </fieldset>}
      {uncertain && <p role="alert">Check the destination before retrying the unconfirmed batch.</p>}
      {review.exceptions.length > 0 && <details open={!review.jobs.length}>
        <summary>{review.exceptions.length} destination exceptions</summary>
        <ul>{review.exceptions.map((item, index) => <li key={index}>
          {item.destination} · {item.barcode} · {item.file}, page {item.page} · {item.reason}
        </li>)}</ul>
      </details>}
    </section>}
  </main>;
}
