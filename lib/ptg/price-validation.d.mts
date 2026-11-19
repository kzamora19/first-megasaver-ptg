export type PriceCheckIssue = {
  code: "NO_BARCODE" | "NO_SRP" | "NO_TAG_PRICE" | "ABOVE_SRP"
    | "PROMO_EARLY" | "PROMO_ENDED" | "INVALID_PROMO_DATES" | "UNIT_ONLY_HIGHER";
  level: "info" | "warning";
  text: string;
};
export interface ProductPriceInput {
  barcode?: string | null;
  srp?: number | null;
  tag_this?: number | null;
  selling_starts_on?: string | null;
  selling_ends_on?: string | null;
  early_print_only?: boolean;
  unit_only_offer?: ProductPriceInput | null;
}
export function checkProductPrice(product: ProductPriceInput | null | undefined, today: string): PriceCheckIssue[];
export function philippineToday(date?: Date): string;
