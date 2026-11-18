export type PrintBatchFormat = "ONE"|"TWO"|"FOUR"|"SIX"|"AIRCON"|"SMALL_APPS"|"CARAVAN";
export interface PrintBatchProduct { id: string }
export interface PrintBatchPreferences { [id: string]: { format?: PrintBatchFormat; copies?: number } }
export function normalizePrintCopies(value: unknown): number;
export function groupedPrintPlan(queue: readonly PrintBatchProduct[], preferences: PrintBatchPreferences, defaultFormat: PrintBatchFormat):
  { format: PrintBatchFormat; products: number; copies: number }[];
export function expandedPrintBatch<T extends PrintBatchProduct>(queue: readonly T[], preferences: PrintBatchPreferences,
 format: PrintBatchFormat, defaultFormat: PrintBatchFormat, enabled: boolean): T[];
