"use client";

import { withBasePath } from "@/lib/base-path";

import { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPtgAppSessionId } from "@/lib/ptg/auth-client";
import { invokePtgData } from "@/lib/ptg/edge-api";
import { parsePriceMemo } from "@/lib/price-memos/parse-price-memo";
import { buildBatchPlan, loadBatchEngine, runBatch, salesOperations, sourceDivisions,
  type BatchJob, type Branch, type DeskSalesTool, type Issue, type Operation, type SalesOperation, type Sheet, type Source } from "@/lib/ptg/batch-import";

const writes = process.env.NEXT_PUBLIC_PTG_ENABLE_BATCH_IMPORT_WRITES === "true";
const labels: Record<Operation, string> = {
  catalog: "Sales Tracker catalog", sales: "Sales database", daily: "Daily monitoring",
  inventory: "Inventory counts and serials", "ptg-catalog": "PTG Product Master", "ptg-memos": "PTG price memos",
};
const formatDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });
const snapshotTime = (value: string) => value ? value + (value.length === 16 ? ":00" : "") + "+08:00" : "";
type Scope = { userId: string; branches: Branch[] };
type Access = { scope: Scope; client: SupabaseClient };
type Review = { jobs: BatchJob[]; issues: Issue[]; scope?: Scope; inventory: boolean };
type Props = { tool?: DeskSalesTool; verifyPtg: (id: string) => Promise<void>; verifySales: () => Promise<Access> };
const message = (error: unknown) => error instanceof Error ? error.message : "The batch could not be processed.";

async function readScope(client: SupabaseClient, table: string, columns: string, branches: Branch[]) {
  const rows: unknown[] = [];
  for (let first = 0; ; first += 1000) {
    const response = await client.from(table).select(columns).in("branch_id", branches.map(branch => branch.id))
      .order("branch_id").order("barcode").range(first, first + 999);
    if (response.error) throw new Error("Could not verify the current Sales Tracker catalog or inventory.");
    const page = response.data ?? [];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export default function BatchImport({ tool, verifyPtg, verifySales }: Props) {
  const [sessionId] = useState(getPtgAppSessionId);
  const [sources, setSources] = useState<Source[]>([]);
  const [disabledSources, setDisabledSources] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [selectedOperations, setOperations] = useState<Operation[]>([]);
  const operations = tool?.operation ? [tool.operation] : selectedOperations;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [locationMap, setLocationMap] = useState<Record<string, string>>({});
  const [divisionMap, setDivisionMap] = useState<Record<string, string>>({});
  const [today] = useState(() => formatDate.format(new Date()));
  const [asOf, setAsOf] = useState(today);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<Review>();
  const [confirm, setConfirm] = useState(false);
  const [inventoryConfirm, setInventoryConfirm] = useState(false);
  const busy = useRef(false);
  const [parsers, setParsers] = useState<Awaited<ReturnType<typeof loadBatchEngine>>>();
  const included = sources.filter(source => !disabledSources.includes(source.file.name));
  const sheets = included.flatMap(source => source.sheets).filter(sheet => !excluded.includes(sheet.id));
  const locations = operations.includes("inventory") ? parsers?.engine.sourceLocations(sheets) ?? [] : [];
  const inventorySheets = operations.includes("inventory")
    ? sheets.filter(sheet => ["inventory", "serials"].includes(sheet.config.role)) : [];
  const singlePair = inventorySheets.length === 2 &&
    new Set(inventorySheets.map(sheet => sheet.config.role)).size === 2 &&
    inventorySheets.every(sheet => parsers?.engine.sourceLocations([sheet]).length === 1);
  const inventoryDates = new Set(inventorySheets.map(sheet => sheet.config.reportDate));
  const sharedSnapshot = inventoryDates.size === 1 ? inventorySheets[0].config.reportDate : "";
  const divisions = operations.includes("sales") ? sourceDivisions(sheets) : [];
  const started = review?.jobs.some(job => job.state !== "pending") ?? false;
  const uncertain = review?.jobs.some(job => job.state === "verify") ?? false;
  const blockingIssues = review?.issues.filter(issue => issue.severity === "ERROR") ?? [];
  const otherIssues = review?.issues.filter(issue => issue.severity !== "ERROR") ?? [];
  const savedCount = review?.jobs.filter(job => job.state === "saved").length ?? 0;
  const skippedCount = review?.jobs.filter(job => job.state === "skipped").length ?? 0;
  const finished = !!review?.jobs.length && savedCount + skippedCount === review.jobs.length;

  function invalidate() {
    setReview(undefined);
    setConfirm(false);
    setInventoryConfirm(false);
    setError("");
  }

  async function inspect(files: File[]) {
    if (!files.length || busy.current) return;
    invalidate();
    setSources([]); setExcluded([]); setDisabledSources([]); setLocationMap({}); setDivisionMap({});
    if (files.length > 80 || files.reduce((total, file) => total + file.size, 0) > 160 * 1024 * 1024 ||
      new Set(files.map(file => file.name)).size !== files.length) {
      setError("Choose up to 80 uniquely named source files, 160 MB combined.");
      return;
    }
    busy.current = true;
    setProgress("Checking your PTG session…");
    try {
      await verifyPtg(sessionId);
      const [xlsx, engine] = await Promise.all([import("xlsx"), loadBatchEngine()]);
      setParsers(engine);
      const next: Source[] = [];
      for (const [index, file] of files.entries()) {
        setProgress("Inspecting file " + (index + 1) + " of " + files.length + "…");
        try {
          if (!/\.(xlsx|xls|xlsm|csv)$/i.test(file.name) || file.size > 20 * 1024 * 1024) {
            throw new Error("Use an original Excel or CSV source, up to 20 MB per file.");
          }
          const book = xlsx.read(await file.arrayBuffer(), { type: "array", raw: true });
          const detected = engine.engine.inspectWorkbook(book, file.name, String(index), xlsx)
            .filter(sheet => sheet.rows.some(row => row.some(value => String(value ?? "").trim())));
          if (!detected.length) throw new Error("No readable worksheet was found.");
          next.push({ file, sheets: detected });
        } catch (failure) { next.push({ file, sheets: [], error: message(failure) }); }
      }
      setSources(next);
      if (tool?.operation && !branches.length && next.some(source => source.sheets.length)) {
        setProgress("Checking Sales Tracker permissions…");
        setBranches((await verifySales()).scope.branches);
      }
    } catch (failure) { setError(message(failure)); }
    finally { busy.current = false; setProgress(""); }
  }

  async function selectOperation(operation: Operation, checked: boolean) {
    if (busy.current) return;
    invalidate();
    setOperations(current => checked ? [...current, operation] : current.filter(item => item !== operation));
    if (!checked || !salesOperations.includes(operation as SalesOperation) || branches.length) return;
    busy.current = true; setProgress("Checking Sales Tracker permissions…");
    try { setBranches((await verifySales()).scope.branches); }
    catch (failure) { setOperations(current => current.filter(item => item !== operation)); setError(message(failure)); }
    finally { busy.current = false; setProgress(""); }
  }

  function configure(id: string | string[], patch: Partial<Sheet["config"]>) {
    invalidate();
    const ids = typeof id === "string" ? [id] : id;
    setSources(current => current.map(source => ({ ...source, sheets: source.sheets.map(sheet =>
      ids.includes(sheet.id) ? { ...sheet, config: { ...sheet.config, ...patch } } : sheet) })));
  }

  async function prepare() {
    if (!parsers || !operations.length || busy.current) return;
    invalidate(); busy.current = true; setProgress("Checking destinations and preparing the review…");
    const { engine, apis } = parsers;
    try {
      await verifyPtg(sessionId);
      const badSource = included.find(source => source.error);
      if (badSource) throw new Error("Correct or exclude " + badSource.file.name + " before reviewing.");
      if (!sheets.length) throw new Error("Include at least one readable worksheet.");
      const unrecognized = sheets.find(sheet => sheet.config.role === "unknown");
      if (unrecognized) throw new Error("Exclude or correct the unrecognized sheet " + unrecognized.file + " / " + unrecognized.name + ".");
      const selectedSales = operations.filter(operation => salesOperations.includes(operation as SalesOperation)) as SalesOperation[];
      const access = selectedSales.length ? await verifySales() : undefined;
      const branchList = access?.scope.branches ?? [];
      if (access && !branches.length) {
        setBranches(branchList);
        if (locations.length || divisions.length || operations.includes("daily")) {
          setError("Sales Tracker access verified. Finish the branch settings below, then choose Extract and review again.");
          return;
        }
      }
      const needed = [...new Set([...selectedSales, ...(operations.includes("ptg-catalog") ? ["catalog" as const] : [])])];
      const [knownProducts, knownStock] = await Promise.all([
        access && selectedSales.includes("catalog")
          ? readScope(access.client, "products", "branch_id,barcode,brand,model_description", branchList) : [],
        access && selectedSales.includes("inventory")
          ? readScope(access.client, "inventory_stock", "branch_id,barcode,serialized", branchList) : [],
      ]);
      const preview = needed.length ? engine.prepareImport(sheets, { branches: branchList, operations: needed, asOf, today,
        locationMap, divisionMap, knownProducts, knownStock }, apis) : undefined;
      const memos = [];
      if (operations.includes("ptg-memos")) {
        for (const source of included) {
          if (!sheets.some(sheet => sheet.id === source.sheets[0]?.id && sheet.config.role === "memo")) continue;
          try {
            const parsed = await parsePriceMemo(source.file);
            if (!parsed.period || parsed.memoId.startsWith("NO-MEMO-NUMBER-")) throw new Error("A memo number and covered period are required.");
            memos.push({ name: source.file.name, parsed });
          }
          catch (failure) { throw new Error(source.file.name + ": " + message(failure)); }
        }
      }
      const plan = buildBatchPlan(engine, preview, operations, memos, branchList, () => crypto.randomUUID());
      setReview({ ...plan, scope: access?.scope, inventory: operations.includes("inventory") });
    } catch (failure) { setError(message(failure)); }
    finally { busy.current = false; setProgress(""); }
  }

  async function save() {
    if (!writes || !review || !parsers || !confirm || busy.current || uncertain ||
      review.issues.some(issue => issue.severity === "ERROR") || (review.inventory && !inventoryConfirm)) return;
    const { engine } = parsers;
    busy.current = true; setProgress("Importing reviewed data…");
    let salesClient: SupabaseClient | undefined;
    try {
      await runBatch(review.jobs, async job => {
        await verifyPtg(sessionId);
        if (job.target === "sales") {
          const access = await verifySales();
          if (JSON.stringify(access.scope) !== JSON.stringify(review.scope)) throw new Error("Sales Tracker account or branch scope changed. Start a new review.");
          salesClient = access.client;
        }
      }, async job => {
        if (job.sales && salesClient) {
          const item = { ...job.sales };
          const client = salesClient;
          try { await engine.executeImportJobs([item], (name, params) => client.rpc(name, params)); }
          catch (failure) { if (item.status === "pending") return { state: "blocked", detail: message(failure) }; throw failure; }
          if (item.status !== "done") throw new Error("Sales Tracker did not confirm the result.");
        } else if (job.ptg) {
          try {
            const result = await invokePtgData(job.ptg.functionName, job.ptg.body);
            if (!result.summary) throw new Error("PTG did not confirm the result.");
            if ((result.summary as { skipped?: boolean }).skipped === true) return { state: "skipped", detail: "This memo already exists." };
          } catch (failure) {
            if (failure instanceof Error && "status" in failure && [400, 401, 403, 429].includes(Number(failure.status))) {
              return { state: "blocked", detail: message(failure) };
            }
            throw failure;
          }
        } else throw new Error("The destination could not be verified.");
        return { state: "saved", detail: undefined };
      }, jobs => setReview({ ...review, jobs }));
    } finally { busy.current = false; setProgress(""); setConfirm(false); setInventoryConfirm(false); }
  }

  const branchOptions = branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>);
  const branchSelect = (value: string, onChange: (id: string) => void) => <select value={value} onChange={event => onChange(event.target.value)}>
    <option value="">Choose a branch</option>{branchOptions}
  </select>;
  const list: readonly Operation[] = tool ? salesOperations : [...salesOperations, "ptg-catalog", "ptg-memos"];
  return <main className="ptg-main">
    <h1>{tool?.label ?? "Unified Import"}</h1>
      {!tool && <p><a className="admin-link" href={withBasePath("/data-desk/") + "?mode=promotion-pdf"}>Convert promotion PDFs to Excel</a></p>}
    <p>{tool
      ? "Choose your original Excel or CSV downloads and review the extracted records for Sales Tracker here in Data Desk. A Sales Tracker administrator session is required."
      : "Inspect the original Excel or CSV downloads together, then review the extracted records for both apps."}</p>
    {!writes && <p role="status"><strong>Dry run only.</strong> {tool
      ? "This build prepares the import without saving to Sales Tracker."
      : "This build prepares the import without saving to either app."}</p>}
    <section className="admin-card"><fieldset disabled={!!progress || started}>
      <legend>Source files and destinations</legend>
      <label className="upload-drop"><input type="file" multiple accept=".xlsx,.xls,.xlsm,.csv"
        onChange={event => void inspect(Array.from(event.target.files ?? []))} /><strong>Choose original source files</strong>
        <span>Up to 80 files · 20 MB each · 160 MB combined</span></label>
      {sources.length > 0 && <>
        {!tool?.operation && <>
          <h2>What should this batch import?</h2>
          {list.map(operation => <p key={operation}><label><input type="checkbox" checked={operations.includes(operation)}
            onChange={event => void selectOperation(operation, event.target.checked)} /> {labels[operation]}</label></p>)}
          <label>Pricing as of <input type="date" value={asOf} onChange={event => { setAsOf(event.target.value); invalidate(); }} /></label>
        </>}
        <details><summary>{sources.length} source files · {sheets.length} included worksheets</summary>
          {sources.map(source => <div key={source.file.name}>
            <p><label><input type="checkbox" checked={!disabledSources.includes(source.file.name)} onChange={event => {
              setDisabledSources(current => event.target.checked ? current.filter(name => name !== source.file.name) : [...current, source.file.name]); invalidate();
            }} /> {source.file.name}</label>{source.error && <span> · {source.error}</span>}</p>
            {!disabledSources.includes(source.file.name) && source.sheets.map(sheet => <details key={sheet.id}>
              <summary>{sheet.name} · {parsers?.engine.TYPES[sheet.config.role] ?? sheet.config.role} · {sheet.rows.length} source rows</summary>
              <label><input type="checkbox" checked={!excluded.includes(sheet.id)} onChange={event => {
                setExcluded(current => event.target.checked ? current.filter(id => id !== sheet.id) : [...current, sheet.id]); invalidate();
              }} /> Include this worksheet</label>
              {sheet.config.role === "daily" && operations.includes("daily") && <div>
                <p><label>Branch {branchSelect(sheet.config.branch, branch => configure(sheet.id, { branch }))}</label></p>
                <p><label>Year <input type="number" value={sheet.config.year} onChange={event => configure(sheet.id, { year: event.target.value })} /></label>{" "}
                  <label>Cutoff <input type="date" value={sheet.config.cutoff} onChange={event => configure(sheet.id, { cutoff: event.target.value })} /></label></p>
              </div>}
              {sheet.config.role === "forecast" && <p><label>Forecast year <input type="number" value={sheet.config.forecastYear}
                onChange={event => configure(sheet.id, { forecastYear: event.target.value })} /></label></p>}
              {operations.includes("inventory") && ["inventory", "serials"].includes(sheet.config.role) && <div>
                {sheet.config.role === "inventory" && <p><label><input type="checkbox" checked={sheet.config.blankZero}
                  onChange={event => configure(sheet.id, { blankZero: event.target.checked })} /> Blank quantities mean zero in this source</label></p>}
                {sheet.config.role === "serials" && <p><label>Received-date order <select value={sheet.config.dateOrder} onChange={event => configure(sheet.id, { dateOrder: event.target.value })}>
                  <option value="mdy">MM/DD/YYYY</option><option value="dmy">DD/MM/YYYY</option></select></label></p>}
              </div>}
            </details>)}
          </div>)}
        </details>
        {(locations.length > 0 || divisions.length > 0) && <h2>Match the source to a Sales Tracker branch</h2>}
        {locations.map(location => <p key={location}><label>{location} {branchSelect(locationMap[location] ?? "", id => {
          setLocationMap(current => ({ ...current, [location]: id })); invalidate();
        })}</label></p>)}
        {divisions.map(division => <p key={division}><label>Sales division {division} {branchSelect(divisionMap[division] ?? "", id => {
          setDivisionMap(current => ({ ...current, [division]: id })); invalidate();
        })}</label></p>)}
        {inventorySheets.length > 0 && <fieldset>
          <legend>Inventory snapshot and coverage</legend>
          {singlePair ? <>
            <ul>{inventorySheets.map(sheet => <li key={sheet.id}>
              {sheet.file} · Printed timestamp {sheet.reportDate ? sheet.reportDate.slice(0, 19).replace("T", " ") : "unavailable"}
            </li>)}</ul>
            <p>Confirm the cutoff both reports represent. If stock changed between reports, use a fresh pair.</p>
            <p><label>Snapshot time (Philippine time) <input type="datetime-local" step="1" value={sharedSnapshot.slice(0, 19)}
              onChange={event => configure(inventorySheets.map(sheet => sheet.id), { reportDate: snapshotTime(event.target.value) })} /></label></p>
            <p><label><input type="checkbox" checked={inventorySheets.every(sheet => sheet.config.complete)}
              onChange={event => configure(inventorySheets.map(sheet => sheet.id), { complete: event.target.checked })} /> Both reports are complete for the selected branch</label></p>
          </> : inventorySheets.map(sheet => <div key={sheet.id}>
            <p><strong>{sheet.file} · {sheet.name}</strong></p>
            <p><label>Snapshot time (Philippine time) <input type="datetime-local" step="1" value={sheet.config.reportDate.slice(0, 19)}
              onChange={event => configure(sheet.id, { reportDate: snapshotTime(event.target.value) })} /></label></p>
            <p><label><input type="checkbox" checked={sheet.config.complete} onChange={event => configure(sheet.id, { complete: event.target.checked })} /> Report is complete for its included branches</label></p>
          </div>)}
        </fieldset>}
        <p><button className="admin-button" type="button" disabled={!operations.length} onClick={() => void prepare()}>Extract and review</button></p>
      </>}
    </fieldset>
    {progress && <p role="status">{progress}</p>}
    {error && <p role="alert">{error}</p>}
    </section>
    {review && <section className="admin-card">
      <h2>Review destination and scope</h2>
      {!started && <p role="status">{blockingIssues.length
        ? "Nothing saved. Resolve the blocking issues and review again."
        : review.jobs.length ? "Review ready. Nothing has been saved." : "Nothing saved. No import jobs were prepared."}</p>}
      {started && <p role="status">{finished ? "Import complete." : "Import results so far."} Saved: {savedCount}. Skipped: {skippedCount}.</p>}
      {blockingIssues.length > 0 && <details open><summary>{blockingIssues.length} blocking issues</summary>
        <ul>{blockingIssues.slice(0, 100).map((issue, index) => <li key={index}>{issue.source_file ? issue.source_file + " · " : ""}{issue.message}</li>)}</ul>
        {blockingIssues.length > 100 && <p>Showing the first 100 blocking issues.</p>}</details>}
      {otherIssues.length > 0 && <details><summary>{otherIssues.length} review notes</summary>
        <ul>{otherIssues.slice(0, 100).map((issue, index) => <li key={index}>{issue.severity} · {issue.source_file ? issue.source_file + " · " : ""}{issue.message}</li>)}</ul>
        {otherIssues.length > 100 && <p>Showing the first 100 review notes.</p>}</details>}
      {review.jobs.length > 0 && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>App</th><th>Data and count</th><th>Scope</th><th>Result</th></tr></thead>
        <tbody>{review.jobs.map(job => <tr key={job.key}><td>{job.target === "sales" ? "Sales Tracker" : "PTG"}</td>
          <td>{job.label}</td><td>{job.scope}</td><td>{job.state === "verify" ? "Check destination before retrying" : job.state}
            {job.detail && " · " + job.detail}</td></tr>)}</tbody></table></div>}
      {writes && !uncertain && review.jobs.some(job => job.state === "pending" || job.state === "blocked") && !blockingIssues.length && <fieldset disabled={!!progress}>
        <legend>Confirm import</legend>
        <p><label><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} /> I reviewed the counts and destinations.</label></p>
        {review.inventory && <p><label><input type="checkbox" checked={inventoryConfirm} onChange={event => setInventoryConfirm(event.target.checked)} /> Replace stock only for the reviewed branches and snapshot times.</label></p>}
        <button className="admin-button" type="button" disabled={!confirm || (review.inventory && !inventoryConfirm)} onClick={() => void save()}>
          {started ? "Resume remaining imports" : "Import reviewed data"}</button>
      </fieldset>}
    </section>}
  </main>;
}
