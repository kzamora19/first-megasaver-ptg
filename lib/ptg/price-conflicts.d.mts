export type PriceConflictIssue = { code: string; level: "warning"; text: string; otherId?: string };
export interface ComparablePriceOffer {
  id?: string;
  barcode?: string;
  memo_id?: string;
  campaign?: string | null;
  remarks?: string | null;
  selling_starts_on?: string | null;
  selling_ends_on?: string | null;
  tag_this?: number | null;
  months_6?: number | null;
  months_9?: number | null;
  months_12?: number | null;
  months_18?: number | null;
  months_24?: number | null;
  installment_required?: boolean;
  price_memos?: { memo_id?: string } | { memo_id?: string }[] | null;
}
export function reviewOfferConflicts(selected: ComparablePriceOffer | null | undefined,
 visibleOffers?: readonly ComparablePriceOffer[]): PriceConflictIssue[];
export function reviewInstallments(product: ComparablePriceOffer | null | undefined): PriceConflictIssue[];
