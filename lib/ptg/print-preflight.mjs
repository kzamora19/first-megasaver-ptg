// Non-blocking preflight. This does not calculate or alter printable prices,
// and length checks are review hints, not measurements of the browser's layout.
const PER_SHEET = Object.freeze({ ONE: 1, TWO: 2, FOUR: 4, SIX: 6, SMALL_APPS: 6, CARAVAN: 6, AIRCON: 5 });
const DESCRIPTION_REVIEW_LENGTH = Object.freeze({
  ONE: 100, TWO: 78, FOUR: 56, SIX: 44, SMALL_APPS: 45, CARAVAN: 45, AIRCON: 72,
});
export function reviewPrintQueue(queue = [], format = "ONE", options = {}) {
  if (!(format in PER_SHEET)) throw new Error("Unsupported price tag format.");
  const problems = [];
  const add = (code, label, detail) => problems.push({ code, label, detail });
  const products = Array.isArray(queue) ? queue : [];
  for (let index = 0; index < products.length; index++) {
    const item = products[index] || {};
    const id = String(item.model || item.description || item.barcode || "Item " + (index + 1)).trim();
    const desc = String(item.description || item.model || "").trim();
    if (!String(item.barcode || "").trim()) add("BARCODE", id, "Barcode missing; confirm the correct product.");
    if (!String(item.brand || "").trim()) add("BRAND", id, "Brand missing; the printed label may be incomplete.");
    if (!desc) add("DESCRIPTION", id, "Model/description missing.");
    else if (desc.length > DESCRIPTION_REVIEW_LENGTH[format])
      add("TEXT_FIT", id, "Long description: inspect text fit in the print preview.");
    if (!(Number(item.srp) > 0)) add("SRP", id, "SRP is zero or missing; verify before printing.");
    const tagPrice = Number(format === "SMALL_APPS" || format === "CARAVAN" ? item.srp : item.tag_this);
    if (!(tagPrice > 0)) add("PRICE", id, "Price for this print format is zero or missing.");
    if (format === "AIRCON" && ![item.description,item.model].some(value => {
      const hp = String(value || "").match(/(\d+(?:\.\d+)?)\s*HP\b/i);
      return hp && [1,1.5,2,2.5,3].includes(Number(hp[1]));
    })) add("AIRCON", id, "Aircon capacity unsupported: 1, 1.5, 2, 2.5 or 3 HP required.");
  }
  const pages = format === "AIRCON"
    ? Math.max(0, Number(options.airconPages) || 0)
    : Math.ceil(products.length / PER_SHEET[format]);
  return { pages, items: products.length, problems };
}
