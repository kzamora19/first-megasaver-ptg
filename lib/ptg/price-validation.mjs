// Read-only preflight messages. Never change the offer or block legitimate SRP-only items.
function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return null;
  const [year, month, date] = day.split("-").map(Number);
  const epoch = Date.UTC(year, month - 1, date);
  return new Date(epoch).toISOString().slice(0, 10) === day ? day : null;
}
function memoDateRange(period) {
  const text = String(period || "").trim();
  if (!text) return null;
  const ISO = text.match(/^(\d{4}-\d{2}-\d{2})\s*(?:to|[-–—])\s*(\d{4}-\d{2}-\d{2})$/i);
  if (ISO) {
    const start = validDay(ISO[1]), end = validDay(ISO[2]);
    return start && end && end >= start ? { start, end } : null;
  }
  // Parse only unambiguous single-month ranges: "Nov 1-30, 2026".
  const match = text.match(/^([A-Za-z]+)\s+(\d{1,2})\s*[-–—]\s*(\d{1,2}),?\s+(\d{4})$/);
  if (!match) return null;
  const monthIndex = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"]
    .indexOf(match[1].slice(0, 3).toLowerCase());
  if (monthIndex < 0) return null;
  const prefix = match[4] + "-" + String(monthIndex + 1).padStart(2, "0") + "-";
  const start = validDay(prefix + match[2].padStart(2, "0"));
  const end = validDay(prefix + match[3].padStart(2, "0"));
  return start && end && end >= start ? { start, end } : null;
}

export function checkProductPrice(product, today) {
  if (!product) return [];
  const issues = [];
  const note = (code, level, text) => issues.push({ code, level, text });
  const barcode = String(product.barcode || "").trim();
  const srp = positiveNumber(product.srp);
  const price = positiveNumber(product.tag_this);
  if (!barcode) note("NO_BARCODE", "warning", "Barcode is missing. Confirm the product reference before printing.");
  if (!srp) note("NO_SRP", "warning", "SRP is missing or zero. Verify the catalog price before printing.");
  if (!price) note("NO_TAG_PRICE", "warning", "The selected Tag This price is missing or zero. Verify the memo or SRP.");
  if (srp && price && price > srp + 0.01) {
    note("ABOVE_SRP", "warning", "Tag This is higher than SRP. Verify that this price is intentional.");
  }
  const starts = validDay(product.selling_starts_on);
  const ends = validDay(product.selling_ends_on);
  const now = validDay(today);
  if (now && starts && now < starts) {
    note("PROMO_EARLY", "info", product.early_print_only
      ? "Early printing only. The promotional selling period starts " + starts + "."
      : "The promotional selling period has not started yet (" + starts + ").");
  }
  if (now && ends && now > ends) {
    note("PROMO_ENDED", "warning", "The promotional selling period ended on " + ends + ". Verify the active memo.");
  }
  if (starts && ends && ends < starts) {
    note("INVALID_PROMO_DATES", "warning", "Promotional end date is earlier than its start date.");
  }
  // Memo periods are not always machine-readable. Alert ONLY when dates are
  // unambiguous, never infer an expired memo from vague free-form text.
  const info = Array.isArray(product.price_memos) ? product.price_memos[0] : product.price_memos;
  const memoPeriod = memoDateRange(info?.period || product.memo_period);
  if (now && memoPeriod && !starts && !ends) {
    if (now > memoPeriod.end) note("MEMO_PERIOD_ENDED", "warning",
      "This memo period ended on " + memoPeriod.end + ". Confirm whether a newer monthly memo applies.");
    else if (now < memoPeriod.start) note("MEMO_PERIOD_FUTURE", "info",
      "This memo period starts on " + memoPeriod.start + ". Early printing may be allowed; verify the effective selling date.");
  }
  if (product.unit_only_offer && positiveNumber(product.unit_only_offer.tag_this)
      && price && positiveNumber(product.unit_only_offer.tag_this) > price + 0.01) {
    note("UNIT_ONLY_HIGHER", "info", "Unit-only price is higher than the paired free-installation offer. Verify both options.");
  }
  return issues;
}
export function philippineToday(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return get("year") + "-" + get("month") + "-" + get("day");
}
