// Read-only offer checks. Only comparable, currently visible price offers are
// compared; this is NOT a complete server-side cross-memo audit.
const money = value => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const dateOnly = value => {
  const s = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
};
const barcode = value => {
  const str = String(value || "").trim().toUpperCase();
  return /^\d+$/.test(str) ? str.replace(/^0+(?=\d)/, "") : str;
};
const normalized = value => String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
const memoId = offer => normalized(offer.memo_id || (Array.isArray(offer.price_memos)
  ? offer.price_memos[0]?.memo_id : offer.price_memos?.memo_id));
const variant = offer => {
  const remarks = normalized(offer.remarks);
  if (/UNIT\s*ONLY|WITHOUT\s*INSTALLATION/.test(remarks)) return "UNIT_ONLY";
  if (/FREE\s*(?:FIRST\s*\d+\s*FT\s*)?INSTALLATION|WITH\s*INSTALLATION/.test(remarks)) return "INSTALLATION";
  return "STANDARD";
};
const campaign = offer => normalized(offer.campaign) || "REGULAR";
const samePrice = (a, b) => {
  // Different SRPs or explicit cash-payment amounts under the same memo are
  // also suspicious, even when Tag This happens to match. Never infer a
  // difference when one side is absent (the catalog may lack the field).
  const comparable = field => money(a[field]) === null || money(b[field]) === null
    || money(a[field]) === money(b[field]);
  return money(a.tag_this) === money(b.tag_this)
    && comparable("srp")
    && comparable("cash_payment")
    && [6, 9, 12, 18, 24].every(term =>
      money(a["months_" + term]) === money(b["months_" + term]));
};
const overlap = (a, b) => {
  const aStart = dateOnly(a.selling_starts_on), aEnd = dateOnly(a.selling_ends_on);
  const bStart = dateOnly(b.selling_starts_on), bEnd = dateOnly(b.selling_ends_on);
  return aStart && aEnd && bStart && bEnd && aStart <= bEnd && bStart <= aEnd;
};

/**
 * Flags genuine visible-data conflicts, never intentional regular vs 7MBDS
 * differences or unit-only/free-installation variants. No assumed memo dates.
 */
export function reviewOfferConflicts(selected, visibleOffers = []) {
  if (!selected) return [];
  const code = barcode(selected.barcode);
  if (!code) return [];
  const group = [];
  const ids = new Set();
  for (const offer of [selected, ...(visibleOffers || [])]) {
    if (!offer || barcode(offer.barcode) !== code) continue;
    if (offer.id && ids.has(offer.id)) continue;
    if (offer.id) ids.add(offer.id);
    group.push(offer);
  }
  const warnings = [];
  const selectedMemo = memoId(selected);
  for (const other of group) {
    if (other === selected || (selected.id && other.id === selected.id)) continue;
    // Separate cash/subdealer, regular vs promotional and installation variants
    // are legitimate offers with distinct prices.
    if (campaign(selected) !== campaign(other) || variant(selected) !== variant(other)) continue;
    if (samePrice(selected, other)) continue;
    const otherMemo = memoId(other);
    const sameMemo = Boolean(selectedMemo && otherMemo && selectedMemo === otherMemo);
    const overlappingPromo = campaign(selected) !== "REGULAR" && overlap(selected, other);
    if (!sameMemo && !overlappingPromo) continue;
    const label = otherMemo || "another visible offer";
    warnings.push({
      code: sameMemo ? "SAME_MEMO_CONFLICT" : "OVERLAPPING_PROMO_CONFLICT",
      level: "warning",
      otherId: other.id || "",
      text: sameMemo
        ? "The same memo (" + selectedMemo + ") has different prices or installment terms for this barcode and offer type. Check the source."
        : "Overlapping " + campaign(selected) + " selling periods have different prices or installment terms (" + label + "). Verify which memo applies.",
    });
  }
  return warnings.filter((issue, i, all) => all.findIndex(item =>
    item.code === issue.code && item.otherId === issue.otherId) === i);
}

/** Only flag missing installments when clearly expected or where a term is
 * missing between populated terms. Cash-only / SRP-only remains valid. */
export function reviewInstallments(product) {
  if (!product) return [];
  const terms = [6, 9, 12, 18, 24];
  const populated = terms.map((months, i) => money(product["months_" + months]) ? i : -1).filter(i => i >= 0);
  const notes = [];
  const requireInstallment = product.installment_required === true
    || /\bINSTALLMENT\s+(?:PRICE|PROMO|OFFER|AVAILABLE)\b/i.test(String(product.remarks || ""));
  if (!populated.length && requireInstallment) {
    notes.push({ code: "MISSING_INSTALLMENT", level: "warning",
      text: "This offer indicates installment pricing, but no installment term has an amount. Verify the memo." });
  } else if (populated.length > 1) {
    const missing = terms.slice(populated[0], populated.at(-1) + 1)
      .filter(months => !money(product["months_" + months]));
    if (missing.length) notes.push({ code: "INSTALLMENT_GAP", level: "warning",
      text: "Installment terms " + missing.join(", ") + " months are blank between populated terms. Verify the source memo." });
  }
  return notes;
}
