import type * as XLSX from "xlsx";

export const pilotLimit = 25;
export const workbookLimit = 10;
export const destinations = ["sales", "ptg"] as const;
export type Destination = typeof destinations[number];
const fields = ["barcode", "description", "brand", "category", "sub_category"] as const;
export type CatalogRow = Record<typeof fields[number], string>;
export type ImportResult = { state: "pending" | "saved" | "blocked" | "verify"; detail?: string };
export type ImportResults = Partial<Record<Destination, ImportResult>>;

const header = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
const limits = [100, 500, 100, 160, 160];
const barcodeKey = (value: string) => (/^\d{1,7}$/.test(value) ? value.padStart(8, "0") : value).toLowerCase();

export function readCatalog(book: XLSX.WorkBook, xlsx: typeof XLSX): CatalogRow[] {
  const manifest = book.Sheets["Import Manifest"];
  if (manifest) {
    const entries = xlsx.utils.sheet_to_json<string[]>(manifest, { header: 1, raw: false, defval: "" });
    const status = entries.filter(row => row[0] === "review_status");
    if (status.length !== 1 || status[0][1] !== "VALIDATED_FOR_EXTRACTOR_RULES") {
      throw new Error("Resolve the Data Desk workbook review issues before importing.");
    }
  }
  const sheet = book.Sheets.Products;
  if (!sheet) throw new Error("Use a workbook with a Products sheet.");
  const records = xlsx.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "", blankrows: true });
  const columns = (records[0] ?? []).map(header);
  const indices = fields.map(field => columns.indexOf(header(field)));
  if (indices.some(index => index < 0)) throw new Error("Products must include Barcode, Description, Brand, Category, and Subcategory.");
  const seen = new Set<string>();
  const rows = records.slice(1).flatMap((row, index) => {
    if (!row.some(value => value.trim())) return [];
    const values = indices.map(column => (row[column] ?? "").trim());
    if (values.some((value, i) => !value || value.length > limits[i])) {
      throw new Error("Fill in all five catalog fields using valid lengths on Products row " + (index + 2) + ".");
    }
    // Match Sales Tracker's padding while preserving the supplied barcode for PTG.
    const key = barcodeKey(values[0]);
    if (seen.has(key)) throw new Error("Resolve the duplicate barcode on Products row " + (index + 2) + ".");
    seen.add(key);
    return [Object.fromEntries(fields.map((field, i) => [field, values[i]])) as CatalogRow];
  });
  if (!rows.length || rows.length > pilotLimit) throw new Error("Use 1–" + pilotLimit + " reviewed products for the catalog pilot.");
  return rows;
}

export function combineCatalogs(batches: { name: string; rows: CatalogRow[] }[]) {
  const seen = new Map<string, string>();
  const rows: CatalogRow[] = [];
  for (const batch of batches) {
    for (const row of batch.rows) {
      const key = barcodeKey(row.barcode);
      const previous = seen.get(key);
      if (previous) throw new Error("Barcode " + row.barcode + " appears in both " + previous + " and " + batch.name + ".");
      seen.set(key, batch.name);
      rows.push(row);
    }
  }
  if (!rows.length || rows.length > pilotLimit) throw new Error("Review 1–" + pilotLimit + " products across all selected workbooks.");
  return rows;
}

export async function publishCatalog(
  previous: ImportResults,
  authorize: (destination: Destination) => Promise<void>,
  send: (destination: Destination) => Promise<ImportResult>,
  update: (results: ImportResults) => void,
) {
  const results = { ...previous };
  for (const destination of destinations) {
    const state = results[destination]?.state;
    if (state !== "pending" && state !== "blocked") continue;
    try {
      await authorize(destination);
    } catch (error) {
      results[destination] = { state: "blocked", detail: message(error) };
      update({ ...results });
      continue;
    }
    try {
      results[destination] = await send(destination);
    } catch (error) {
      results[destination] = { state: "verify", detail: message(error) };
    }
    update({ ...results });
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be verified.";
}
