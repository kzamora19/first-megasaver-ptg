export interface PriceRevisionEvent {
  id: number; transactionId: number; memoNumber: string; barcode: string; operation: "INSERT"|"DELETE";
  tagThis: string; srp: string; remarks: string; importedBy: string; recordedAt: string; sourcePeriod: string;
}
export interface GroupedPriceRevision {
  key: string; barcode: string; transactionId: number; status: string;
  oldPrice: number|null; newPrice: number|null; oldSrp: number|null; newSrp: number|null;
  importedBy: string; recordedAt: string; sourcePeriod: string;
}
export function groupPriceRevisionEvents(events: readonly PriceRevisionEvent[]): GroupedPriceRevision[];
