"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ClientSessionGate from "@/components/client-session-gate";
import { getPtgAppSessionId, invokePtgAuth } from "@/lib/ptg/auth-client";
import { invokePtgData } from "@/lib/ptg/edge-api";
import BatchImport from "./batch-import";
import PromotionImport from "./promotion-import";
import SecurityWorkspace from "@/app/admin/accounts/security-workspace";
import { deskSalesTools } from "@/lib/ptg/batch-import";
import { combineCatalogs, destinations, publishCatalog, readCatalog, pilotLimit, workbookLimit, reviewRowLimit, type CatalogRow, type Destination, type ImportResults } from "@/lib/ptg/catalog-pilot";

const writes = process.env.NEXT_PUBLIC_PTG_ENABLE_CATALOG_PILOT_WRITES === "true";
const names = { sales: "Sales Tracker", ptg: "PTG" };
const megabyte = 1024 * 1024;
const previewLimit = 100;
let tracker: SupabaseClient | undefined;

function trackerClient() {
  const url = process.env.NEXT_PUBLIC_SALES_TRACKER_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SALES_TRACKER_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Sales Tracker is not configured for this pilot.");
  return tracker ??= createClient(url, key, {
    auth: {
      detectSessionInUrl: false,
      autoRefreshToken: false,
      storage: {
        getItem: name => sessionStorage.getItem(name) ?? localStorage.getItem(name),
        setItem: (name, value) => {
          const remember = sessionStorage.getItem(name) === null &&
            (localStorage.getItem(name) !== null || localStorage.getItem("branchline-remember") !== "0");
          (remember ? localStorage : sessionStorage).setItem(name, value);
          (remember ? sessionStorage : localStorage).removeItem(name);
        },
        removeItem: name => { sessionStorage.removeItem(name); localStorage.removeItem(name); },
      },
    },
  });
}

async function verifyPtg(sessionId: string) {
  if (!sessionId || getPtgAppSessionId() !== sessionId) throw new Error("Sign in to PTG as System Admin and review the file again.");
  const { account } = await invokePtgAuth("session");
  if (!account || account.role !== "SYSTEM_ADMIN" || account.mustChangePassword || getPtgAppSessionId() !== sessionId) {
    throw new Error("An active PTG System Admin session is required.");
  }
}

async function verifySales() {
  const sessionClient = trackerClient();
  const { data: stored } = await sessionClient.auth.getSession();
  const token = stored.session?.access_token;
  if (!token) throw new Error("Sign in to Sales Tracker as an administrator in this browser session.");
  const { data, error } = await sessionClient.auth.getUser(token);
  if (error || !data.user) throw new Error("Sign in to Sales Tracker as an administrator in this browser session.");
  const client = createClient(process.env.NEXT_PUBLIC_SALES_TRACKER_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SALES_TRACKER_SUPABASE_PUBLISHABLE_KEY!, { accessToken: async () => token });
  const { data: profile, error: profileError } = await client.from("profiles").select("role,active,dealer_id").eq("id", data.user.id).maybeSingle();
  if (profileError || !profile?.active || profile.role !== "admin" || !profile.dealer_id) {
    throw new Error("An active Sales Tracker administrator account is required.");
  }
  const { data: capabilities, error: capabilityError } = await client.rpc("unified_import_capabilities");
  if (capabilityError || capabilities?.version !== 1) throw new Error("Sales Tracker's catalog import is unavailable.");
  const { data: branches, error: branchError } = await client.from("branches").select("id,name,code").eq("dealer_id", profile.dealer_id).order("id");
  if (branchError || !branches?.length) throw new Error("Could not verify the Sales Tracker branch scope.");
  return { scope: { userId: data.user.id, branches: branches as { id: string; name: string; code: string }[] }, client };
}

type Review = { sourceNames: string[]; rows: CatalogRow[]; sales?: Awaited<ReturnType<typeof verifySales>>["scope"] };

function CatalogPilot() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [selected, setSelected] = useState<Destination[]>([]);
  const [review, setReview] = useState<Review>();
  const [results, setResults] = useState<ImportResults>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const running = useRef(false);
  const [sessionId] = useState(getPtgAppSessionId);

  useEffect(() => {
    let active = true;
    async function check() {
      try {
        if (!sessionId || getPtgAppSessionId() !== sessionId) throw new Error();
        await invokePtgAuth("session-status");
      } catch {
        if (active) router.replace("/dashboard/");
      }
    }
    const timer = window.setInterval(() => void check(), 30_000);
    window.addEventListener("focus", check);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [router, sessionId]);

  function clearReview() {
    setReview(undefined);
    setResults({});
    setConfirmed(false);
    setError("");
  }

  async function reviewCatalog() {
    if (!files.length || !selected.length || running.current) return;
    running.current = true;
    setBusy(true);
    clearReview();
    try {
      if (files.length > workbookLimit || files.reduce((total, file) => total + file.size, 0) > 160 * megabyte) {
        throw new Error("Choose up to " + workbookLimit + " workbooks totaling 160 MB or less.");
      }
      await verifyPtg(sessionId);
      const xlsx = await import("xlsx");
      const batches = [];
      for (const [index, file] of files.entries()) {
        try {
          setProgress("Reading workbook " + (index + 1) + " of " + files.length + "…");
          if (!/\.xlsx$/i.test(file.name) || file.name.length > 240 || file.size > 20 * megabyte) {
            throw new Error("Choose an .xlsx file up to 20 MB with a name of 240 characters or fewer.");
          }
          const rows = readCatalog(xlsx.read(await file.arrayBuffer(), { type: "array" }), xlsx);
          batches.push({ name: file.name, rows });
        } catch (reason) {
          throw new Error(file.name + ": " + (reason instanceof Error ? reason.message : "Unable to read workbook."));
        }
      }
      const rows = combineCatalogs(batches);
      const sales = selected.includes("sales") ? (await verifySales()).scope : undefined;
      setReview({ sourceNames: files.map(file => file.name), rows, sales });
      setResults(Object.fromEntries(selected.map(destination => [destination, { state: "pending" }])));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The import review could not be completed.");
    } finally {
      running.current = false;
      setProgress("");
      setBusy(false);
    }
  }

  async function save() {
    if (!writes || !review || review.rows.length > pilotLimit || !confirmed || running.current) return;
    running.current = true;
    setBusy(true);
    let approvedSalesClient: SupabaseClient | undefined;
    try {
      await publishCatalog(results, async destination => {
        await verifyPtg(sessionId);
        if (destination !== "sales") return;
        const current = await verifySales();
        if (JSON.stringify(current.scope) !== JSON.stringify(review.sales)) {
          throw new Error("The Sales Tracker account or branch scope changed. Start a new review.");
        }
        approvedSalesClient = current.client;
      }, async destination => {
        if (destination === "ptg") {
          try {
            await invokePtgData("ptg-products", { action: "master-import",
              sourceFile: review.sourceNames.length === 1 ? review.sourceNames[0] : "Data Desk · " + review.sourceNames.length + " reviewed workbooks",
              rows: review.rows });
          } catch (reason) {
            if (reason instanceof Error && "status" in reason && [400, 401, 403, 429].includes(Number(reason.status))) {
              return { state: "blocked", detail: reason.message };
            }
            throw reason;
          }
        } else {
          if (!approvedSalesClient) return { state: "blocked", detail: "Sales Tracker authorization is missing." };
          const { error: failure } = await approvedSalesClient.rpc("import_unified_products", { p_items: review.rows });
          if (failure) {
            if (/^(P0001|42501|22\w{3}|23\w{3})$/.test(failure.code)) return { state: "blocked", detail: failure.message };
            throw new Error(failure.message);
          }
        }
        return { state: "saved" };
      }, setResults);
    } finally {
      running.current = false;
      setBusy(false);
      setConfirmed(false);
    }
  }

  const canSave = Object.values(results).some(result => result.state === "pending" || result.state === "blocked");
  const started = Object.values(results).some(result => result.state !== "pending");
  const uncertain = Object.values(results).some(result => result.state === "verify");
  return <main className="ptg-main">
    <h1>Cross-App Catalog Review</h1>
    <p>Check product details and barcodes before sending a catalog to Sales Tracker, PTG, or both. This review reads the Products sheet and checks for missing fields and duplicate barcodes across workbooks.</p>
    {!writes && <p role="status"><strong>Dry run only.</strong> Live saving is disabled in this build.</p>}
    <section className="admin-card">
      <fieldset disabled={busy || uncertain}>
        <legend>Workbooks and destinations</legend>
        <label className="upload-drop"><input type="file" multiple accept=".xlsx" onChange={event => {
          setFiles(Array.from(event.target.files ?? [])); clearReview();
        }} /><strong>Choose Products workbooks</strong><span>Up to {workbookLimit} Excel workbooks · 20 MB each · 160 MB combined</span></label>
        <p className="admin-muted">Up to {reviewRowLimit.toLocaleString("en-US")} product rows per review.</p>
        {files.length > 0 && <details><summary>{files.length} workbooks selected</summary>
          <ul>{files.map((file, index) => <li key={index}>{file.name}</li>)}</ul></details>}
        {destinations.map(destination => <p key={destination}><label><input type="checkbox" checked={selected.includes(destination)}
          onChange={event => {
            setSelected(event.target.checked ? [...selected, destination] : selected.filter(value => value !== destination));
            clearReview();
          }} /> {names[destination]}</label></p>)}
        <button className="admin-button" type="button" onClick={() => void reviewCatalog()}
          disabled={!files.length || !selected.length || started}>{busy && !review ? "Checking…" : "Review catalog"}</button>
      </fieldset>
      {progress && <p role="status">{progress}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
    {review && <section className="admin-card">
      <h2>Review {review.rows.length} products</h2>
      <p>Source workbooks: {review.sourceNames.length}</p>
      <ul aria-live="polite">{destinations.filter(destination => results[destination]).map(destination => {
        const result = results[destination]!;
        return <li key={destination}><strong>{names[destination]}</strong> · {destination === "sales"
          ? review.sales?.branches.map(branch => branch.name).join(", ") + " (" + review.rows.length * (review.sales?.branches.length ?? 0) + " catalog rows)"
          : review.rows.length + " global Product Master rows"} · {result.state === "pending" ? "Ready" :
          result.state === "saved" ? "Saved" : result.state === "blocked" ? "Blocked. " + result.detail :
          "Result uncertain. Check the destination before starting another import."}</li>;
      })}</ul>
      <div className="admin-table-wrap"><table className="admin-table">
        <thead><tr><th>Barcode</th><th>Description</th><th>Brand</th><th>Category</th><th>Subcategory</th></tr></thead>
        <tbody>{review.rows.slice(0, previewLimit).map(row => <tr key={row.barcode}>
          <td>{row.barcode}</td><td>{row.description}</td><td>{row.brand}</td><td>{row.category}</td><td>{row.sub_category}</td>
        </tr>)}</tbody>
      </table></div>
      {review.rows.length > previewLimit && <p className="admin-muted">Showing the first {previewLimit} products. All {review.rows.length.toLocaleString("en-US")} were checked.</p>}
      {writes && review.rows.length > pilotLimit && <p>Live pilot saving is limited to {pilotLimit} products at a time.</p>}
      {writes && review.rows.length <= pilotLimit && canSave && <p><label><input type="checkbox" checked={confirmed} disabled={busy}
        onChange={event => setConfirmed(event.target.checked)} /> I reviewed the records and destination scope.</label>{" "}
        <button className="admin-button" type="button" onClick={() => void save()} disabled={!confirmed || busy}>
          {busy ? "Saving…" : started ? "Retry blocked destinations" : "Save reviewed catalog"}
        </button></p>}
    </section>}
  </main>;
}

function DataDeskView() {
  const query = useSearchParams();
  const catalog = query.get("mode") === "catalog";
  const srp = query.get("mode") === "srp";
  const promotions = query.get("mode") === "promotions";
  const tool = deskSalesTools.find(item => item.id === query.get("tool"));
  return <ClientSessionGate allowRoles={["SYSTEM_ADMIN"]}>{() => promotions ? <PromotionImport verifyPtg={verifyPtg} verifySales={verifySales} /> : srp ? <SecurityWorkspace desk /> : catalog ? <CatalogPilot /> :
    <BatchImport key={tool?.id ?? "unified"} tool={tool} verifyPtg={verifyPtg} verifySales={verifySales} />}</ClientSessionGate>;
}

export default function DataDeskPage() {
  return <Suspense fallback={null}><DataDeskView /></Suspense>;
}
