// Subdealer PDFs share the Promotion PDF Importer's positional-text approach,
// but use their own extractor because column headings can be vertically split,
// remarks can be unlabelled and short model codes start close to the barcode.
// Never change the validated Promotion PDF Importer while adjusting this parser.
const FIELD_NAMES = [
  ["barcode", /^(?:bar\s*code|item\s*code)$/i],
  ["brand", /^brand$/i],
  ["category", /^category$/i],
  ["model", /^(?:model|description|item name)$/i],
  ["memoSrp", /^srp$/i],
  ["cashPayment", /^cash\s*payment(?:\s*only)?$/i],
  ["tagPrice", /^(?:(?:cash\s*\/\s*)?tag(?:\s*this)?|now\s+price)$/i],
  ["remarks", /^rema(?:rks|krs)$/i],
  ...[6, 9, 12, 18, 24].map(months => [
    "months" + months, new RegExp("^" + months + "\\s*(?:mos?\\.?|months?)(?:\\s+0%)?$", "i"),
  ]),
];
const barcodePattern = /^0\d{6,9}$/;
const positionX = item => item.transform[4];
const center = item => positionX(item) + (Number.isFinite(item.width) ? item.width / 2 : 0);
const ordinate = item => item.transform[5];
const normalized = item => String(item.text ?? "").replace(/\s+/g, " ").trim();
const amount = raw => {
  const compact = String(raw || "").replace(/[₱,\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(compact)) return null;
  const number = Number(compact);
  return Number.isFinite(number) && number > 0 && number <= 9999999999.99 ? number : null;
};

export function positionedSubdealerRows(document) {
  if (!document || !Array.isArray(document.pages)) {
    throw new Error("Inspect a subdealer PDF before extracting its product rows.");
  }
  const output = [];
  for (const page of document.pages) {
    if (!Array.isArray(page.items) || !Number.isInteger(page.number) ||
      page.items.some(item => !Array.isArray(item.transform) ||
        item.transform.length !== 6 || !item.transform.every(Number.isFinite))) {
      throw new Error("Invalid positional PDF text on page " + page.number + ".");
    }
    const items = page.items.filter(item => normalized(item));
    const barcodeHeader = items.find(item => /^bar\s*code$/i.test(normalized(item)));
    if (!barcodeHeader) continue;
    const headerX = center(barcodeHeader), headerY = ordinate(barcodeHeader);
    const headings = [];
    for (const item of items) {
      // Printed remarks are often ~70pt above the barcode heading.
      // Printed Tag This may appear ~30pt below that same heading.
      if (ordinate(item) < headerY - 42 || ordinate(item) > headerY + 100) continue;
      for (const [key, pattern] of FIELD_NAMES) {
        if (pattern.test(normalized(item))) {
          headings.push({ key, x: center(item), y: ordinate(item), text: normalized(item) });
          break;
        }
      }
    }
    const headerMap = new Map();
    for (const heading of headings) {
      const old = headerMap.get(heading.key);
      if (!old || Math.abs(heading.y - headerY) < Math.abs(old.y - headerY)) {
        headerMap.set(heading.key, heading);
      }
    }
    if (!["brand", "category", "model", "memoSrp", "cashPayment"].every(key => headerMap.has(key))) {
      // Do not infer which unlabelled amount is the selling price.
      throw new Error("Subdealer PDF page " + page.number + " has unrecognized table headings.");
    }
    const codes = items.filter(item =>
      barcodePattern.test(normalized(item)) &&
      ordinate(item) < headerY - 3 &&
      Math.abs(center(item) - headerX) < 30
    ).sort((a, b) => ordinate(b) - ordinate(a));
    for (const code of codes) {
      const rowCells = {};
      for (const item of items) {
        if (ordinate(item) >= headerY - 2 ||
            Math.abs(ordinate(item) - ordinate(code)) > 6.2) continue;
        const closest = codes.reduce((a, b) =>
          Math.abs(ordinate(a) - ordinate(item)) <= Math.abs(ordinate(b) - ordinate(item)) ? a : b);
        if (closest !== code) continue;
        // On continuation pages, TAG THIS may be only 6pt from the first
        // product. Header text must never contaminate its printed price.
        if (FIELD_NAMES.some(([, pattern]) => pattern.test(normalized(item)))) continue;
        // TCL TV lists numeric row indices before the brand column.
        if (center(item) < headerMap.get("brand").x - 17) continue;
        // The rightmost remarks column may have no printed REMARKS heading.
        const rightmost = [...headerMap.values()].reduce((a, b) => a.x > b.x ? a : b);
        if (!headerMap.has("remarks") && center(item) > rightmost.x + 45) {
          (rowCells.remarks ??= []).push(item);
          continue;
        }
        // A 4-character model (e.g., MC30) sits after the barcode cell,
        // even when its center is closer to the BARCODE header than MODEL.
        if (item !== code && positionX(item) > positionX(code) + Number(code.width || 0) + 3 &&
            center(item) < headerMap.get("memoSrp").x - 20) {
          (rowCells.model ??= []).push(item);
          continue;
        }
        const nearest = [...headerMap.values()].reduce((a, b) =>
          Math.abs(center(item) - a.x) < Math.abs(center(item) - b.x) ? a : b);
        (rowCells[nearest.key] ??= []).push(item);
      }
      const cell = key => (rowCells[key] || [])
        .sort((a, b) => center(a) - center(b))
        .map(item => normalized(item)).join(" ").trim();
      const sourceColumns = Object.fromEntries(Object.keys(rowCells).map(key => [key, cell(key)]));
      const cashPayment = amount(cell("cashPayment"));
      const tagPrice = amount(cell("tagPrice"));
      const memoSrp = amount(cell("memoSrp"));
      const warnings = [];
      for (const [key, price] of [["cashPayment", cashPayment], ["memoSrp", memoSrp], ["tagPrice", tagPrice]]) {
        if (cell(key) && price === null) warnings.push("Printed " + key + " needs review: " + cell(key));
      }
      if (cashPayment === null) warnings.push("Missing Cash Payment");
      if (memoSrp === null) warnings.push("Missing SRP");
      for (const key of ["brand", "category", "model"]) {
        if (!cell(key)) warnings.push("Missing " + key);
      }
      output.push({
        barcode: normalized(code), sourceName: document.sourceName,
        sourcePage: page.number, sourceExcerpt: Object.entries(sourceColumns)
          .map(([key, value]) => key + ": " + value).join(" | "),
        brand: cell("brand"), category: cell("category"),
        model: cell("model"), description: cell("model"),
        remarks: cell("remarks"),
        memoSrp, cashPayment, tagPrice,
        installments: [6, 9, 12, 18, 24].map(months => ({
          months, amount: amount(cell("months" + months)), basis: "total",
          raw: cell("months" + months),
        })).filter(entry => entry.amount !== null),
        sourceColumns, warnings,
      });
    }
  }
  return output;
}
