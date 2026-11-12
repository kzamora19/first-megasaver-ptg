import type * as XLSX from "xlsx";
import type { ParsedMemo } from "../price-memos/parse-price-memo";

export function isPromotionPdfWorkbook(book: XLSX.WorkBook) {
  const index = book.Sheets["Source index"];
  return index?.A1?.v === "Worksheet" && index.B1?.v === "PDF" &&
    index.C1?.v === "Page" && index.D1?.v === "Offer rows";
}

export const salesOperations = ["catalog", "sales", "daily", "inventory"] as const;
export type SalesOperation = typeof salesOperations[number];
export type Operation = SalesOperation | "ptg-catalog" | "ptg-memos";
export const deskSalesTools = [
  { id: "inventory", label: "Inventory Counts & Serials", operation: "inventory" },
  { id: "sales", label: "Sales Database", operation: "sales" },
  { id: "daily", label: "Daily Monitoring", operation: "daily" },
  { id: "sales-center", label: "Sales Tracker Import Center", operation: null },
] as const;
export type DeskSalesTool = typeof deskSalesTools[number];
export type Branch = { id: string; name: string; code: string };
export type Sheet = {
  id: string; file: string; name: string; rows: unknown[][]; reportDate?: string;
  config: {
    role: string; header: number; cols: Record<string, number>; reportDate: string;
    year: number | string; forecastYear: number | string; branch: string; cutoff: string;
    complete: boolean; blankZero: boolean; dateOrder: string;
    validFrom: string; validTo: string; memoNumber: string;
  };
};
export type Source = { file: File; sheets: Sheet[]; error?: string };
export type CatalogItem = { barcode: string; brand: string; description: string; category: string; sub_category: string; srp?: number };
export type Issue = { severity: string; message: string; source_file?: string };
export type SalesPreview = {
  valid: boolean; catalog: CatalogItem[]; issues: Issue[];
  sales: unknown[]; daily: unknown[]; inventory: unknown[];
};
export type SalesJob = { label: string; rpc: string; params: Record<string, unknown>; status: string; result?: unknown };
export type BatchJob = {
  key: string; label: string; scope: string; target: "sales" | "ptg"; state: "pending" | "saved" | "skipped" | "blocked" | "verify";
  detail?: string; sales?: SalesJob; ptg?: { functionName: string; body: Record<string, unknown> };
};
export type Engine = {
  inspectWorkbook(book: XLSX.WorkBook, file: string, fileId: string, xlsx: typeof XLSX): Sheet[];
  sourceLocations(sheets: Sheet[]): string[];
  prepareImport(sheets: Sheet[], options: {
    branches: Branch[]; operations: SalesOperation[]; locationMap: Record<string, string>; divisionMap: Record<string, string>;
    asOf: string; today: string; knownProducts?: unknown[]; knownStock?: unknown[];
  }, apis: unknown): SalesPreview;
  createImportJobs(preview: SalesPreview, uuid: () => string): SalesJob[];
  executeImportJobs(jobs: SalesJob[], rpc: (name: string, params: Record<string, unknown>) => PromiseLike<unknown>): Promise<unknown>;
  TYPES: Record<string, string>;
};

const trackerPath = "/branchline/";
const loading = new Map<string, Promise<unknown>>();

function loadScript(file: string, globalName: string) {
  const globals = window as unknown as Record<string, unknown>;
  if (globals[globalName]) return Promise.resolve(globals[globalName]);
  const cached = loading.get(file);
  if (cached) return cached;
  const request = new Promise<unknown>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = trackerPath + file;
    script.onload = () => globals[globalName] ? resolve(globals[globalName]) : reject(new Error("Sales Tracker parser did not initialize."));
    script.onerror = () => reject(new Error("Could not load the Sales Tracker parser. Check your connection."));
    document.head.append(script);
  }).catch(error => { loading.delete(file); throw error; });
  loading.set(file, request);
  return request;
}

export async function loadBatchEngine() {
  const path = trackerPath + "unified-import.mjs";
  const [engine, sales, daily, inventory] = await Promise.all([
    import(/* webpackIgnore: true */ /* turbopackIgnore: true */ path) as Promise<Engine>,
    loadScript("sales-history.js", "BranchlineSalesHistory"),
    loadScript("daily-history.js", "BranchlineDailyHistory"),
    loadScript("inventory.js", "BranchlineInventory"),
  ]);
  return { engine, apis: { sales, daily, inventory } };
}

export function sourceDivisions(sheets: Sheet[]) {
  const result = new Set<string>();
  for (const sheet of sheets) {
    if (sheet.config.role !== "reference") continue;
    const index = sheet.rows[sheet.config.header]?.findIndex(value =>
      String(value).toLowerCase().replace(/[^a-z0-9]/g, "") === "divisioncode") ?? -1;
    if (index < 0) continue;
    for (const row of sheet.rows.slice(sheet.config.header + 1)) {
      const division = String(row[index] ?? "").trim().toUpperCase();
      if (division) result.add(division);
    }
  }
  return [...result].sort();
}

export function buildBatchPlan(
  engine: Engine, preview: SalesPreview | undefined, operations: Operation[],
  memos: { name: string; parsed: ParsedMemo }[], branches: Branch[], uuid: () => string,
) {
  const jobs: BatchJob[] = [];
  const issues = [...(preview?.issues ?? [])];
  const sales = operations.filter(operation => salesOperations.includes(operation as SalesOperation));
  if (sales.length && preview?.valid) {
    const allowed = { catalog: "import_unified_products", sales: "import_unified_sales_history",
      daily: "import_daily_history_with_payments", inventory: "import_unified_inventory" };
    const permitted = new Set(sales.map(operation => allowed[operation as SalesOperation]));
    for (const [index, job] of engine.createImportJobs(preview, uuid).filter(job => permitted.has(job.rpc)).entries()) {
      const name = (id: unknown) => branches.find(branch => branch.id === id)?.name;
      const id = job.params.p_branch;
      const entries = job.params.p_sales as { branch_id?: string }[] | undefined;
      const inventory = job.rpc === "import_unified_inventory";
      const stock = job.params.p_items as { quantity?: number; serials?: unknown[] }[] | undefined;
      const scope = job.rpc === "import_unified_products" ? branches.map(branch => branch.name).join(", ")
        : id ? name(id) ?? "Unknown branch"
        : [...new Set((entries ?? []).map(row => name(row.branch_id)))].filter(Boolean).join(", ");
      const label = inventory && stock ? "Replace inventory · " + stock.length + " products · " +
        stock.reduce((total, row) => total + (row.quantity ?? 0), 0) + " units · " +
        stock.reduce((total, row) => total + (row.serials?.length ?? 0), 0) + " serialized" : job.label;
      jobs.push({ key: "sales-" + index, label,
        scope: inventory ? scope + " · " + String(job.params.p_reported_at) : scope,
        target: "sales", state: "pending", sales: job });
    }
    for (const operation of sales) {
      if (!jobs.some(job => job.sales?.rpc === allowed[operation as SalesOperation])) {
        issues.push({ severity: "ERROR", message: "No usable Sales Tracker records were found for the selected " + operation + " import." });
      }
    }
  }
  if (operations.includes("ptg-catalog")) {
    const rows = preview?.catalog ?? [];
    if (!rows.length || rows.some(row => !row.barcode || !row.description || !row.brand || !row.category || !row.sub_category)) {
      issues.push({ severity: "ERROR", message: "PTG Product Master needs a barcode, description, brand, category and subcategory on every included product." });
    } else {
      for (let index = 0; index < rows.length; index += 1000) {
        const catalog = rows.slice(index, index + 1000).map(({ barcode, description, brand, category, sub_category }) =>
          ({ barcode, description, brand, category, sub_category }));
        jobs.push({ key: "ptg-catalog-" + index, label: catalog.length + " Product Master rows", scope: "Global catalog",
          target: "ptg", state: "pending", ptg: { functionName: "ptg-products",
            body: { action: "master-import", sourceFile: "Data Desk unified import", rows: catalog } } });
      }
    }
  }
  if (operations.includes("ptg-memos")) {
    if (!memos.length) issues.push({ severity: "ERROR", message: "No supported PTG price memos were selected." });
    const memoIds = new Set<string>();
    for (const { name, parsed } of memos) {
      const id = [parsed.memoId, parsed.period, parsed.memoType].join("|").toUpperCase();
      if (memoIds.has(id)) {
        issues.push({ severity: "ERROR", message: "The same memo and period appear twice in this batch.", source_file: name });
        continue;
      }
      memoIds.add(id);
      jobs.push({ key: "ptg-memo-" + memoIds.size, label: name + " · " + parsed.products.length + " memo products",
        scope: "Shared PTG price memo", target: "ptg", state: "pending", ptg: { functionName: "ptg-memos",
          body: { action: "import", memoId: parsed.memoId, period: parsed.period, memoType: parsed.memoType,
            sourceFile: name, duplicateAction: "SKIP", products: parsed.products } } });
    }
  }
  if (!jobs.length) issues.push({ severity: "ERROR", message: "No selected destination has importable rows." });
  return { jobs, issues };
}

export async function runBatch(jobs: BatchJob[], authorize: (job: BatchJob) => Promise<void>,
  write: (job: BatchJob) => Promise<{ state: "saved" | "skipped" | "blocked"; detail?: string }>, update: (jobs: BatchJob[]) => void) {
  const current = [...jobs];
  for (const [index, job] of current.entries()) {
    if (job.state === "saved" || job.state === "skipped") continue;
    if (job.state === "verify") return;
    try {
      await authorize(job);
    } catch (error) {
      current[index] = { ...job, state: "blocked", detail: error instanceof Error ? error.message : "Access could not be verified." };
      update([...current]);
      return;
    }
    try {
      const result = await write(job);
      current[index] = { ...job, ...result };
      update([...current]);
      if (result.state === "blocked") return;
    } catch (error) {
      current[index] = { ...job, state: "verify", detail: error instanceof Error ? error.message : "Verify this result in the destination." };
      update([...current]);
      return;
    }
  }
}
