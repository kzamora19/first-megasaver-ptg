const variant = value => {
  const remarks = String(value || "").toUpperCase();
  if (/UNIT\s*ONLY|WITHOUT\s*INSTALLATION/.test(remarks)) return "UNIT_ONLY";
  if (/FREE\s*(?:FIRST\s*\d+\s*FT\s*)?INSTALLATION|WITH\s*INSTALLATION/.test(remarks)) return "INSTALLATION";
  return remarks.trim().replace(/\s+/g, " ").slice(0, 80) || "STANDARD";
};

/**
 * Match old/new events only within one database transaction, barcode and
 * product variant. Multiple candidates remain ambiguous (never paired).
 * Pagination boundaries can split transactions; all rows are clearly marked
 * as page-local audit observations rather than fabricated full history.
 */
export function groupPriceRevisionEvents(events = []) {
  const buckets = new Map();
  for (const event of events) {
    const key = [event.transactionId, String(event.barcode || "").trim(),
      variant(event.remarks)].join("|");
    if (!buckets.has(key)) buckets.set(key, {
      key, barcode: String(event.barcode || ""), transactionId: event.transactionId,
      before: [], after: [],
    });
    buckets.get(key)[event.operation === "DELETE" ? "before" : "after"].push(event);
  }
  return [...buckets.values()].map(group => {
    const matched = group.before.length === 1 && group.after.length === 1;
    const ambiguous = group.before.length > 1 || group.after.length > 1;
    return {
      key: group.key, barcode: group.barcode, transactionId: group.transactionId,
      status: ambiguous ? "Multiple variants — review source"
        : matched ? "Replacement (both sides recorded)"
        : group.before.length ? "Removed row (page-local)" : "Imported row (page-local)",
      oldPrice: group.before.length === 1 ? Number(group.before[0].tagThis) : null,
      newPrice: group.after.length === 1 ? Number(group.after[0].tagThis) : null,
      oldSrp: group.before.length === 1 ? Number(group.before[0].srp) : null,
      newSrp: group.after.length === 1 ? Number(group.after[0].srp) : null,
      importedBy: group.after[0]?.importedBy || group.before[0]?.importedBy || "—",
      recordedAt: group.after[0]?.recordedAt || group.before[0]?.recordedAt || "",
      sourcePeriod: group.after[0]?.sourcePeriod || group.before[0]?.sourcePeriod || "",
    };
  }).sort((a,b) => Number(b.transactionId) - Number(a.transactionId) || a.barcode.localeCompare(b.barcode));
}
