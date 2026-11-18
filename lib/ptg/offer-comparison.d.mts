export interface VisibleOffer {
 id?: string; barcode?: string; campaign?: string | null;
 price_memos?: any;
}
export function visibleOffersForBarcode<T extends VisibleOffer>(
 selected: T | null | undefined, results?: readonly T[], queue?: readonly T[],
 options?: { includeSubdealer?: boolean }
): T[];
export function memoEntriesForOffer(product: {
 price_memos?: any | any[] | null
} | null | undefined): any[];
