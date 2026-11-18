// Read-only comparison of already-loaded offers. Does not fetch hidden prices,
// claim to represent complete memo history, or change the selected tag price.
export function visibleOffersForBarcode(selected, results = [], queue = [], options = {}) {
  if (!selected) return [];
  const barcode = String(selected.barcode || "").trim();
  const isAllowed = product => options.includeSubdealer || String(product.campaign || "").toUpperCase() !== "SUBDEALER";
  const ids = new Set();
  const output = [];
  for (const product of [selected, ...(results || []), ...(queue || [])]) {
    if (!product || (barcode && String(product.barcode || "").trim() !== barcode)) continue;
    if (!barcode && product !== selected) continue;
    if (!isAllowed(product)) continue;
    const id = String(product.id || "");
    if (id && ids.has(id)) continue;
    if (!id && output.some(other => other === product)) continue;
    if (id) ids.add(id);
    output.push(product);
  }
  return output;
}

export function memoEntriesForOffer(product) {
  const memos = Array.isArray(product?.price_memos)
    ? product.price_memos
    : product?.price_memos ? [product.price_memos] : [];
  const seen = new Set();
  return memos.filter(memo => {
    if (!memo) return false;
    const id = [memo.memo_id, memo.period, memo.created_at, memo.source_file].map(v => String(v || "")).join("|");
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
