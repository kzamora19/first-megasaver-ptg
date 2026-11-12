// Extract values by their PDF page positions, preserving the printed header order.
const COLUMN_NAMES = [
  ["barcode", /^(?:bar\s*code|item\s*code)$/i], ["brand", /^brand$/i], ["category", /^category$/i],
  ["description", /^(?:model|description|item name)$/i], ["remarks", /^rema(?:rks|krs)$/i],
  ["componentBarcodes", /^component barcodes$/i],
  ["memoSrp", /^srp$/i], ["cashPayment", /^cash payment(?: only)?$/i],
  ["tagPrice", /^(?:cash\s*\/\s*)?tag(?:\s*this)?$|^now\s+price$/i],
  ...[6, 9, 12, 18, 24].map(months => ["months" + months, new RegExp("^" + months + "\\s*(?:mos?\\.?|months?)(?:\\s+0%)?$", "i")]),
];
const center = item => item.transform[4] + (Number.isFinite(item.width) ? item.width / 2 : 0);
const lineText = items => items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])
  .map(item => item.text.trim()).join(" ").replace(/\s+/g, " ").trim();

function columnHeaders(items) {
  const matches = COLUMN_NAMES.flatMap(([key, pattern]) =>
    items.filter(item => pattern.test(item.text.trim())).map(item => ({ key, item, x: center(item) })));
  // A later MODEL column can contain a short code while DESCRIPTION contains the complete product name.
  const descriptions = matches.filter(header => header.key === "description");
  if (descriptions.some(header => /^description$/i.test(header.item.text))) {
    for (const header of descriptions) if (/^model$/i.test(header.item.text)) header.key = "model";
  }
  return matches;
}

function sourceAmount(raw) {
  const compact = raw.replace(/[₱,\s]/g, "");
  if (!compact || /^[-–—]$/.test(compact)) return null;
  const match = compact.match(/^(\d+(?:\.\d{1,2})?)(\/MO\.?)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) && amount <= 9999999999.99 ? { amount, monthly: Boolean(match[2]) } : null;
}

export function positionedPromotionRows(document) {
  if (!document || !Array.isArray(document.pages) || typeof document.sourceName !== "string") {
    throw new Error("Inspect a promotion PDF before finding its product rows.");
  }
  const rows = [];
  let previousHeaders = [];
  for (const page of document.pages) {
    if (!Array.isArray(page.items) || !Number.isInteger(page.number)) throw new Error("The inspected PDF page is invalid.");
    if (page.items.some(item => !Array.isArray(item.transform) || item.transform.length !== 6 || !item.transform.every(Number.isFinite))) {
      throw new Error(`Page ${page.number} has invalid text positions.`);
    }
    const recognized = columnHeaders(page.items);
    const barcodeHeadersOnPage = recognized.filter(header => header.key === "barcode");
    const layoutByBarcode = new Map(barcodeHeadersOnPage.map(barcode => {
      const y = barcode.item.transform[5];
      const nearby = recognized.filter(header => Math.abs(header.item.transform[5] - y) <= 18);
      // These memos print the installment terms and Remarks above the primary
      // headings, with Tag This on its own line below.
      const installments = recognized.filter(header => header.key.startsWith("months") &&
        header.item.transform[5] > y + 18 && header.item.transform[5] <= y + 58);
      const tag = recognized.find(header => header.key === "tagPrice" &&
        header.item.transform[5] < y - 18 && header.item.transform[5] >= y - 34);
      const cash = nearby.find(header => header.key === "cashPayment");
      const layered = tag && cash && installments.length >= 3 && page.items.some(item =>
        /^H\.C\s*\/\s*CARD$/i.test(item.text.trim()) && Math.abs(item.transform[5] - y) <= 10);
      if (!layered) return [barcode, nearby];
      const remarks = recognized.find(header => header.key === "remarks" &&
        header.item.transform[5] > y + 18 && header.item.transform[5] <= y + 62);
      const cashOnly = { ...cash, item: { ...cash.item, text: cash.item.text.trim() + " ONLY" } };
      return [barcode, [...nearby.filter(header => header !== cash), cashOnly, tag, ...installments, ...(remarks ? [remarks] : [])]];
    }));
    const headers = [...new Set([...layoutByBarcode.values()].flat())];
    const available = headers.length ? headers : previousHeaders;
    const barcodeHeaders = available.filter(header => header.key === "barcode");
    if (!barcodeHeaders.length) continue;
    let continuationLayout = headers;
    const codes = page.items.filter(item => /^\d{4,8}$/.test(item.text.trim()) &&
      barcodeHeaders.some(header => Math.abs(center(item) - header.x) <= 22 &&
        (!headers.length || item.transform[5] < header.item.transform[5] - 3)))
      .sort((a, b) => b.transform[5] - a.transform[5]);
    for (const code of codes) {
      const y = code.transform[5];
      const section = barcodeHeaders.filter(header => Math.abs(center(code) - header.x) <= 22 &&
        (!headers.length || header.item.transform[5] > y + 2))
        .sort((a, b) => a.item.transform[5] - b.item.transform[5])[0];
      if (!section) continue;
      const sectionHeaders = layoutByBarcode.get(section) ?? available;
      const columns = new Map();
      for (const header of sectionHeaders.sort((a, b) => a.item.transform[5] - b.item.transform[5])) {
        if (!columns.has(header.key)) columns.set(header.key, header);
      }
      if (headers.length) {
        for (const item of page.items) {
          const x = center(item);
          if (Math.abs(item.transform[5] - section.item.transform[5]) > 2 ||
              !/[A-Za-z]/.test(item.text) || [...columns.values()].some(header => Math.abs(header.x - x) <= 12)) continue;
          const key = `printed-${x}`;
          columns.set(key, { key, item, x });
        }
      }
      const anchors = [...columns.values()].sort((a, b) => a.x - b.x);
      if (barcodeHeadersOnPage.length === 1) continuationLayout = anchors;
      const cells = {};
      for (const item of page.items) {
        if (headers.length && item.transform[5] >= Math.min(...anchors.map(header => header.item.transform[5])) - 1) continue;
        if (Math.abs(item.transform[5] - y) > Math.max(2, (code.height || 7) * 1.5)) continue;
        const nearestRow = codes.reduce((nearest, row) =>
          Math.abs(row.transform[5] - item.transform[5]) < Math.abs(nearest.transform[5] - item.transform[5]) ? row : nearest, code);
        if (nearestRow !== code) continue;
        const anchor = anchors.reduce((nearest, header) =>
          Math.abs(header.x - center(item)) < Math.abs(nearest.x - center(item)) ? header : nearest);
        (cells[anchor.key] ??= []).push(item);
      }
      const sourceColumns = Object.fromEntries(Object.entries(cells).map(([key, items]) => [key, lineText(items)]));
      const description = sourceColumns.description || sourceColumns.model || "";
      const warnings = [];
      const prices = {};
      const installments = [];
      for (const key of ["memoSrp", "cashPayment", "tagPrice", "months6", "months9", "months12", "months18", "months24"]) {
        const raw = sourceColumns[key] || "";
        const value = sourceAmount(raw);
        if (raw && !value && !/^[-–—]$/.test(raw)) warnings.push("The printed " + key + " amount needs review: " + raw);
        if (key.startsWith("months")) {
          if (value) installments.push({ months: Number(key.slice(6)), amount: value.amount, basis: value.monthly ? "monthly" : "total", raw });
        } else prices[key] = value?.amount ?? null;
      }
      const excerpt = Object.entries(sourceColumns).map(([key, value]) => key + ": " + value).join(" | ");
      rows.push({
        barcode: code.text.trim(), description, sourceName: document.sourceName,
        sourcePage: page.number, sourceExcerpt: excerpt,
        section: headers.length ? section.item.transform[5] : null,
        printedColumns: anchors.map(header => ({ key: header.key, label: header.item.text.trim() })),
        brand: sourceColumns.brand || "", category: sourceColumns.category || "",
        remarks: sourceColumns.remarks || "", model: sourceColumns.model || "",
        sourceColumns, installments, ...prices,
        warnings: [
          ...(sourceColumns.barcode !== code.text.trim() ? ["Check the text aligned with the printed barcode."] : []),
          ...(!description ? ["Description was not detected; enter it from the PDF."] : []),
          ...(prices.tagPrice === null && prices.cashPayment === null && !installments.length ? ["No sale price was detected. Check the source page."] : []),
          ...warnings,
        ],
      });
    }
    if (headers.length) {
      // Reuse a continuation layout only when the preceding page had one section.
      previousHeaders = barcodeHeadersOnPage.length === 1 ? continuationLayout : [];
    }
  }
  return rows;
}
