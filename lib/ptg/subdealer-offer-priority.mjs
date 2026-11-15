// Duplicate rows within ONE subdealer PDF use the higher selling price.
// Keep the entire winning row together; never combine cash from one row
// with installment terms, SRP, description, or Tag This from another.
export function preferredSubdealerOffer(existing, candidate) {
  const tag = row => Number(row.tag_this) || 0;
  const cash = row => Number(row.cash_payment) || 0;
  if (tag(candidate) > tag(existing)) return candidate;
  if (tag(candidate) < tag(existing)) return existing;
  if (cash(candidate) > cash(existing)) return candidate;
  return existing; // deterministic first row for identical prices
}
