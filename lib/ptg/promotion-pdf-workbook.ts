import * as XLSX from "xlsx";
import { positionedPromotionRows } from "./promotion-pdf-layout.mjs";

type PdfDocument = Parameters<typeof positionedPromotionRows>[0];
type PdfRow = ReturnType<typeof positionedPromotionRows>[number];
type Dates = { validFrom: string; validTo: string };
export type PromotionPdfOffer = PdfRow & Dates & {
  id: string; fileDigest: string; memoSrp: number | null; cashPayment: number | null; tagPrice: number | null;
};

export async function readPromotionPdfs(files: File[]) {
  const inspectorUrl = "/branchline/import-engine/promotion-pdf.mjs";
  const readerRoot = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/";
  const readerUrl = readerRoot + "pdf.mjs";
  const [inspector, pdfjs] = await Promise.all([
    import(/* webpackIgnore: true */ /* turbopackIgnore: true */ inspectorUrl),
    import(/* webpackIgnore: true */ /* turbopackIgnore: true */ readerUrl),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = readerRoot + "pdf.worker.mjs";
  return createPromotionWorkbook(files, async file =>
    inspector.inspectPromotionPdf(pdfjs, new Uint8Array(await file.arrayBuffer()), file.name), inspector.promotionPdfPeriod);
}

export async function createPromotionWorkbook(files: File[], inspect: (file: File) => Promise<PdfDocument>,
  readDates: (document: PdfDocument) => Dates = () => ({ validFrom: "", validTo: "" })) {
  const book = XLSX.utils.book_new();
  const index: (string | number)[][] = [["Worksheet", "PDF", "Page", "Offer rows"]];
  const review: (string | number)[][] = [["PDF", "Page", "Barcode", "Issue", "Source text"]];
  const extracted: PromotionPdfOffer[] = [];
  const seen = new Set<string>();

  for (const [fileIndex, file] of files.entries()) {
    try {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const fileDigest = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
      if (seen.has(fileDigest)) continue;
      const document = await inspect(file);
      const offers = positionedPromotionRows(document);
      const tables = new Map<string, PdfRow[]>();
      for (const offer of offers) {
        const key = JSON.stringify([offer.sourcePage, offer.section, offer.printedColumns]);
        const group = tables.get(key) ?? [];
        group.push(offer);
        tables.set(key, group);
        for (const warning of offer.warnings) review.push([file.name, offer.sourcePage, offer.barcode, warning, offer.sourceExcerpt]);
      }
      for (const page of document.pages) {
        if (!offers.some(offer => offer.sourcePage === page.number)) {
          review.push([file.name, page.number, "", "No product rows aligned with recognized headers.", ""]);
        }
      }
      let tableNumber = 0;
      for (const rows of tables.values()) {
        const first = rows[0];
        const columns = first.printedColumns;
        const sheetName = `PDF ${fileIndex + 1} p${first.sourcePage} t${++tableNumber}`;
        const values = [columns.map(column => column.label), ...rows.map(offer => columns.map(column =>
          column.key === "barcode" ? offer.barcode : offer.sourceColumns[column.key] ?? ""))];
        const sheet = XLSX.utils.aoa_to_sheet(values);
        sheet["!cols"] = columns.map(column => ({ wch: column.key === "description" ? 55 : Math.max(16, column.label.length + 2) }));
        XLSX.utils.book_append_sheet(book, sheet, sheetName);
        index.push([sheetName, file.name, first.sourcePage, rows.length]);
      }
      const dates = readDates(document);
      extracted.push(...offers.map((offer, index) => ({ ...offer, ...dates, fileDigest, id: fileDigest + "-" + index } as PromotionPdfOffer)));
      seen.add(fileDigest);
    } catch (error) {
      review.push([file.name, "", "", error instanceof Error ? error.message : "Unable to read this PDF.", ""]);
    }
  }

  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(index), "Source index");
  if (review.length > 1) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(review), "Review");
  return { book, offers: extracted, offerCount: extracted.length, reviewCount: review.length - 1 };
}

export function downloadPromotionWorkbook(book: XLSX.WorkBook) {
  XLSX.writeFile(book, "Branchline Promotion PDFs.xlsx");
}
