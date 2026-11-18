// Read-only queue analysis. Identical barcodes may legitimately represent
// separate offers (e.g. free-installation vs unit-only), so never deduplicate.
export function summarizePrintQueue(products) {
  const groups = new Map();
  const barcodes = new Map();
  for (const product of products || []) {
    const brand = String(product.brand || "Unbranded").trim().toUpperCase() || "UNBRANDED";
    groups.set(brand, (groups.get(brand) || 0) + 1);
    const code = String(product.barcode || "").trim();
    if (!code) continue;
    if (!barcodes.has(code)) barcodes.set(code, new Set());
    barcodes.get(code).add(String(product.id || product.model || ""));
  }
  return {
    brands: [...groups].map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => a.brand.localeCompare(b.brand)),
    sharedBarcodes: [...barcodes].filter(([, ids]) => ids.size > 1).map(([barcode]) => barcode),
    total: (products || []).length,
  };
}
