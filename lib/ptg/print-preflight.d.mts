export type PrintFormat = "ONE" | "TWO" | "FOUR" | "SIX" | "SMALL_APPS" | "CARAVAN" | "AIRCON";
export interface PrintReviewIssue { code: string; label: string; detail: string }
export interface PrintReviewItem {
  brand?: string | null; barcode?: string | null; model?: string | null; description?: string | null;
  srp?: number | null; tag_this?: number | null;
}
export function reviewPrintQueue(queue: readonly PrintReviewItem[], format: PrintFormat,
  options?: { airconPages?: number }): { pages: number; items: number; problems: PrintReviewIssue[] };
