export interface QueueOffer { id: string; brand?: string | null; barcode?: string | null }
export function appendVisibleBrandOffers<T extends QueueOffer>(
  queue: readonly T[], results: readonly T[], chosenBrand: string
): { queue: T[]; matching: T[]; additions: T[] };
