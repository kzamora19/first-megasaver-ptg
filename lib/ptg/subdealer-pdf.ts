import { positionedSubdealerRows } from "./subdealer-pdf-layout.mjs";
import { preferredSubdealerOffer } from "./subdealer-offer-priority.mjs";

export type SubdealerProduct = {
  barcode: string; brand: string; category: string; model: string;
  srp: number; cash_payment: number; tag_this: number; remarks: string;
  months_6: number; months_9: number; months_12: number; months_18: number; months_24: number;
};

export type SubdealerPreview = {
  fileName: string; memoId: string; period: string; pageCount: number;
  expectedRows: number; extractedRows: number; products: SubdealerProduct[];
  resolvedDuplicates: number; issues: string[];
};

const months: Record<string, number> = {
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6,
  JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
};

function dateIso(month: string, day: string, year: string) {
  const mm = months[month.toUpperCase()];
  const yy = Number(year), dd = Number(day);
  if (!mm || yy < 2000 || yy > 2100 || dd < 1 || dd > 31) throw Error("Invalid memo validity date.");
  const date = new Date(Date.UTC(yy, mm - 1, dd));
  if (date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) throw Error("Invalid memo validity date.");
  return year + "-" + String(mm).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
}

export function subdealerPeriod(text: string): string {
  const source = text.replace(/\s+/g, " ");
  const full = source.match(/Period\s*Covered\s*:\s*([A-Z]+)\s+(\d{1,2}),?\s*(\d{4})\s*[-–—]\s*([A-Z]+)\s+(\d{1,2}),?\s*(\d{4})/i);
  const short = source.match(/Period\s*Covered\s*:\s*([A-Z]+)\s+(\d{1,2})\s+TO\s+(\d{1,2})\s*,?\s*(\d{4})/i);
  let first = "", last = "";
  if (full) {
    first = dateIso(full[1], full[2], full[3]);
    last = dateIso(full[4], full[5], full[6]);
  } else if (short) {
    first = dateIso(short[1], short[2], short[4]);
    last = dateIso(short[1], short[3], short[4]);
  } else throw Error("The PDF validity period was not recognized. Review the source memo.");
  if (first > last) throw Error("The PDF memo has an invalid validity period.");
  return first + " to " + last;
}

const memoPattern = /\b(?:SUBCON-\d+|SUBD20\d{2}-\d+|SUB20\d{2}-\d+)\b/gi;
const canonicalMemo = (value: string) => value.toUpperCase().replace(/^SUBD(20\d{2}-)/, "SUB$1");

export function subdealerMemoNumber(fileName: string, headingText: string) {
  const filenameId = (fileName.match(memoPattern) ?? [])[0];
  if (!filenameId) throw Error("Memo number is missing from the filename.");
  const printed = headingText.match(memoPattern) ?? [];
  const verified = printed.find(id => canonicalMemo(id) === canonicalMemo(filenameId));
  // Some PDFs mention a different memo being superseded; never use that
  // reference as the current memo number.
  if (!verified) throw Error("The memo number printed in the PDF does not match its filename.");
  return canonicalMemo(verified);
}

type PdfTextItem = { str: string; transform: number[]; width: number; height: number };
type PdfPageData = { number: number; items: { text: string; transform: number[]; width: number; height: number }[] };
const pdfJsRoot = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/";

export async function inspectSubdealerPdf(file: File): Promise<SubdealerPreview> {
  if (!/\.pdf$/i.test(file.name) || file.size > 20 * 1024 * 1024) {
    throw Error("Choose a PDF memo no larger than 20 MB.");
  }
  const pdfjs = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pdfJsRoot + "pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfJsRoot + "pdf.worker.mjs";
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    if (pdf.numPages > 100) throw Error("PDF exceeds the 100-page review limit.");
    const pages: PdfPageData[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const items = (content.items as unknown[]).filter((item): item is PdfTextItem =>
        item !== null && typeof item === "object" &&
        "str" in item && typeof item.str === "string" &&
        "transform" in item && Array.isArray(item.transform) && item.transform.length === 6
      ).map(item => ({
        text: item.str, transform: item.transform,
        width: Number(item.width) || 0, height: Number(item.height) || 0,
      }));
      pages.push({ number, items });
    }
    const heading = [...pages[0].items].sort((a, b) =>
      b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]
    ).map(item => item.text).join(" ");
    const period = subdealerPeriod(heading);
    const memoId = subdealerMemoNumber(file.name, heading);
    const extracted = positionedSubdealerRows({ sourceName: file.name, pages });
    // Preserve source barcodes exactly, including documented nine-digit
    // entries, rather than wrongly flagging them as missing rows.
    const expectedRows = pages.reduce((n, page) =>
      n + page.items.filter(item => /^0\d{6,9}$/.test(item.text.trim())).length, 0);
    const issues: string[] = [];
    if (!expectedRows) issues.push("No selectable eight-digit product barcodes were found (scanned PDF?).");
    if (extracted.length !== expectedRows) {
      issues.push("Found " + expectedRows + " PDF barcode rows but extracted " +
        extracted.length + ". The memo must be reviewed before importing.");
    }
    if (extracted.length > 10000) issues.push("A memo may contain no more than 10,000 products.");
    const products: SubdealerProduct[] = [];
    const seenBarcodes = new Map<string, { rowNumber: number; productIndex: number; product: SubdealerProduct }>();
    let resolvedDuplicates = 0;
    for (const [index, row] of extracted.entries()) {
      const barcode = String(row.barcode || "").trim();
      const brand = String(row.brand || "").trim();
      const category = String(row.category || "").trim();
      const model = String(row.description || row.model || "").trim();
      const priceRow = row as typeof row & { memoSrp?: number | null; cashPayment?: number | null; tagPrice?: number | null };
      const srp = priceRow.memoSrp ?? 0;
      const cash = priceRow.cashPayment ?? 0;
      const tagThis = priceRow.tagPrice ?? priceRow.cashPayment ?? 0;
      const reasons = [
        ...row.warnings,
        ...(!/^0\d{6,9}$/.test(barcode) ? ["invalid barcode format or missing leading zeroes"] : []),
        ...(!brand ? ["missing brand"] : []),
        ...(!category ? ["missing category"] : []),
        ...(!model || model.length > 240 ? ["missing/overlong model"] : []),
        ...(!Number.isFinite(srp) || srp <= 0 ? ["missing SRP"] : []),
        ...(!Number.isFinite(cash) || cash <= 0 ? ["missing Cash Payment"] : []),
        ...(!Number.isFinite(tagThis) || tagThis <= 0 ? ["missing Tag This / Cash Payment"] : []),
      ];
      if (reasons.length) {
        issues.push("Page " + row.sourcePage + " · barcode " + barcode + " · row " +
          (index + 1) + ": " + [...new Set(reasons)].join("; "));
      }
      const installments = Object.fromEntries([6, 9, 12, 18, 24].map(term => {
        const entry = row.installments.find(value => value.months === term);
        return ["months_" + term, entry?.amount != null ? entry.amount * (entry.basis === "monthly" ? term : 1) : 0];
      })) as Record<"months_6" | "months_9" | "months_12" | "months_18" | "months_24", number>;
      const product: SubdealerProduct = {
        barcode, brand, category, model, srp, cash_payment: cash, tag_this: tagThis,
        remarks: String(row.remarks || "").trim(), ...installments,
      };
      const previous = seenBarcodes.get(barcode);
      if (previous) {
        // If multiple rows share a barcode in this PDF, retain the full row
        // with the highest selling price. When Tag This is not printed,
        // tag_this already falls back to the Cash Payment amount.
        const preferred = preferredSubdealerOffer(previous.product, product);
        resolvedDuplicates++;
        if (preferred === product) {
          products[previous.productIndex] = product;
          seenBarcodes.set(barcode, {
            rowNumber: index + 1, productIndex: previous.productIndex, product,
          });
        }
        continue;
      }
      const productIndex = products.length;
      seenBarcodes.set(barcode, { rowNumber: index + 1, productIndex, product });
      products.push(product);
    }
    return { fileName: file.name, memoId, period, pageCount: pages.length,
      expectedRows, extractedRows: extracted.length, products, resolvedDuplicates, issues };
  } finally {
    await pdf.destroy();
  }
}
