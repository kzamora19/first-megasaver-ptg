"use client";

import LogoutButton from "@/app/dashboard/logout-button";
import AppDialog from "@/components/app-dialog";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestPtgLogos, usesEdgeAssets } from "@/lib/ptg/edge-assets";
import { invokePtgData, usesEdgeData } from "@/lib/ptg/edge-api";
import { withBasePath } from "@/lib/base-path";
import { checkProductPrice, philippineToday } from "@/lib/ptg/price-validation.mjs";
import { reviewOfferConflicts, reviewInstallments } from "@/lib/ptg/price-conflicts.mjs";
import { summarizePrintQueue } from "@/lib/ptg/print-queue-checks.mjs";
import { visibleOffersForBarcode, memoEntriesForOffer } from "@/lib/ptg/offer-comparison.mjs";
import { reviewPrintQueue } from "@/lib/ptg/print-preflight.mjs";
import { appendVisibleBrandOffers } from "@/lib/ptg/queue-selection.mjs";
import { groupedPrintPlan, expandedPrintBatch, normalizePrintCopies } from "@/lib/ptg/print-batches.mjs";

type MemoInfo = {
  memo_id: string;
  period: string;
  memo_type: string;
  created_at?: string;
  source_file?: string;
};
export type Product = {
  id: string;
  memo_id: string;
  brand: string;
  category: string;
  barcode: string;
  model: string;
  description: string;
  sub_category: string;
  srp: number;
  cash_payment?: number;
  has_cash_payment?: boolean;
  tag_this: number;
  months_6: number;
  months_9: number;
  months_12: number;
  months_18: number;
  months_24: number;
  remarks: string;
  eligible_for_price_tag?: boolean;
  price_tag_status?: string;
  source_file?: string;
  campaign?: string | null;
  selling_starts_on?: string | null;
  selling_ends_on?: string | null;
  early_print_only?: boolean;
  price_memos: MemoInfo | MemoInfo[] | null;
  unit_only_offer?: Product | null;
};
type FormatKey = "ONE" | "TWO" | "FOUR" | "SIX" | "AIRCON" | "SMALL_APPS" | "CARAVAN";
type LogoKey = "header" | "promo" | "social" | "appHeader" | `aircon:${string}`;
type LogoMap = Partial<Record<LogoKey, { url: string; originalFileName: string; updatedAt: string }>>;
type StockInfo = { quantity: number; serialized: boolean; scope: string };
type ProductSalesInsights = StockInfo & {
  aggregated: true; source: string; barcode: string;
  recent: { from: string; to: string; units: number; transactions: number; lastSaleDate: string | null };
};
type StockSerial = { serial: string; receivedOn: string | null; branch: string };
type MemoFilter = "all" | "regular" | "promotion";

const formats: { key: FormatKey; label: string }[] = [
  { key: "ONE", label: "1 WHOLE" },
  { key: "TWO", label: "1/2" },
  { key: "FOUR", label: "2 X 2" },
  { key: "SIX", label: "2 X 3" },
  { key: "AIRCON", label: "AIRCON" },
  { key: "SMALL_APPS", label: "SMALL APPS" },
  { key: "CARAVAN", label: "CARAVAN" },
];
const airconSizes = [
  { hp: 1, area: "14–17 SQM" }, { hp: 1.5, area: "18–22 SQM" },
  { hp: 2, area: "23–35 SQM" }, { hp: 2.5, area: "36–41 SQM" },
  { hp: 3, area: "42–47 SQM" },
];
const sheetSizes = { ONE: 1, TWO: 2, FOUR: 4, SIX: 6, SMALL_APPS: 6, CARAVAN: 6, AIRCON: 5 };

function airconSlot(product: Product) {
  for (const value of [product.description, product.model]) {
    const capacity = value?.match(/(\d+(?:\.\d+)?)\s*HP\b/i);
    const slot = airconSizes.findIndex(size => size.hp === Number(capacity?.[1]));
    if (slot >= 0) return slot;
  }
  return -1;
}

function airconSheets(queue: Product[]) {
  const brands = new Map<string, (Product | null)[][]>();
  for (const product of queue) {
    const slot = airconSlot(product);
    if (slot < 0) continue;
    const brand = product.brand.trim().toUpperCase();
    const sheets = brands.get(brand) ?? [];
    let sheet = sheets.find(rows => !rows[slot]);
    if (!sheet) {
      sheet = airconSizes.map(() => null);
      sheets.push(sheet);
    }
    sheet[slot] = product;
    brands.set(brand, sheets);
  }
  return [...brands].sort(([a], [b]) => a.localeCompare(b)).flatMap(([brand, sheets]) =>
    sheets.map((rows, index) => ({ brand, rows, key: brand + ":" + index })),
  );
}

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

function BlankRows({ used, columns = 8 }: { used: number; columns?: number }) {
  return Array.from({ length: Math.max(0, pageSize - used) }, (_, index) =>
    <tr className="legacy-blank-row" aria-hidden="true" key={index}><td colSpan={columns}>&nbsp;</td></tr>
  );
}
const amount = (value: number | null | undefined) => Number(value || 0);
const peso = (value: number | null | undefined) => "₱ " + amount(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const priceNow = (product: Product) => amount(product.tag_this);
const offerDate = (date: string) => new Date(date + "T00:00:00Z")
  .toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "UTC" });
const installments = (product: Product) => ([6, 9, 12, 18, 24] as const)
  .map(months => ({ months, total: amount(product[`months_${months}`]) }))
  .filter(({ total }) => total > 0);
function InstallmentOfferTable({ product, caption }: { product: Product; caption: string }) {
  const rows = installments(product);
  return <table className="legacy-product-installment-table">
    <caption>{caption}</caption>
    <thead><tr><th scope="col">Term</th><th scope="col">Total installment</th><th scope="col">Monthly payment</th></tr></thead>
    <tbody>
      {rows.map(({ months, total }) =>
        <tr key={months}><th scope="row">{months} months</th><td>{peso(total)}</td><td>{peso(total / months)}</td></tr>
      )}
      {!rows.length && <tr><td colSpan={3}>No installment prices available.</td></tr>}
    </tbody>
  </table>;
}
const memoInfo = (product: Product | null): MemoInfo | null => {
  if (!product) return null;
  return Array.isArray(product.price_memos) ? product.price_memos[0] ?? null : product.price_memos;
};
const memoLabel = (memo: MemoInfo | null, product: Product | null) => {
  const memoId = memo?.memo_id || "";
  if (!/^PDF-[a-f0-9]{64}$/i.test(memoId)) return memoId;
  const source = memo?.source_file || product?.source_file;
  return source?.trim().replace(/\.pdf$/i, "") || memoId;
};
function MemoSummary({ product }: { product: Product }) {
  const memo = memoInfo(product);
  const label = memoLabel(memo, product);
  if (!label) return null;
  return <><br /><small>{product.campaign && <strong>{product.campaign} · </strong>}{label}{memo?.period ? <> · {memo.period}</> : null}</small></>;
}
function SearchOfferLabel({ product }: { product: Product }) {
  const memo = memoInfo(product);
  if (!memo) return null;
  const label = product.campaign === "SUBDEALER" ? "SUBDEALER · RESTRICTED"
    : product.campaign
    ? product.campaign + " PROMO"
    : /^PDF-[a-f0-9]{64}$/i.test(memo.memo_id) ? "PROMO" : "REGULAR MONTHLY";
  return <><br /><small><strong>{label}</strong></small></>;
}

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
  if (product.price_tag_status === "SRP ONLY") return "SRP ONLY";
  if (product.eligible_for_price_tag === true || String(product.price_tag_status || "").toUpperCase().includes("ELIGIBLE")) return "YES";
  if (product.eligible_for_price_tag === false || product.price_tag_status) return "NO";
  return "NO";
};
const modelLabel = (product: Product) => product.description?.trim() || product.model || "View details";

export default function ProductSearch({
  branchCode,
  branchName = "",
  username = "",
  legacyRole = "",
  systemRole = "",
  demoProducts,
}: {
  branchCode: string;
  branchName?: string;
  username?: string;
  legacyRole?: string;
  systemRole?: string;
  demoProducts?: readonly Product[];
}) {
  const demo = demoProducts !== undefined;
  useEffect(() => {
    if (window.location.hash === "#print-price-tags") {
      document.getElementById("print-price-tags")?.scrollIntoView();
    }
  }, []);
  useEffect(() => {
    const sidebar = document.querySelector<HTMLElement>(".ptg-sidebar");
    if (!sidebar) return;
    const updateOffset = () => document.documentElement.style.setProperty("--ptg-mobile-sidebar-height", `${sidebar.getBoundingClientRect().height}px`);
    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    observer.observe(sidebar);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--ptg-mobile-sidebar-height"); };
  }, []);

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [queue, setQueue] = useState<Product[]>([]);
  const [batchPlannerEnabled, setBatchPlannerEnabled] = useState(false);
  const [batchDefaultFormat, setBatchDefaultFormat] = useState<FormatKey>("ONE");
  const [printPreferences, setPrintPreferences] = useState<Record<string, { format: FormatKey; copies: number }>>({});
  const [bulkBrand, setBulkBrand] = useState("");
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [inStock, setInStock] = useState(false);
  const [memoFilter, setMemoFilter] = useState<MemoFilter>("all");
  const [showSubdealer, setShowSubdealer] = useState(false);
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [campaign, setCampaign] = useState("");
  const [stock, setStock] = useState<StockInfo | null>(null);
  const [stockMessage, setStockMessage] = useState("");
  const [comparableOffers, setComparableOffers] = useState<Product[]>([]);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonPartial, setComparisonPartial] = useState(false);
  const [comparisonMessage, setComparisonMessage] = useState("");
  const [insights, setInsights] = useState<ProductSalesInsights | null>(null);
  const [insightsMessage, setInsightsMessage] = useState("");
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [showSerials, setShowSerials] = useState(false);
  const [serials, setSerials] = useState<StockSerial[] | null>(null);
  const [serialMessage, setSerialMessage] = useState("");
  const inventoryEnabled = usesEdgeData && !demo;
  // This feature requires separate opt-in at PTG frontend, PTG Edge and
  // Sales Tracker Edge. Until then, no sales information is requested.
  const salesInsightsEnabled = inventoryEnabled && process.env.NEXT_PUBLIC_PTG_SALES_INSIGHTS_ENABLED === "true";
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRequest = useRef(0);
  const [queuePage, setQueuePage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [format, setFormat] = useState<FormatKey>("ONE");
  const [refreshingLogos, setRefreshingLogos] = useState(false);
  const [logoMessage, setLogoMessage] = useState("");
  const [logoVersion, setLogoVersion] = useState(0);
  const [logos, setLogos] = useState<LogoMap>(() => demo ? {
    appHeader: { url: withBasePath("/legacy-ptg/app-header.png"), originalFileName: "app-header.png", updatedAt: "" },
    header: { url: withBasePath("/legacy-ptg/price-tag-header.png"), originalFileName: "price-tag-header.png", updatedAt: "" },
    social: { url: withBasePath("/legacy-ptg/price-tag-footer.png"), originalFileName: "price-tag-footer.png", updatedAt: "" },
  } : {});

  const refreshLogos = useCallback(async () => {
    try {
      const response = usesEdgeAssets
        ? await requestPtgLogos("GET")
        : await fetch("/api/logos", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) return false;
      setLogos(payload.logos || {});
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!demo) void refreshLogos();
  }, [demo, refreshLogos]);

  async function refreshArtwork() {
    setRefreshingLogos(true);
    setLogoMessage("");
    try {
      if (await refreshLogos()) {
        setLogoVersion(value => value + 1);
        setLogoMessage("Logos refreshed.");
      } else {
        setLogoMessage("Could not refresh logos. Try again.");
      }
    } finally {
      setRefreshingLogos(false);
    }
  }

  const loadProducts = useCallback(async (query: string, requestedPage: number, onlyStock = false, filter: MemoFilter = "all", selectedCampaign = "", includeSubdealer = false) => {
    const request = ++searchRequest.current;
    setLoading(true);
    try {
      let payload: { ok: boolean; products: Product[]; total: number; page: number; campaigns?: string[] };
      if (demoProducts) {
        const term = query.trim().toLowerCase();
        const matches = demoProducts.filter(product =>
          [product.brand, product.model, product.barcode, product.description].some(value => value.toLowerCase().includes(term)));
        const start = (requestedPage - 1) * pageSize;
        payload = { ok: true, products: matches.slice(start, start + pageSize), total: matches.length, page: requestedPage };
      } else if (usesEdgeData) {
        payload = await invokePtgData("ptg-products", {
          action: "search",
          q: query.trim(),
          page: requestedPage,
          in_stock: onlyStock,
          regular_only: filter === "regular",
          promotions_only: filter === "promotion",
          campaign: selectedCampaign,
          include_subdealer: includeSubdealer,
        }) as typeof payload;
      } else {
        const params = new URLSearchParams({ page: String(requestedPage) });
        if (query.trim()) params.set("q", query.trim());
        const response = await fetch("/api/products/search?" + params.toString(), { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || "Search failed.");
        payload = result;
      }
      if (!payload.ok || !Array.isArray(payload.products)) throw new Error("Search failed.");
      if (request !== searchRequest.current) return;
      setSearchQuery(query);
      setCampaigns(payload.campaigns ?? []);
      setResults(payload.products as Product[]);
      setTotal(Number(payload.total || 0));
      setPage(Number(payload.page || requestedPage));
      setMessage(query.trim()
        ? (payload.total ? payload.total + " matching price entries." : "No matching products found.")
        : filter === "promotion"
          ? (payload.total ? "Promotion offers." : "No promotion offers found.")
          : filter === "regular"
            ? (payload.total ? "Regular memo offers." : "No regular memo offers found.")
            : (payload.total ? "Memo and SRP products." : "No memo or SRP products found."));
    } catch (error) {
      if (request === searchRequest.current) {
        setResults([]);
        setTotal(0);
        setPage(1);
        setMessage(error instanceof Error ? error.message : "Search failed.");
      }
    } finally {
      if (request === searchRequest.current) setLoading(false);
    }
  }, [demoProducts]);

  useEffect(() => { void loadProducts("", 1); }, [loadProducts]);

  const detailBarcode = detailProduct?.barcode;
  useEffect(() => {
    if (!inventoryEnabled || !detailBarcode) return;
    let current = true;
    void invokePtgData("ptg-products", { action: "inventory", barcode: detailBarcode })
      .then(value => { if (current) setStock(value as StockInfo); })
      .catch(error => { if (current) setStockMessage(error instanceof Error ? error.message : "Inventory unavailable."); });
    return () => { current = false; };
  }, [inventoryEnabled, detailBarcode]);

  useEffect(() => {
    if (!salesInsightsEnabled || !detailBarcode) {
      setInsights(null);
      setInsightsMessage("");
      setInsightsLoading(false);
      return;
    }
    let active = true;
    setInsights(null);
    setInsightsMessage("");
    setInsightsLoading(true);
    void invokePtgData("ptg-products", { action: "insights", barcode: detailBarcode })
      .then(data => { if (active) setInsights(data as unknown as ProductSalesInsights); })
      .catch(error => { if (active) setInsightsMessage(error instanceof Error ? error.message : "Sales activity unavailable."); })
      .finally(() => { if (active) setInsightsLoading(false); });
    return () => { active = false; };
  }, [salesInsightsEnabled, detailBarcode]);

  useEffect(() => {
    if (!usesEdgeData || demo || !detailBarcode) {
      setComparableOffers([]);
      setComparisonLoading(false);
      setComparisonPartial(false);
      setComparisonMessage("");
      return;
    }
    let current = true;
    setComparableOffers([]);
    setComparisonMessage("");
    setComparisonPartial(false);
    setComparisonLoading(true);
    const permittedSubdealer = showSubdealer &&
      (systemRole === "SYSTEM_ADMIN" || (systemRole === "BRANCH_ADMIN" && legacyRole.trim().toUpperCase() === "BRANCH MANAGER"));
    void invokePtgData("ptg-products", {
      action: "comparable-offers", barcode: detailBarcode, include_subdealer: permittedSubdealer,
    }).then(response => {
      if (!current) return;
      const payload = response as { products?: Product[]; partial?: boolean };
      setComparableOffers(Array.isArray(payload.products) ? payload.products : []);
      setComparisonPartial(payload.partial === true);
    }).catch(error => { if (current) setComparisonMessage(
      error instanceof Error ? error.message : "Additional comparable offers could not be checked."
    ); }).finally(() => { if (current) setComparisonLoading(false); });
    return () => { current = false; };
  }, [detailBarcode, usesEdgeData, demo, showSubdealer, systemRole, legacyRole]);

  useEffect(() => {
    if (!inventoryEnabled || !detailBarcode || !showSerials) return;
    let current = true;
    void invokePtgData("ptg-products", { action: "inventory", barcode: detailBarcode, include_serials: true })
      .then(value => { if (current) { setStock(value as StockInfo); setSerials((value.serials ?? []) as StockSerial[]); } })
      .catch(error => { if (current) setSerialMessage(error instanceof Error ? error.message : "Serials unavailable."); });
    return () => { current = false; };
  }, [inventoryEnabled, detailBarcode, showSerials]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const queueTotalPages = Math.max(1, Math.ceil(queue.length / pageSize));
  const visibleQueuePage = Math.min(queuePage, queueTotalPages);
  const queueRows = queue.slice((visibleQueuePage - 1) * pageSize, visibleQueuePage * pageSize);
  const firstResult = total ? (page - 1) * pageSize + 1 : 0;
  const lastResult = Math.min(page * pageSize, total);
  const currentMemo = memoInfo(activeProduct);
  const detailMemo = memoInfo(detailProduct);
  const detailUnitOnly = detailProduct?.unit_only_offer ?? null;

  function openProductDetails(product: Product) {
    if (!detailProduct || detailProduct.barcode !== product.barcode) {
      setStock(null);
      setStockMessage("");
      setShowSerials(false);
      setSerials(null);
      setSerialMessage("");
    }
    setActiveProduct(product);
    setDetailProduct(product);
  }
  const canManageBranch = systemRole === "BRANCH_ADMIN";
  const canSeeCashPrice = systemRole === "SYSTEM_ADMIN" ||
    (canManageBranch && legacyRole.trim().toUpperCase() === "BRANCH MANAGER");

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadProducts(term, 1, inStock, memoFilter, campaign, showSubdealer);
  }

  function changeMemoFilter(filter: MemoFilter) {
    setMemoFilter(filter);
    void loadProducts(term, 1, inStock, filter, campaign, showSubdealer);
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

  function addVisibleBrand() {
    if (!bulkBrand.trim()) return;
    const { queue: next, matching, additions } = appendVisibleBrandOffers(queue, results, bulkBrand);
    if (!matching.length) {
      setMessage("No visible products match the selected brand on this page.");
      return;
    }
    setQueue(next);
    setQueuePage(current => Math.min(current, Math.max(1, Math.ceil(next.length / pageSize))));
    setActiveProduct(matching[0]);
    setMessage(additions.length + " new " + bulkBrand + " offer(s) added from the current search page. Other pages are not automatically selected.");
  }

  function setPrintFormat(next: FormatKey) {
    setFormat(next);
    if (queue.length) setMessage(queue.length + " selected product(s) ready to print.");
  }

  const compact = format === "SIX" || format === "SMALL_APPS" || format === "CARAVAN";
  const srpOnly = format === "SMALL_APPS" || format === "CARAVAN";
  const plannedGroups = groupedPrintPlan(queue, printPreferences, batchDefaultFormat);
  const printQueue = expandedPrintBatch(queue, printPreferences, format, batchDefaultFormat, batchPlannerEnabled);
  const invalidAircon = format === "AIRCON" ? printQueue.filter(product => airconSlot(product) < 0) : [];
  const printable = invalidAircon.length === 0;
  const airconPages = format === "AIRCON" ? airconSheets(printQueue) : [];
  const tagsPerSheet = sheetSizes[format];
  const sheets = Array.from({ length: Math.ceil(printQueue.length / tagsPerSheet) }, (_, index) => printQueue.slice(index * tagsPerSheet, (index + 1) * tagsPerSheet));
  const printReview = reviewPrintQueue(printQueue, format, { airconPages: airconPages.length });

  function printTags() {
    if (!printQueue.length) {
      setMessage(batchPlannerEnabled ? "Select a batch with queued products to print." : "Select at least one product before printing.");
      return;
    }
    if (!printable) {
      setMessage("Remove items without a supported Aircon capacity before printing.");
      return;
    }
    const date = new Date();
    document.title = (demo ? "DEMO_" : "") + "FIRST_MEGASAVER_PRICE_TAGS_" + date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    window.print();
  }

  function airconBrandArtwork(brand: string) {
    const key = brand.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!key) return undefined;
    const normalized = ["TMAMA", "TOUGHMAM"].includes(key) ? "TOUGHMAMA" : key;
    const exact = artworkUrl(`aircon:${normalized}`);
    if (exact) return exact;
    const candidates = Object.keys(logos).filter((slot): slot is `aircon:${string}` => slot.startsWith("aircon:"))
      .filter(slot => {
        const name = slot.slice(7);
        return normalized.startsWith(name) || name.startsWith(normalized);
      });
    return candidates.length === 1 ? artworkUrl(candidates[0]) : undefined;
  }

  function artworkUrl(key: LogoKey) {
    const url = logos[key]?.url;
    return url ? url + (url.includes("?") ? "&" : "?") + "refresh=" + logoVersion : undefined;
  }

  const currentBranchLabel = branchName || ({ CAU: "Cauayan", ILA: "Ilagan", STG: "Santiago", TUG: "Tuguegarao" } as Record<string, string>)[branchCode.toUpperCase()] || branchCode;
  const visibleBrands = [...new Set(results.map(item => String(item.brand || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  return (
    <main className="ptg-main legacy-ptg-main" data-demo={demo || undefined}>
      {logos.appHeader && <div className="ptg-print-hide legacy-products-banner-pin">
        <img src={artworkUrl("appHeader")} alt="Interface header artwork" className="legacy-products-banner" />
      </div>}

      {demo ? <section className="legacy-branch-tools ptg-print-hide" aria-label="Demo workspace">
        <div className="legacy-tools-heading"><strong>DEMO · SAMPLE PRODUCTS ONLY</strong><a href={withBasePath("/login/")}>Exit demo</a></div>
        <p>Search fictional products, try the print formats, and print or save sample tags as PDF.</p>
      </section> : systemRole !== "SYSTEM_ADMIN" && <section className="legacy-branch-tools ptg-print-hide">
        <div className="legacy-tools-heading"><strong>BRANCH TOOLS</strong><span className="legacy-tools-account"><LogoutButton /><small>{username} · {branchCode} — {legacyRole || systemRole.replaceAll("_", " ")}</small></span></div>
        <nav>
          {canManageBranch && <a href={withBasePath("/change-password/")}>CHANGE PASSWORD</a>}
          {canManageBranch && legacyRole.trim().toUpperCase() === "BRANCH MANAGER" && <a href={withBasePath("/admin/accounts/")}>ACCOUNT ADMINISTRATION</a>}
          {canManageBranch && <a href={withBasePath("/price-memos/import")}>IMPORT PRICE MEMOS</a>}
        </nav>
      </section>}

      <div className="legacy-search-workflow ptg-print-hide">
        <section className="legacy-search-card">
          <h2>Select Product</h2>
          <div className="legacy-search-fields">
            <form onSubmit={submitSearch} className="legacy-search-form">
              <label htmlFor="legacy-product-search">SEARCH PRODUCT</label>
              <div><input id="legacy-product-search" value={term} onChange={event => setTerm(event.target.value)} placeholder="Search brand, model, barcode, description..." aria-label="Search brand, model, barcode, description" /><button type="submit" disabled={loading}>{loading ? "SEARCHING…" : "SEARCH"}</button></div>
            </form>
            {inventoryEnabled && <div className="legacy-search-filters">
              <label className="legacy-stock-filter"><input type="checkbox" checked={inStock} onChange={event => {
                setInStock(event.target.checked);
                void loadProducts(term, 1, event.target.checked, memoFilter, campaign, showSubdealer);
              }} /> In stock only</label>
              <label className="legacy-stock-filter"><input type="checkbox" checked={memoFilter === "regular"} disabled={showSubdealer}
                onChange={event => changeMemoFilter(event.target.checked ? "regular" : "all")} /> Regular memos only</label>
              <label className="legacy-stock-filter"><input type="checkbox" checked={memoFilter === "promotion"} disabled={showSubdealer}
                onChange={event => changeMemoFilter(event.target.checked ? "promotion" : "all")} /> Promotion memos only</label>
              {canSeeCashPrice && <label className="legacy-stock-filter ptg-subdealer-filter">
                <input type="checkbox" checked={showSubdealer} onChange={event => {
                  const enabled = event.target.checked;
                  setShowSubdealer(enabled);
                  if (enabled) {
                    // Subdealer is its own search mode rather than an
                    // additional campaign mixed with regular memo prices.
                    setMemoFilter("all");
                    setCampaign("");
                  }
                  if (!enabled) {
                    setQueue(items => items.filter(item => item.campaign !== "SUBDEALER"));
                    setActiveProduct(item => item?.campaign === "SUBDEALER" ? null : item);
                    setDetailProduct(item => item?.campaign === "SUBDEALER" ? null : item);
                  }
                  void loadProducts(term, 1, inStock,
                    enabled ? "all" : memoFilter, enabled ? "" : campaign, enabled);
                }} /> Subdealer prices
              </label>}
            </div>}
            {!demo && usesEdgeData && memoFilter === "promotion" && !showSubdealer && <label className="legacy-stock-filter">Promotion <select value={campaign} onChange={event => {
              setCampaign(event.target.value);
              void loadProducts(term, 1, inStock, "promotion", event.target.value, showSubdealer);
            }}><option value="">All promotions</option>{campaigns.map(name => <option key={name} value={name}>{name}</option>)}</select></label>}
            <div className="legacy-memo-info">
              <label>MEMO_ID<input readOnly value={memoLabel(currentMemo, activeProduct)} /></label>
              <label>PERIOD<input readOnly value={currentMemo?.period || ""} /></label>
              <label>IMPORT_DATE<input readOnly value={currentMemo?.created_at ? new Date(currentMemo.created_at).toLocaleDateString("en-US") : ""} /></label>
            </div>
          </div>
        </section>

      <section className="legacy-results-panel ptg-print-hide">
        {message && <p className="legacy-status-message" role="status">{message}</p>}
        {!!visibleBrands.length && <div className="ptg-bulk-brand">
          <label htmlFor="ptg-bulk-brand-select">Add visible brand offers</label>
          <select id="ptg-bulk-brand-select" value={bulkBrand} onChange={event => setBulkBrand(event.target.value)}>
            <option value="">Choose a brand</option>
            {visibleBrands.map(brand => <option key={brand} value={brand}>{brand}</option>)}
          </select>
          <button type="button" disabled={!bulkBrand || !visibleBrands.includes(bulkBrand)} onClick={addVisibleBrand}>
            Add from this page
          </button>
        </div>}
        <div className="legacy-table-frame" aria-busy={loading}>
          <table className="legacy-products-table legacy-search-results-table">
            <thead><tr>
              <th><input type="checkbox" aria-label="Select all visible products" checked={results.length > 0 && results.every(item => queue.some(queued => queued.id === item.id))} onChange={event => toggleVisible(event.target.checked)} /></th>
              <th>Barcode</th><th>Brand</th><th>Model</th><th>SRP</th><th>TAG THIS</th><th>Status</th>
            </tr></thead>
            <tbody>
              {loading && !results.length ? <tr><td colSpan={7} className="legacy-empty-row">Loading products…</td></tr> : results.length ? results.map(product => <tr key={product.id}
                className={product.campaign === "SUBDEALER" ? "ptg-search-subdealer" : product.campaign ? "ptg-search-promo" : undefined} onClick={event => {
                if (!(event.target as HTMLElement).closest("input,button,select")) setActiveProduct(product);
              }}>
                <td><input type="checkbox" aria-label={["Select", product.brand, product.model, memoInfo(product)?.memo_id].filter(Boolean).join(" ")} checked={queue.some(item => item.id === product.id)} onChange={event => toggleProduct(product, event.target.checked)} /></td>
                <td>{product.barcode}</td><td><strong>{product.brand || "—"}</strong></td><td><button className="legacy-product-detail-link" type="button" aria-haspopup="dialog"
                  aria-label={"View product details for " + (product.model || product.barcode)}
                  onClick={() => openProductDetails(product)}>{modelLabel(product)}</button><SearchOfferLabel product={product} /></td>
                <td className="ptg-srp-amount"><span className="ptg-search-offer-amount">{peso(product.srp)}</span></td>
                <td className="ptg-tag-this-amount"><span className="ptg-search-offer-amount">{peso(priceNow(product))}</span></td>
                <td><span className={"legacy-status-pill " + (displayStatus(product) === "YES" ? "eligible" : "")}>{displayStatus(product)}</span></td>
              </tr>) : <tr><td colSpan={7} className="legacy-empty-row">No products found.</td></tr>}
              <BlankRows used={Math.max(1, results.length)} columns={7} />
            </tbody>
          </table>
        </div>
        <p className="legacy-result-count" role="status">{loading ? "Loading products…" : `Search Results ${firstResult}–${lastResult} of ${total}`}</p>
        <Pagination page={page} totalPages={totalPages} label="Product results" busy={loading} onPage={next => void loadProducts(searchQuery, next, inStock, memoFilter, campaign, showSubdealer)} />
      </section>

      <section className="legacy-queue-panel ptg-print-hide">
        <h2>Selected Products / Print Queue</h2>
        <div className="ptg-batch-toolbar">
          <label><input type="checkbox" checked={batchPlannerEnabled} onChange={event => {
            setBatchPlannerEnabled(event.target.checked);
            if (event.target.checked) { setBatchDefaultFormat(format); setPrintPreferences({}); }
          }} /> Plan print formats and copies per product</label>
          {batchPlannerEnabled && <div className="ptg-batch-groups" aria-label="Print queue grouped by format">
            <label>Default print format <select value={batchDefaultFormat} onChange={event => {
              const next = event.target.value as FormatKey;
              setBatchDefaultFormat(next);
              setFormat(next);
            }}>{formats.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
            {plannedGroups.map(group => <button key={group.format} type="button"
              className={format === group.format ? "active" : ""}
              onClick={() => setPrintFormat(group.format)}>
              {formats.find(option => option.key === group.format)?.label || group.format}: {group.products} product(s) / {group.copies} tag(s)
            </button>)}
            <span role="status">Choose each group, review its preview, then print. Groups are separate print jobs.</span>
          </div>}
        </div>
        {queue.length > 0 && (() => {
          const details = summarizePrintQueue(queue);
          return <div className="ptg-queue-overview" aria-label="Queue by brand">
            <strong>Queued by brand</strong>
            <div className="ptg-queue-brand-chips">{details.brands.map(item => <span key={item.brand}>{item.brand}: {item.count}</span>)}</div>
            {details.sharedBarcodes.length > 0 && <p className="ptg-queue-duplicate-note">
              {details.sharedBarcodes.length} barcode(s) appear in multiple queued offers. This may be intentional for free-installation and unit-only prices; check each model before printing.
            </p>}
          </div>;
        })()}
        {(() => {
          const today = philippineToday();
          const needingReview = queue.filter(item => checkProductPrice(item, today).some(issue => issue.level === "warning")).length;
          return needingReview ? <p className="ptg-price-queue-note" role="status">
            {needingReview} selected product(s) have price warnings. Open the model details to review before printing; printing is not blocked.
          </p> : null;
        })()}
        <div className="legacy-table-frame">
          <table className="legacy-products-table">
            <thead><tr>
              <th><input type="checkbox" aria-label="Select all queued products" checked={queue.length > 0} onChange={event => { if (!event.target.checked) { setQueue([]); setQueuePage(1); setActiveProduct(null); } }} /></th>
              <th>Barcode</th><th>Brand</th><th>Model</th><th>Remarks</th><th>SRP</th><th>TAG THIS</th><th>Status</th>{batchPlannerEnabled && <><th>Format</th><th>Copies</th></>}
            </tr></thead>
            <tbody>
              {queueRows.length ? queueRows.map(product => <tr key={product.id} onClick={event => {
                if (!(event.target as HTMLElement).closest("input,button,select")) setActiveProduct(product);
              }}>
                <td><input type="checkbox" checked aria-label={"Remove " + product.model + " from print queue"} onChange={event => toggleProduct(product, event.target.checked)} /></td>
                <td>{product.barcode}</td><td><strong>{product.brand || "—"}</strong></td><td><button className="legacy-product-detail-link" type="button" aria-haspopup="dialog"
                  aria-label={"View product details for " + (product.model || product.barcode)}
                  onClick={() => openProductDetails(product)}>{modelLabel(product)}</button><MemoSummary product={product} /></td><td>{product.remarks || "N/A"}</td><td className="ptg-srp-amount">{peso(product.srp)}</td><td className="ptg-tag-this-amount">{peso(priceNow(product))}</td><td><span className={"legacy-status-pill " + (displayStatus(product) === "YES" ? "eligible" : "")}>{displayStatus(product)}</span></td>
                 {batchPlannerEnabled && <>
                   <td><select aria-label={"Print format for " + (product.model || product.barcode)}
                     value={printPreferences[product.id]?.format || batchDefaultFormat}
                     onChange={event => setPrintPreferences(previous => ({
                       ...previous, [product.id]: { format: event.target.value as FormatKey, copies: previous[product.id]?.copies || 1 },
                     }))}>{formats.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></td>
                   <td><input type="number" min="1" max="20" step="1"
                     aria-label={"Print copies for " + (product.model || product.barcode)}
                     value={printPreferences[product.id]?.copies || 1}
                     onChange={event => {
                       const copies = Number(event.target.value);
                       setPrintPreferences(previous => ({
                         ...previous, [product.id]: { format: previous[product.id]?.format || batchDefaultFormat,
                           copies: Number.isInteger(copies) && copies >= 1 && copies <= 20 ? copies : 1 },
                       }));
                     }} /></td>
                 </>}
              </tr>) : <tr><td colSpan={batchPlannerEnabled ? 10 : 8} className="legacy-queue-empty">No products selected for printing.</td></tr>}
              <BlankRows used={Math.max(1, queueRows.length)} columns={batchPlannerEnabled ? 10 : 8} />
            </tbody>
          </table>
        </div>
        <Pagination page={visibleQueuePage} totalPages={queueTotalPages} label="Print queue" onPage={setQueuePage} />
        <div className="legacy-queue-footer"><strong>Selected: {queue.length} product(s)</strong><button type="button" onClick={() => { setQueue([]); setQueuePage(1); setActiveProduct(null); }}>▤ CLEAR ALL</button></div>
      </section>

      <section id="print-price-tags" className="legacy-preview-panel">
        <div className="legacy-preview-heading">
          <h2>Print Price Tags</h2>
            <div className="legacy-format-controls preview-format-controls"><strong>PRINT FORMAT</strong><div>{formats.map(option => <button key={option.key} type="button" className={format === option.key ? "active" : ""} onClick={() => setPrintFormat(option.key)}>{option.label}</button>)}</div></div>
        </div>
        {logoMessage && <p className="legacy-status-message ptg-print-hide" role="status">{logoMessage}</p>}
        {!printable && <div className="legacy-format-notice" role="alert">
          Aircon requires a capacity of 1.0, 1.5, 2.0, 2.5, or 3.0 HP in the product description or model.
          Check or remove: {invalidAircon.map(product => product.model || product.barcode).join(", ")}.
        </div>}
        {printable && queue.length === 0 && <div className="legacy-preview-empty ptg-print-hide">Select products above to print price tags.</div>}
        {queue.length > 0 && <section className="ptg-print-preflight ptg-print-hide" aria-label="Print preflight summary">
          <strong>Print preflight — {printReview.items} product(s), {printReview.pages} estimated page(s)</strong>
          {printReview.problems.length ? <>
            <p>{printReview.problems.length} item check(s) need review. These are advisory checks, not a measured text-fit test. Review the actual print preview before printing.</p>
            <ul>{printReview.problems.slice(0, 6).map((issue, index) => <li key={issue.code + ":" + index}>
              <b>{issue.label}:</b> {issue.detail}
            </li>)}</ul>
            {printReview.problems.length > 6 && <p>Plus {printReview.problems.length - 6} more checks. Review each queued product in its details modal.</p>}
          </> : <p>No missing-price or obvious description-length warnings found. Check the browser print preview before printing.</p>}
        </section>}
        <div className="legacy-output-buttons ptg-print-hide">
          {!demo && <button type="button" className="refresh-logos" disabled={refreshingLogos} onClick={() => void refreshArtwork()}>{refreshingLogos ? "Refreshing…" : "↻ Refresh Logos"}</button>}
          <button type="button" className="save-pdf" disabled={!queue.length || !printable} onClick={printTags}>▣ SAVE</button>
          <button type="button" className="print-tags" disabled={!queue.length || !printable} onClick={printTags}>▣ Print</button>
        </div>
      </section>
      </div>

        {printable && queue.length > 0 && <div className="ptg-print-preview">
          {format === "AIRCON" ? airconPages.map(({ brand, rows, key }) => <div className="legacy-print-sheet legacy-aircon-sheet" key={key}>
            <article className="ptg-aircon">
              <header className="ptg-aircon-header">
                {logos.header && <img src={artworkUrl("header")} alt="Price tag header artwork" />}
                {airconBrandArtwork(brand)
                  ? <img className="ptg-aircon-brand-logo" src={airconBrandArtwork(brand)} alt={brand} />
                  : <strong>{brand || "AIRCON"}</strong>}
              </header>
              <table className="ptg-aircon-products">
                <thead><tr><th>BC#</th><th>CAPACITY</th><th className="ptg-aircon-area-heading">RECOMMENDED<br />FLOOR AREA</th><th>MODEL</th><th>SRP</th><th>NOW PAY ONLY</th><th>SAVE</th></tr></thead>
                <tbody>{rows.map((product, index) => <tr key={airconSizes[index].hp}>
                  <td>{product?.barcode}</td><td>{airconSizes[index].hp.toFixed(1)} HP</td><td>{airconSizes[index].area}</td>
                  <td>{product && (product.description?.trim() || product.model)}</td>
                  <td>{product && peso(product.srp)}</td><td>{product && peso(priceNow(product))}</td>
                  <td>{product && peso(amount(product.srp) - priceNow(product))}</td>
                </tr>)}</tbody>
              </table>
              <div className="ptg-aircon-lower">
                <table><thead><tr><th>CREDIT CARD</th><th>12 MONTHS</th></tr></thead>
                  <tbody>{rows.map((product, index) => <tr key={airconSizes[index].hp}>
                    <td>{product && airconSizes[index].hp.toFixed(1) + " HP"}</td>
                    <td>{product && (amount(product.months_12) ? peso(amount(product.months_12) / 12) : "—")}</td>
                  </tr>)}</tbody>
                </table>
                <div className="ptg-aircon-footer">
                  {rows.filter(product => product !== null).every(product =>
                    /free.*(?:10\s*(?:ft|feet)).*installation|free.*installation.*10\s*(?:ft|feet)/i.test(product.remarks ?? "") &&
                    !/unit\s+only/i.test(product.remarks ?? ""),
                  ) && <strong>FREE INSTALLATION 1ST 10 FEET</strong>}
                  {logos.social && <img src={artworkUrl("social")} alt="Price tag footer artwork" />}
                </div>
              </div>
            </article>
          </div>) : sheets.map((sheet, sheetIndex) => <div className={"legacy-print-sheet" + (format === "TWO" ? " legacy-half-sheet" : format === "FOUR" ? " legacy-four-sheet" : compact ? " legacy-six-sheet" : "")} key={format + ":" + sheetIndex}>
          {sheet.map((product, copyIndex) => {
            const modelDescription = product.description?.trim() || product.model;
            const memo = memoInfo(product);
            const pay = priceNow(product);
            const savings = amount(product.srp) - pay;
            const hasCashPayment = product.has_cash_payment ?? (amount(product.cash_payment) !== 0);
            const term = !hasCashPayment
              ? Number(/\b(6|9|12|18|24)-MONTH CREDIT CARD ONLY\b/i.exec(product.remarks || "")?.[1] || 0) : 0;
            const termTotal = term ? amount(product["months_" + term as "months_6"]) : 0;
            const priceCaption = termTotal ? `CREDIT CARD · ${term} MONTHS` : "CASH / STRAIGHT";
            if (compact) return <article className="ptg-compact-tag" key={product.id + ":" + copyIndex}>
              <header className="ptg-compact-header">
                {logos.header && <img src={artworkUrl("header")} className="ptg-compact-main-logo" alt="Price tag header artwork" />}
                {logos.promo && <img src={artworkUrl("promo")} className="ptg-compact-promo-logo" alt="Promo artwork" />}
              </header>
              <div className="ptg-compact-barcode">Barcode: <strong>{product.barcode}</strong></div>
              <div>Brand: <strong>{product.brand}</strong></div>
              <div className="ptg-compact-model">MODEL: <strong>{modelDescription}</strong></div>
              {!srpOnly && <div>SRP: <strong className={format === "SIX" && amount(product.srp) > 0 && pay > 0 && amount(product.srp) > pay ? "ptg-compact-srp-discounted" : undefined}>{peso(product.srp)}</strong></div>}
              {!srpOnly && <div className="ptg-compact-cash">{priceCaption}</div>}
              <div className="ptg-compact-pay">{termTotal && !srpOnly ? "PER MONTH:" : "PAY NOW:"} <strong>{peso(srpOnly ? product.srp : termTotal ? termTotal / term : pay)}</strong></div>
              {!srpOnly && <div className="ptg-compact-summary">
                <span>{endDate(memo?.period || "") ? "Valid Until: " + endDate(memo?.period || "") : ""}</span>
                <strong>SAVE: {peso(savings)}</strong>
              </div>}
              {logos.social && <div className="ptg-compact-footer"><img src={artworkUrl("social")} alt="Price tag footer artwork" /></div>}
            </article>;
            return <article className="legacy-price-tag" key={product.id + ":" + copyIndex}>
                {(logos.header || logos.promo) && <div className={"legacy-tag-header" + (logos.promo ? " legacy-tag-header-with-promo" : "")}>
                  {logos.header && <img src={artworkUrl("header")} alt="Price tag header artwork" />}
                  {logos.promo && <img className="legacy-tag-promo" src={artworkUrl("promo")} alt="Promo artwork" />}
                </div>}
                <div className="legacy-barcode-label">Barcode:</div><div className="legacy-barcode">{product.barcode}</div>
                <div className="legacy-brand-label">Brand:</div><div className="legacy-brand-value">{product.brand}</div>
                <div className="legacy-model-label">MODEL:</div><div className="legacy-model-value" style={{ fontSize: modelDescription.length > 90 ? 24 : modelDescription.length > 55 ? 30 : 38 }}>{modelDescription}</div>
                <div className="legacy-srp-label">SRP:</div><div className="legacy-srp">{peso(product.srp)}</div>
                <div className="legacy-cash">{priceCaption}</div>
                <div className="legacy-pay-label">{termTotal ? "TOTAL:" : "PAY NOW:"}</div><div className="legacy-pay-value">{peso(termTotal || pay)}</div>
                <div className="legacy-valid-until">{endDate(memo?.period || "") ? "Valid Until: " + endDate(memo?.period || "") : ""}</div>
                <div className="legacy-save-label">SAVE:</div><div className="legacy-save-value">{savings < 0 ? "−" : ""}{peso(Math.abs(savings))}</div>
                <div className="legacy-installment-logo"><span>FOR INSTALLMENT: CREDIT CARD</span></div>
                <div className="legacy-installments">
                  {[6, 9, 12, 18, 24].map(months => {
                    const installmentTotal = amount(product["months_" + months as "months_6"]);
                    return <div className="legacy-installment-row" key={months}><span>{months} months:</span><strong>{installmentTotal ? peso(installmentTotal / months) + " / month" : "—"}</strong></div>;
                  })}
                </div>
                {logos.social && <div className="legacy-tag-footer"><img src={artworkUrl("social")} alt="Price tag footer artwork" /></div>}
              </article>;
          })}
          {Array.from({ length: tagsPerSheet - sheet.length }, (_, index) =>
            <div className="legacy-empty-print-slot" key={"empty-" + index} aria-hidden="true" />
          )}
          </div>)}
        </div>}
      {detailProduct && <AppDialog title={showSerials ? "Available serial numbers" : "Product details"} closeIcon busy={false} onClose={() => setDetailProduct(null)} pinned
        pinnedContent={!showSerials && inventoryEnabled ? <p className="legacy-product-stock">
          <strong>Inventory quantity</strong>{" "}
          {stock ? <>{stock.serialized ? <button type="button" className="legacy-product-detail-link" aria-label={stock.quantity + " units. Show available serial numbers"}
            onClick={() => { setSerials(null); setSerialMessage(""); setShowSerials(true); }}>{stock.quantity}</button> : stock.quantity} · {stock.scope}</>
            : <span role="status">{stockMessage || "Loading…"}</span>}
        </p> : null}>
        {showSerials ? <>
          <p><button type="button" className="legacy-product-detail-link" onClick={() => setShowSerials(false)}>← Product details</button></p>
          <p>{detailProduct.barcode} · {stock?.scope}</p>
          {serialMessage ? <p role="alert">{serialMessage}</p> : serials === null ? <p role="status">Loading serial numbers…</p>
            : serials.length ? <table className="legacy-product-installment-table">
              <thead><tr><th>Serial number</th><th>Branch</th><th>Received</th></tr></thead>
              <tbody>{serials.map(item => <tr key={item.branch + ":" + item.serial}><td>{item.serial}</td><td>{item.branch}</td><td>{item.receivedOn || "—"}</td></tr>)}</tbody>
            </table> : <p>No serial numbers currently available.</p>}
        </> : <>
        {salesInsightsEnabled && <section className="ptg-product-insights ptg-print-hide" aria-label="Sales Tracker product insights">
          <strong>Sales Tracker · Product insights</strong>
          {insightsLoading ? <p role="status">Loading aggregated branch activity…</p>
            : insights ? <>
              <p><b>{insights.scope}</b> · {insights.recent.from} to {insights.recent.to}</p>
              <div className="ptg-product-insights-grid">
                <span><small>Stock units</small><strong>{insights.quantity.toLocaleString("en-PH")}</strong></span>
                <span><small>Sold units (30 days)</small><strong>{insights.recent.units.toLocaleString("en-PH")}</strong></span>
                <span><small>Recorded transactions (30 days)</small><strong>{insights.recent.transactions.toLocaleString("en-PH")}</strong></span>
                <span><small>Last recorded sale</small><strong>{insights.recent.lastSaleDate || "No sales in period"}</strong></span>
              </div>
              <p>Read-only aggregated totals. No customer or Product Specialist identities are shared. Historical sales may not reflect later returns.</p>
            </> : <p role="status">{insightsMessage || "Aggregated activity is unavailable."} PTG prices and printing are unaffected.</p>}
        </section>}
        {(() => {
          const visible = visibleOffersForBarcode(detailProduct, [...results, ...comparableOffers], queue, {
            includeSubdealer: canSeeCashPrice && showSubdealer,
          });
          const warnings = [
            ...checkProductPrice(detailProduct, philippineToday()),
            ...reviewInstallments(detailProduct),
            ...reviewOfferConflicts(detailProduct, visible),
          ];
          return warnings.length ? <section className="ptg-price-checks" aria-label="Price review warnings">
            <strong>Price checks — review only</strong>
            <ul>{warnings.map(issue => <li className={issue.level === "warning" ? "warn" : "info"} key={issue.code}>{issue.text}</li>)}</ul>
          </section> : null;
        })()}
        {usesEdgeData && <p className="ptg-compare-status" role="status">
          {comparisonLoading ? "Checking currently searchable offers for the same barcode…" :
            comparisonMessage ? "Additional offer check unavailable: " + comparisonMessage + ". Visible offers are shown only." :
            comparisonPartial ? "Only the first 50 searchable offer rows were checked; results may be incomplete." :
            "Currently searchable same-barcode offers checked. Older replaced memo prices are not included."}
        </p>}
        <dl className="legacy-product-details">
          <dt>Brand</dt><dd>{detailProduct.brand || "—"}</dd>
          <dt>Full description</dt><dd>{detailProduct.description || detailProduct.model || "—"}</dd>
          <dt>Barcode</dt><dd>{detailProduct.barcode}</dd>
          {detailProduct.category && <><dt>Category</dt><dd>{detailProduct.category}</dd></>}
          {detailProduct.sub_category && <><dt>Subcategory</dt><dd>{detailProduct.sub_category}</dd></>}
          <dt>Remarks</dt><dd>{detailProduct.remarks || "N/A"}</dd>
          <dt>Offer selected for printing</dt><dd>
            {queue.some(item => item.id === detailProduct.id) ? <strong>Queued — {format === "SMALL_APPS" || format === "CARAVAN" ? "SRP only" : detailProduct.campaign || "Regular / memo"} · {peso(format === "SMALL_APPS" || format === "CARAVAN" ? detailProduct.srp : detailProduct.tag_this)}</strong>
              : "Not queued. Select this exact offer in the search results to print it."}
          </dd>
          {!detailUnitOnly && <>
            <dt>SRP</dt><dd className="ptg-srp-amount">{peso(detailProduct.srp)}</dd>
            <dt>Tag This</dt><dd className="ptg-tag-this-amount">{peso(priceNow(detailProduct))}</dd>
            {canSeeCashPrice && amount(detailProduct.cash_payment) > 0 && amount(detailProduct.cash_payment) !== priceNow(detailProduct) &&
              <><dt>Cash price</dt><dd>{peso(detailProduct.cash_payment)}</dd></>}
          </>}
          <dt>Status</dt><dd>{displayStatus(detailProduct)}</dd>
          {detailMemo && <>
            <dt>Memo ID</dt><dd>{memoLabel(detailMemo, detailProduct) || "—"}</dd>
            <dt>Period</dt><dd>{detailMemo.period || "—"}</dd>
            <dt>Import date</dt><dd>{detailMemo.created_at ? new Date(detailMemo.created_at).toLocaleDateString("en-US") : "—"}</dd>
          </>}
          {detailProduct.campaign === "7MBDS" && detailProduct.selling_starts_on && detailProduct.selling_ends_on && <>
            <dt>Selling period</dt>
            <dd>{offerDate(detailProduct.selling_starts_on)}–{offerDate(detailProduct.selling_ends_on)}
              {detailProduct.early_print_only && <> · Early printing only</>}
            </dd>
          </>}
        </dl>
        {(() => {
          const memos = memoEntriesForOffer(detailProduct);
          return memos.length > 1 ? <section className="ptg-memo-references" aria-label="Loaded memo references">
            <h3>Memo references on this offer</h3>
            <p>These are references returned with the selected record, not a complete import or replacement history.</p>
            <ul>{memos.map((memo, index) => <li key={(memo.memo_id || "memo") + ":" + index}>
              <strong>{memoLabel(memo, detailProduct) || "Unnumbered memo"}</strong>
              {memo.period ? " · " + memo.period : ""}
              {memo.created_at ? " · Imported " + new Date(memo.created_at).toLocaleDateString("en-PH") : ""}
            </li>)}</ul>
          </section> : null;
        })()}
        {(() => {
          const offers = visibleOffersForBarcode(detailProduct, [...results, ...comparableOffers], queue, {
            includeSubdealer: canSeeCashPrice && showSubdealer,
          });
          return offers.length > 1 ? <section className="ptg-visible-offers" aria-label="Visible price options">
            <h3>Price options for this barcode</h3>
            <p>Only offers loaded on this search page or already in the print queue are shown. Other regular or promotional prices may exist. Reviewing an option does not change the print queue.</p>
            <div className="ptg-visible-offer-scroll">
              <table>
                <thead><tr><th>Offer</th><th>Tag This</th><th>SRP</th><th>Period</th><th>Action</th></tr></thead>
                <tbody>{offers.map(offer => <tr key={offer.id}>
                  <td>{offer.id === detailProduct.id ? <strong>Viewing · {offer.campaign || "Regular / SRP"}</strong> : offer.campaign || "Regular / SRP"}
                    {queue.some(item => item.id === offer.id) ? <small className="ptg-offer-queued">Queued for print</small> : null}</td>
                  <td>{peso(offer.tag_this)}</td><td>{peso(offer.srp)}</td>
                  <td>{memoInfo(offer)?.period || (offer.selling_starts_on && offer.selling_ends_on
                    ? offer.selling_starts_on + " to " + offer.selling_ends_on : "—")}</td>
                  <td>{offer.id === detailProduct.id ? "—"
                    : [...results, ...queue].some(item => item.id === offer.id)
                      ? <button type="button" className="legacy-product-detail-link"
                        onClick={() => openProductDetails([...results, ...queue].find(item => item.id === offer.id)!)}>Review</button>
                      : "Compare only — search to select"}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </section> : null;
        })()}
        {detailUnitOnly && <>
          <table className="legacy-product-installment-table legacy-price-comparison-table">
            <caption>Price options — selected memo</caption>
            <thead><tr><th scope="col">Price</th><th scope="col">Free installation</th><th scope="col">Unit only</th></tr></thead>
            <tbody>
              <tr><th scope="row">SRP</th><td className="ptg-srp-amount">{peso(detailProduct.srp)}</td><td className="ptg-srp-amount">{peso(detailUnitOnly.srp)}</td></tr>
              <tr><th scope="row">Tag This</th><td className="ptg-tag-this-amount">{peso(priceNow(detailProduct))}</td><td className="ptg-tag-this-amount">{peso(priceNow(detailUnitOnly))}</td></tr>
              {canSeeCashPrice && (amount(detailProduct.cash_payment) > 0 || amount(detailUnitOnly.cash_payment) > 0) &&
                <tr><th scope="row">Cash price</th><td>{amount(detailProduct.cash_payment) > 0 ? peso(detailProduct.cash_payment) : "—"}</td><td>{amount(detailUnitOnly.cash_payment) > 0 ? peso(detailUnitOnly.cash_payment) : "—"}</td></tr>}
            </tbody>
          </table>
          <button type="button" className="legacy-unit-only-queue-button" disabled={queue.some(item => item.id === detailUnitOnly.id)}
            onClick={() => toggleProduct(detailUnitOnly, true)}>
            {queue.some(item => item.id === detailUnitOnly.id) ? "Unit-only offer added to print queue" : "Add unit-only offer to print queue"}
          </button>
        </>}
        <InstallmentOfferTable product={detailProduct} caption={detailUnitOnly ? "Installment offer — Free installation" : "Installment prices"} />
        {detailUnitOnly && <InstallmentOfferTable product={detailUnitOnly} caption="Installment offer — Unit only" />}
        </>}
      </AppDialog>}
      <style jsx global>{`
        .app-dialog.app-dialog-pinned[open]{display:flex;flex-direction:column;overflow:hidden}
        .app-dialog-pinned > header{flex:none}
        .app-dialog-pinned-content{flex-basis:100%;min-width:0}
        .app-dialog-pinned-content .legacy-product-stock{margin:.25rem 0 0}
        .app-dialog-scroll{min-height:0;overflow-y:auto;overscroll-behavior:contain}
        .legacy-stock-filter{display:flex;align-items:center;gap:.4rem;color:#12366c;font-size:.85rem}
        .legacy-search-filters{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem 1rem}
        .legacy-search-filters .legacy-stock-filter{white-space:nowrap}
        .ptg-subdealer-filter{color:#653d8e;font-weight:700}
        .ptg-search-subdealer{background:#faf6ff!important}
        .ptg-search-subdealer .ptg-tag-this-amount{color:#653d8e!important}
        .legacy-product-stock{padding:.65rem .85rem;background:#eef5ff;border-radius:7px}
        .legacy-product-detail-link{border:0;background:transparent;color:inherit;font:inherit;padding:0;text-align:left;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
        .legacy-product-detail-link:focus-visible{outline:2px solid #1d5bb6;outline-offset:3px}
        .legacy-product-details{display:grid;grid-template-columns:minmax(5.5rem,auto) minmax(0,1fr);gap:.65rem 1rem;margin:1rem 0 0;font-size:.9rem}
        .legacy-product-details dt{font-weight:700}
        .legacy-products-table td.ptg-srp-amount,.legacy-product-details .ptg-srp-amount{color:#b42318}
        .legacy-results-panel .ptg-search-promo .ptg-search-offer-amount{color:#DC2626;font-weight:700}
        .legacy-results-panel .ptg-search-offer-amount{white-space:nowrap}
        .legacy-products-table td.ptg-tag-this-amount,.legacy-product-details .ptg-tag-this-amount{color:#12366c;font-weight:800}
        .legacy-product-details dd{margin:0;overflow-wrap:anywhere;white-space:pre-line}
        .legacy-product-installment-table{width:100%;margin-top:1rem;border-collapse:collapse;font-size:.85rem;text-align:left}
        .legacy-product-installment-table caption{text-align:left;font-size:.9rem;font-weight:700;margin-bottom:.4rem}
        .legacy-product-installment-table th,.legacy-product-installment-table td{padding:.45rem;border-bottom:1px solid #dbe3ed}
        .legacy-product-installment-table thead{background:#f0f5fb}
        .legacy-price-comparison-table th,.legacy-price-comparison-table td{width:33.333%;white-space:normal}
        .legacy-price-comparison-table td.ptg-srp-amount{color:#b42318}
        .legacy-price-comparison-table td.ptg-tag-this-amount{color:#12366c;font-weight:800}
        .ptg-visible-offers,.ptg-memo-references{margin:12px 0;padding:10px 12px;border:1px solid #d9e3ef;border-radius:8px;background:#f8fbff;color:#274263;font-size:12px}
        .ptg-visible-offers h3,.ptg-memo-references h3{margin:0 0 5px;font-size:13px}
        .ptg-visible-offers p,.ptg-memo-references p{margin:0 0 9px;color:#526987;line-height:1.45}
        .ptg-memo-references ul{margin:0;padding-left:18px}
        .ptg-memo-references li{margin:4px 0}
        .ptg-visible-offer-scroll{max-width:100%;overflow-x:auto}
        .ptg-visible-offers table{width:100%;border-collapse:collapse;min-width:500px}
        .ptg-visible-offers :is(th,td){padding:7px 6px;text-align:left;border-bottom:1px solid #dce5ef}
        .ptg-visible-offers th{font-weight:700}
        .ptg-visible-offers td{overflow-wrap:anywhere}
        .ptg-compare-status{font-size:11px;color:#526c86;line-height:1.45;margin:8px 0}
        .ptg-offer-queued{display:block;color:#176042;font-size:10px;font-weight:700;margin-top:3px}
        .ptg-print-preflight{margin:10px 0;padding:10px 12px;border:1px solid #d7e4f0;border-radius:7px;background:#f4f8fc;color:#244769;font-size:12px;line-height:1.45}
        .ptg-print-preflight strong{font-size:13px}
        .ptg-print-preflight p{margin:6px 0}
        .ptg-print-preflight ul{margin:7px 0;padding-left:19px}
        .ptg-print-preflight li{margin:4px 0}
        .ptg-product-insights{margin:10px 0 14px;padding:12px;border:1px solid #cee0f3;border-radius:8px;background:#f4f9ff;color:#25486b;font-size:12px;line-height:1.5}
        .ptg-product-insights>strong{font-size:13px}
        .ptg-product-insights>p{margin:7px 0}
        .ptg-product-insights-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
        .ptg-product-insights-grid span{display:grid;gap:2px;min-width:0}
        .ptg-product-insights-grid small{font-size:11px;color:#66788f}
        .ptg-product-insights-grid strong{font-size:14px;color:#143b67}
        .ptg-bulk-brand{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin:4px 0 10px;font-size:12px}
        .ptg-bulk-brand label{font-weight:700}
        .ptg-bulk-brand select{min-width:125px;min-height:34px;padding:5px 8px;border:1px solid #c9d8ea;border-radius:5px;background:#fff;font-size:12px}
        .ptg-bulk-brand button{min-height:34px;padding:5px 10px;border:1px solid #225a9d;border-radius:5px;background:#eef5ff;color:#184c87;font-size:12px;font-weight:700;cursor:pointer}
        .ptg-bulk-brand button:disabled{opacity:.5;cursor:default}
        .ptg-batch-toolbar{display:grid;gap:8px;margin:8px 0 12px;padding:9px;border:1px solid #d6e3f3;border-radius:6px;background:#f8fbff;color:#164270;font-size:12px}
        .ptg-batch-toolbar>label{display:flex;align-items:center;gap:8px;font-weight:700}
        .ptg-batch-groups{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
        .ptg-batch-groups label{display:flex;align-items:center;gap:6px}
        .ptg-batch-groups button,.ptg-batch-groups select{min-height:32px;padding:4px 8px;border:1px solid #bdd2ea;border-radius:5px;background:white;color:#184a83;font:inherit;cursor:pointer}
        .ptg-batch-groups button.active{background:#164c94;color:white}
        .ptg-batch-groups [role=status]{flex-basis:100%;font-size:11px}
        .legacy-queue-panel .legacy-products-table select{max-width:125px;padding:5px;border:1px solid #bdd2ea;border-radius:4px;background:white;color:#173e73}
        .legacy-queue-panel .legacy-products-table input[type=number]{width:60px;padding:5px;border:1px solid #bdd2ea;border-radius:4px;background:white;color:#173e73}
        .ptg-queue-overview{display:grid;gap:6px;margin:8px 0 10px;color:#25486b;font-size:12px}
        .ptg-queue-brand-chips{display:flex;flex-wrap:wrap;gap:5px}
        .ptg-queue-brand-chips span{padding:4px 7px;border:1px solid #d6e2ef;border-radius:99px;background:#f2f7fc;color:#244969;font-size:11px}
        .ptg-queue-duplicate-note{margin:0;padding:8px 10px;border-radius:6px;background:#fff7e9;color:#795319;line-height:1.5}
        .ptg-price-queue-note{margin:0 0 10px;padding:10px 12px;border:1px solid #ead6a9;border-radius:6px;background:#fffaf0;color:#755215;font-size:12px;line-height:1.4}
        .ptg-price-checks{margin:10px 0 14px;padding:12px;border:1px solid #ead6a9;border-radius:8px;background:#fffaf0;color:#604815;font-size:12px}
        .ptg-price-checks>strong{display:block;margin:0 0 8px}
        .ptg-price-checks ul{margin:0;padding-left:20px}
        .ptg-price-checks li{margin:4px 0;line-height:1.5}
        .ptg-price-checks li.info{color:#365b80}
        .legacy-unit-only-queue-button{border:1px solid #2465c3;border-radius:5px;background:#eef5ff;color:#124a9c;padding:7px 12px;font-weight:700;cursor:pointer}
        .legacy-unit-only-queue-button:disabled{opacity:.65;cursor:default}
        .legacy-products-banner-pin{position:sticky;top:0;z-index:4;padding-bottom:9px;background:#f3f6fa}
        .legacy-products-banner{display:block;width:100%;height:auto;margin:0;border-radius:5px}
        @media(max-width:720px){.legacy-products-banner-pin{top:var(--ptg-mobile-sidebar-height,70px)}}
        .legacy-ptg-main{width:min(1500px,calc(100% - 20px));margin:0 auto;padding:8px 0 18px!important;color:#123b72;font-family:Arial,Helvetica,sans-serif}
        .legacy-branch-tools,.legacy-search-card,.legacy-results-panel,.legacy-queue-panel,.legacy-preview-panel{border:1px solid #dbe3ed;border-radius:6px;background:#fff}
        .legacy-branch-tools{margin-bottom:9px;padding:8px 10px}
        .legacy-tools-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;color:#123b72;font-size:10px}
        .legacy-tools-account{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:4px 12px}
        .legacy-tools-account .secondary-button{height:26px;min-height:26px;margin:0;line-height:1}
        .legacy-tools-heading small{color:#71839a;font-size:9px}
        .legacy-branch-tools nav{display:flex;gap:6px;flex-wrap:wrap}
        .legacy-branch-tools a,.legacy-branch-tools button{display:inline-flex;align-items:center;min-height:24px;padding:0 9px;border:1px solid #2465c3;border-radius:4px;background:#fff;color:#124a9c;font-size:9px;font-weight:700;text-decoration:none}
        .legacy-branch-tools button:disabled{border-color:#d5dae2;color:#999;background:#f6f7f9}
        .legacy-search-workflow{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(0,1fr);grid-template-areas:"search print" "results results" "queue queue";gap:10px}
        .legacy-search-card{grid-area:search}
        .legacy-results-panel{grid-area:results}
        .legacy-queue-panel{grid-area:queue}
        .legacy-preview-panel{grid-area:print}
        .legacy-search-card{padding:8px}
        .legacy-search-card h2,.legacy-queue-panel h2,.legacy-preview-heading h2{margin:0 0 6px;color:#0647a7;font-size:14px;font-weight:800}
        .legacy-search-fields{display:grid;grid-template-columns:minmax(0,1fr);gap:7px}
        .legacy-search-form>label,.legacy-format-controls>strong{display:block;margin-bottom:4px;color:#1d3e67;font-size:9px;font-weight:800}
        .legacy-search-form>div{display:grid;grid-template-columns:minmax(0,1fr) 90px;gap:5px}
        .legacy-search-form input{min-width:0;height:25px;padding:0 8px;border:1px solid #d3d8e0;border-radius:4px;background:#eaf4ff;color:#123b72;font:inherit;font-size:15px;font-weight:600}
        .legacy-search-form input::placeholder{color:#607b9e;font-size:13px;font-weight:400}
        .legacy-search-form button{height:27px;border:1px solid #2465c3;border-radius:4px;background:#fff;color:#124a9c;font-size:9px;font-weight:800}
        .legacy-format-controls>div{display:flex;gap:4px;flex-wrap:wrap}
        .legacy-format-controls button{min-width:62px;height:23px;padding:0 9px;border:1px solid #2465c3;border-radius:4px;background:#fff;color:#124a9c;font-size:9px;font-weight:800;cursor:pointer}
        .legacy-format-controls button.active{background:#0647a7;color:#fff}
        .legacy-format-controls button:hover:not(.active){background:#edf4ff}
        .legacy-memo-info{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:6px;border:1px solid #dbe3ed;border-radius:4px;background:#fbfcfe}
        .legacy-memo-info label{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:6px;color:#164a8a;font-size:9px;font-weight:800}
        .legacy-memo-info label:first-child{grid-column:1/-1}
        .legacy-memo-info input{min-width:0;width:100%;height:24px;padding:0 5px;border:1px solid #d8e0eb;border-radius:3px;background:#fff;color:#3e4c5d;font:inherit;font-size:9px}
        .legacy-products-table{width:100%;border-collapse:collapse;table-layout:fixed}
        .legacy-results-panel{padding:8px}
        .legacy-status-message{min-height:0;margin:0;padding:0 2px 5px;color:#536781;font-size:9px}
        .legacy-table-frame{border:1px solid #d6d6d6;overflow-x:auto}
        .legacy-products-table{font-size:9px;table-layout:fixed;width:100%;min-width:640px}
        .legacy-products-table thead{background:#0647a7;color:#fff}
        .legacy-products-table th{height:28px;padding:4px 6px;background:#0647a7;color:#fff;text-align:left;font-size:9px;font-weight:700;white-space:nowrap}
        .legacy-products-table th:first-child,.legacy-products-table td:first-child{width:36px;text-align:center}
        .legacy-products-table th:nth-child(2){width:10%}.legacy-products-table th:nth-child(3){width:9%}.legacy-products-table th:nth-child(4){width:33%}.legacy-products-table th:nth-child(5){width:23%}.legacy-products-table th:nth-child(6),.legacy-products-table th:nth-child(7){width:8%}.legacy-products-table th:nth-child(8){width:6%}
        /* Search results omit Remarks; the print queue keeps its original columns. */
        .legacy-results-panel .legacy-search-results-table{min-width:760px}
        .legacy-results-panel .legacy-search-results-table th:nth-child(2){width:12%}
        .legacy-results-panel .legacy-search-results-table th:nth-child(3){width:11%}
        .legacy-results-panel .legacy-search-results-table th:nth-child(4){width:35%}
        .legacy-results-panel .legacy-search-results-table th:nth-child(5),
        .legacy-results-panel .legacy-search-results-table th:nth-child(6){width:17%}
        .legacy-results-panel .legacy-search-results-table th:nth-child(7){width:8%}
        .legacy-products-table td{height:38px;padding:4px 6px;border-bottom:1px solid #d6d6d6;color:#143d75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .legacy-products-table td:nth-child(4),.legacy-products-table td:nth-child(5),.legacy-products-table .legacy-product-detail-link{white-space:normal;overflow-wrap:anywhere}
        .legacy-results-panel .legacy-search-results-table :is(td:nth-child(5),td:nth-child(6)){white-space:nowrap}
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
        .legacy-queue-panel{display:flex;flex-direction:column;min-height:285px;padding:8px}
        .legacy-queue-panel h2{margin-bottom:7px}
        .legacy-queue-footer{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:auto;padding-top:7px;color:#143d75;font-size:9px}
        .legacy-queue-footer button{height:24px;padding:0 9px;border:0;border-radius:4px;background:#dedede;color:#425064;font-size:9px;font-weight:700}
        .legacy-preview-panel{display:flex;flex-direction:column;min-width:0;padding:8px}
        .legacy-preview-heading h2{margin-bottom:5px}
        .preview-format-controls{min-width:0;flex:1}
        .legacy-output-buttons{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px;margin-top:auto;padding-top:8px}
        .legacy-output-buttons button{height:24px;padding:0 8px;border:0;border-radius:4px;color:#fff;font-size:8px;font-weight:800;white-space:nowrap}
        .legacy-output-buttons .refresh-logos{background:#e4effd;color:#124a9c;border:1px solid #8eb6e9}
        .legacy-output-buttons .save-pdf,.legacy-output-buttons .print-tags{background:#0647a7}
        .legacy-output-buttons button:disabled{opacity:.48;cursor:not-allowed}
        .legacy-format-notice,.legacy-preview-empty{margin-top:8px;padding:11px;border:1px solid #dbe3ed;border-radius:4px;background:#fbfcfe;color:#546981;font-size:10px}
        .legacy-result-count{margin:6px 0 0;text-align:center;font-size:9px}
        .ptg-print-preview{display:none}
        .legacy-print-sheet{box-sizing:border-box;display:grid;place-content:center;place-items:center;width:8.5in;height:11in;margin:0 auto 16px;background:#fff;page-break-after:always;break-after:page}
        .legacy-print-sheet:last-child{page-break-after:auto;break-after:auto}
        .legacy-price-tag{box-sizing:border-box;position:relative;display:grid;grid-template-columns:20fr 51fr 26fr 46fr 70fr 60fr 74fr 101fr 21fr;grid-template-rows:17fr 19fr 19fr 19fr 19fr 19fr 19fr 33fr 33fr 33fr 19fr 12fr 19fr 23fr 21fr 19fr 19fr 19fr 19fr 19fr 22fr 19fr 19fr 19fr 19fr 19fr 7fr 19fr 19fr 19fr 19fr 19fr 19fr 19fr;width:7.8in;height:10.4in;overflow:hidden;border:1px solid #003da5;background:#fff;color:#003da5;font-family:Arial,Helvetica,sans-serif}
        .legacy-tag-header{grid-column:1/10;grid-row:1/6}
        .legacy-tag-header,.legacy-tag-footer{position:relative;min-width:0;min-height:0;margin:4px;overflow:hidden}
        .legacy-tag-header img,.legacy-tag-footer img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain;mix-blend-mode:multiply}
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
        .legacy-installment-logo{position:relative;grid-column:1/10;grid-row:20/22;display:flex;align-items:flex-start;justify-content:center;overflow:hidden;width:100%;height:100%}
        .legacy-installment-logo:before{content:"";position:absolute;top:10px;left:2%;right:2%;height:3px;background:#003da5}
        .legacy-installment-logo span{position:relative;z-index:1;padding:3px 16px 4px;border-radius:0 0 5px 5px;background:#003da5;color:white;font-size:18px;font-weight:bold}
        .legacy-installments{grid-column:2/9;grid-row:22/28;display:grid;grid-template-rows:repeat(5,minmax(0,1fr));align-items:center;padding:4px 3% 6px}
        .legacy-installment-row{display:grid;grid-template-columns:150px 1fr;align-items:center;gap:12px;color:#003da5;font-size:20px;font-weight:bold;white-space:nowrap}
        .legacy-installment-row span{text-align:right}
        .legacy-installment-row strong{font-weight:bold}
        .legacy-tag-header-with-promo img{width:78%;object-position:left center}
        .legacy-tag-header-with-promo img.legacy-tag-promo{inset:0 0 0 auto;width:20%;object-position:right center}
        .legacy-tag-footer{grid-column:1/10;grid-row:28/34}
        @media(max-width:1050px){.legacy-search-workflow{grid-template-columns:minmax(0,1fr);grid-template-areas:"search" "results" "queue" "print"}}
        /* Display-only: let the available PTG pane width drive the layout, not
           the outer Branchline Workspace window (which has its own sidebar). */
        @media screen {
          .legacy-ptg-main{container-type:inline-size;font-size:14px;line-height:1.4;text-rendering:optimizeLegibility}
          .legacy-search-card,.legacy-results-panel,.legacy-queue-panel,.legacy-preview-panel{padding:12px}
          .legacy-search-card h2,.legacy-queue-panel h2,.legacy-preview-heading h2{font-size:17px;line-height:1.3}
          .legacy-tools-heading{font-size:13px}
          .legacy-tools-heading small{font-size:11px}
          .legacy-branch-tools a,.legacy-branch-tools button{min-height:32px;font-size:12px}
          .legacy-search-form>label,.legacy-format-controls>strong{font-size:12px}
          .legacy-search-form input{height:38px;font-size:16px}
          .legacy-search-form button{height:38px;font-size:12px}
          .legacy-search-form>div{grid-template-columns:minmax(0,1fr) minmax(92px,auto)}
          .legacy-format-controls button{min-width:72px;height:33px;padding:0 10px;font-size:11px}
          .legacy-search-filters{gap:9px 15px}
          .legacy-search-filters .legacy-stock-filter{font-size:13px}
          .legacy-search-filters input[type=checkbox]{width:16px;height:16px;flex:none}
          .legacy-memo-info{gap:7px;padding:9px}
          .legacy-memo-info label{font-size:11px}
          .legacy-memo-info input{height:32px;font-size:12px}
          .legacy-status-message,.legacy-result-count{font-size:12px}
          .legacy-products-table{min-width:900px;font-size:12px}
          .legacy-results-panel .legacy-search-results-table{min-width:760px}
          .legacy-products-table th{height:36px;font-size:11px;white-space:normal;line-height:1.25}
          .legacy-products-table td{height:45px;line-height:1.3}
          .legacy-products-table input{width:16px;height:16px}
          .legacy-status-pill{font-size:11px}
          .legacy-pagination{gap:7px;font-size:12px}
          .legacy-pagination button{width:35px;height:32px}
          .legacy-pagination label input{height:32px;font-size:13px}
          .legacy-queue-footer{font-size:12px}
          .legacy-queue-footer button{height:34px;font-size:12px}
          .legacy-output-buttons{gap:7px}
          .legacy-output-buttons button{min-height:34px;height:auto;padding:7px 10px;font-size:11px}
          .legacy-format-notice,.legacy-preview-empty{font-size:12px;line-height:1.45}
          .legacy-table-frame{max-width:100%;overscroll-behavior-x:contain}
          .legacy-products-table td:nth-child(4),.legacy-products-table td:nth-child(5){overflow-wrap:anywhere}
        }
        @container (max-width:1020px){
          .legacy-search-workflow{grid-template-columns:minmax(0,1fr);grid-template-areas:"search" "results" "queue" "print"}
        }
        @media screen and (max-width:600px){
          .legacy-ptg-main{width:calc(100% - 20px)}
          .legacy-search-card,.legacy-results-panel,.legacy-queue-panel,.legacy-preview-panel{padding:10px}
          .legacy-memo-info{grid-template-columns:minmax(0,1fr)}
          .legacy-memo-info label:first-child{grid-column:auto}
          .legacy-format-controls button{flex:1 1 92px}
          .legacy-output-buttons{justify-content:stretch}
          .legacy-output-buttons button{flex:1 1 130px}
        }
        @media print{
          .ptg-print-preview,.ptg-print-preview *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
          [data-demo] .legacy-print-sheet{position:relative}
          [data-demo] .legacy-print-sheet::after{content:"DEMO ONLY • SAMPLE PRICES";position:absolute;bottom:.2in;left:0;right:0;text-align:center;color:#222;font:bold 12pt sans-serif}
          @page{size:letter ${format === "TWO" || format === "AIRCON" ? "landscape" : "portrait"};margin:0}
          html,body{margin:0!important;padding:0!important;background:#fff!important}
          body *{visibility:hidden!important}
          .ptg-print-preview,.ptg-print-preview *{visibility:visible!important}
          .ptg-print-preview{display:block!important;position:absolute!important;left:0!important;top:0!important;width:100%!important;margin:0!important;padding:0!important}
          .ptg-print-hide,.legacy-preview-heading,.legacy-format-notice,.legacy-preview-empty{display:none!important}
          .legacy-print-sheet{width:8.5in!important;height:11in!important;margin:0!important;padding:0!important;box-shadow:none!important}
          .legacy-half-sheet{grid-template-columns:repeat(2,5.07in);grid-template-rows:6.76in;gap:0;width:11in!important;height:8.5in!important}
          .legacy-half-sheet .legacy-price-tag{zoom:.65}
          .legacy-four-sheet{grid-template-columns:repeat(2,3.666in);grid-template-rows:repeat(2,4.888in);gap:0}
          .legacy-four-sheet .legacy-price-tag{zoom:.47}
          .legacy-four-sheet .legacy-tag-header-with-promo img.legacy-tag-promo{right:14px}
          .legacy-six-sheet{grid-template-columns:repeat(2,4.05in);grid-template-rows:repeat(3,calc(10.6in / 3));gap:0}
          .ptg-compact-tag{box-sizing:border-box;display:flex;flex-direction:column;gap:2px;width:100%;height:100%;padding:8px 10px;border:1px solid #003da5;color:#003da5;font:700 13px/1.15 Arial,sans-serif;overflow:hidden}
          .ptg-compact-header{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:0 0 68px;min-height:0;border-bottom:2px solid #003da5}
          .ptg-compact-header img{display:block;min-width:0;height:100%;object-fit:contain;mix-blend-mode:multiply}
          .ptg-compact-main-logo{flex:1;width:0;object-position:left center}
          .ptg-compact-promo-logo{flex:0 0 26%;width:26%;margin-left:auto;object-position:right center}
          .ptg-compact-barcode{text-align:right;font-size:11px}
          .ptg-compact-barcode strong{display:inline-block;min-width:8em;padding:1px 5px;background:#e1e4e8;color:#344761;text-align:center;white-space:nowrap;print-color-adjust:exact;-webkit-print-color-adjust:exact}
          .ptg-compact-model{display:flex;gap:5px;min-height:38px;align-items:start}
          .ptg-compact-model strong{flex:1;text-align:center;overflow-wrap:anywhere}
          .legacy-six-sheet .ptg-compact-srp-discounted{text-decoration-line:line-through;text-decoration-thickness:2px;text-decoration-color:currentColor;text-decoration-skip-ink:none}
          .ptg-compact-cash{font-size:10px}
          .ptg-compact-pay{display:grid;grid-template-columns:30% minmax(0,1fr);align-items:center;justify-items:start;gap:6px;white-space:nowrap}
          .ptg-compact-pay strong{background:#fff500;padding:2px 6px;font-size:30px;print-color-adjust:exact}
          .ptg-compact-summary{display:flex;justify-content:space-between;gap:6px;font-size:11px}
          .ptg-compact-footer{position:relative;width:100%;margin: auto 0 0;flex:0 0 90px}
          .ptg-compact-footer img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain;object-position:center bottom;mix-blend-mode:multiply}
          .legacy-aircon-sheet{width:11in!important;height:8.5in!important}
          .ptg-aircon{width:10.4in;color:#003da5;font:700 14px/1.2 Arial,sans-serif}
          .ptg-aircon-header{height:1.15in;display:flex;align-items:center;justify-content:space-between;border:1px solid #003da5;padding:8px 16px}
          .ptg-aircon-header img{width:76%;height:100%;object-fit:contain}
          .ptg-aircon-header .ptg-aircon-brand-logo{width:20%;margin-left:auto;object-fit:contain;mix-blend-mode:multiply}
          .ptg-aircon-header strong{margin-left:auto;font-size:25px}
          .ptg-aircon table{width:100%;border-collapse:collapse;table-layout:fixed;text-align:center}
          .ptg-aircon th,.ptg-aircon td{border:1px solid #003da5;padding:4px;overflow-wrap:anywhere}
          .ptg-aircon th{background:#003da5;color:#fff;print-color-adjust:exact}
          .ptg-aircon-products tbody tr{height:.68in}
          .ptg-aircon-products .ptg-aircon-area-heading{width:15%;white-space:nowrap;overflow-wrap:normal;font-size:.94em}
          .ptg-aircon-products :is(th,td):nth-child(4){width:28%}
          .ptg-aircon-lower{display:grid;grid-template-columns:1fr 2fr;min-height:1.75in}
          .ptg-aircon-footer{display:grid;grid-template-rows:auto 1fr;place-items:center;border:1px solid #003da5;padding:8px}
          .ptg-aircon-footer img{max-width:100%;height:1.1in;object-fit:contain}
          .legacy-half-sheet .legacy-price-tag:first-child:has(+ .legacy-price-tag){border-right:0!important}
          .legacy-price-tag{width:7.8in!important;height:10.4in!important;border:1px solid #003da5!important}
          .legacy-tag-header img,.legacy-tag-footer img{print-color-adjust:exact;-webkit-print-color-adjust:exact}
        }
      `}</style>
    </main>
  );
}



