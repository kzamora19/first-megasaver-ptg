// Append only visible, already authorized search results from a chosen brand.
// An identical barcode can represent more than one legitimate price offer.
export function appendVisibleBrandOffers(queue = [], results = [], chosenBrand = "") {
  const brand = String(chosenBrand || "").trim().toUpperCase();
  const matching = brand
    ? results.filter(product => String(product?.brand || "").trim().toUpperCase() === brand)
    : [];
  const ids = new Set((queue || []).map(item => item.id));
  const additions = matching.filter(item => {
    if (ids.has(item.id)) return false;
    ids.add(item.id);
    return true;
  });
  return { queue: [...queue, ...additions], matching, additions };
}
