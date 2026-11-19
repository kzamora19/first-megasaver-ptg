export interface QueueItem {
  id?: string;
  model?: string;
  barcode?: string | null;
  brand?: string | null;
}
export function summarizePrintQueue(products: readonly QueueItem[]): {
  brands: { brand: string; count: number }[];
  sharedBarcodes: string[];
  total: number;
};
