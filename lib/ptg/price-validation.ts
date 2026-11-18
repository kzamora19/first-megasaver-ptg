/**
 * Non-blocking validation for the PTG product search and print queue.
 * A warning never silently removes a product or rewrites its selling price.
 * Dates and overlaps must be confirmed from structured memo data, not parsed
 * from free-form period descriptions.
 */
export type PriceSource = {
  memo_id?: string | null;
  memo_type?: string | null;
  period?: string | null;
  expired_at?: string | null;
};

export type PriceRecord = {
  id?: string;
  barcode?: string | null;
  model?: string | null;
  srp?: number | null;
  cash_payment?: number | null;
  tag_this?: number | null;
  months_6?: number | null;
  months_9?: number | null;
  months_12?: number | null;
  months_18?: number | null;
  months_24?: number | null;
  remarks?: string | null;
  price_memos?: PriceSource | PriceSource[] | null;
};

export type PriceWarning = {
  code:
    | "ZERO_SRP"
    | "INVALID_AMOUNT"
    | "NO_MEMO_PRICE"
    | "BELOW_HALF_SRP"
    | "ABOVE_SRP"
    | "MISSING_INSTALLMENT"
    | "INVALID_INSTALLMENT"
    | "EXPIRED_MEMO"
    | "INSTALLATION_REMARKS_CONFLICT"
    | "INSTALLATION_PRICE_REVIEW"
    | "MULTIPLE_OFFERS";
  severity: "HIGH" | "REVIEW";
  message: string;
};

const installmentTerms = ["months_6", "months_9", "months_12", "months_18", "months_24"] as const;

function numeric(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const result = Number(value);
  return Number.isFinite(result) ? result : NaN;
}

export function memoFor(product: PriceRecord): PriceSource | null {
  const memo = product.price_memos;
  return Array.isArray(memo) ? memo[0] ?? null : memo ?? null;
}

export function effectivePayNow(product: PriceRecord): number {
  // PTG may receive SRP-only rows without a selling-price memo.
  const tag = numeric(product.tag_this);
  const cash = numeric(product.cash_payment);
  const srp = numeric(product.srp);
  if (Number.isFinite(tag) && tag > 0) return tag;
  if (Number.isFinite(cash) && cash > 0) return cash;
  return Number.isFinite(srp) && srp > 0 ? srp : 0;
}

export function validatePrice(product: PriceRecord, otherOffers: PriceRecord[] = []): PriceWarning[] {
  const warnings: PriceWarning[] = [];
  const add = (code: PriceWarning["code"], severity: PriceWarning["severity"], message: string) =>
    warnings.push({ code, severity, message });

  const srp = numeric(product.srp);
  const tag = numeric(product.tag_this);
  const cash = numeric(product.cash_payment);
  const selling = effectivePayNow(product);
  const memo = memoFor(product);

  if (!Number.isFinite(srp) || srp <= 0) {
    add("ZERO_SRP", "HIGH", "SRP is zero, missing or invalid; check the imported master price.");
  }
  if (![tag, cash].every(Number.isFinite) || tag < 0 || cash < 0) {
    add("INVALID_AMOUNT", "HIGH", "A selling amount is invalid or negative.");
  }

  if (tag <= 0 && cash <= 0 && srp > 0) {
    add("NO_MEMO_PRICE", "REVIEW", "SRP-only product: Pay Now uses SRP. This does not prevent printing.");
  }

  if (selling > 0 && srp > 0 && selling > srp) {
    add("ABOVE_SRP", "REVIEW", "Selected selling price is above SRP; confirm before printing.");
  }
  if (selling > 0 && srp > 0 && selling < srp / 2) {
    add("BELOW_HALF_SRP", "REVIEW", "Discount exceeds 50% of SRP; confirm the memo price.");
  }
  if (memo?.expired_at) {
    add("EXPIRED_MEMO", "HIGH", "Memo is marked expired. Verify the current selling offer.");
  }

  const badTerms = installmentTerms.filter(term => {
    const amount = numeric(product[term]);
    return !Number.isFinite(amount) || amount < 0;
  });
  if (badTerms.length) {
    add("INVALID_INSTALLMENT", "HIGH", "An installment total is negative or invalid.");
  }
  const missingTerms = installmentTerms.filter(term => numeric(product[term]) === 0);
  if (missingTerms.length && (tag > 0 || cash > 0 || installmentTerms.some(term => numeric(product[term]) > 0))) {
    add(
      "MISSING_INSTALLMENT",
      "REVIEW",
      `Missing installment totals for ${missingTerms.map(term => term.replace("months_", "") + " months").join(", ")}. Some promotions may legitimately omit terms.`
    );
  }

  const remarks = String(product.remarks ?? "").toUpperCase().replace(/[-_]+/g, " ");
  const unitOnly = /UNIT\s*ONLY/.test(remarks);
  const freeInstallation = /FREE\s*(?:FIRST\s*10\s*(?:FT|FEET)\s*)?INSTALLATION/.test(remarks);
  if (unitOnly && freeInstallation) {
    add(
      "INSTALLATION_REMARKS_CONFLICT",
      "HIGH",
      "Remarks simultaneously say UNIT ONLY and FREE INSTALLATION; verify the offer."
    );
  }

  const barcode = String(product.barcode ?? "").trim();
  const others = otherOffers.filter(row => row.id !== product.id && barcode !== "" && String(row.barcode ?? "").trim() === barcode);
  if (others.length) {
    const samePeriodConflicts = others.some(row => {
      const secondMemo = memoFor(row);
      if (!memo?.memo_type || !secondMemo?.memo_type || !memo?.period || !secondMemo?.period) return false;
      return memo.memo_type === secondMemo.memo_type &&
        memo.period === secondMemo.period &&
        effectivePayNow(row) !== selling;
    });
    if (samePeriodConflicts) {
      add("MULTIPLE_OFFERS", "REVIEW", "Different prices were found for this barcode in the same memo category and period.");
    }
    if (others.some(row => {
      const otherRemarks = String(row.remarks ?? "").toUpperCase().replace(/[-_]+/g, " ");
      const differingInstallation = (unitOnly && /FREE\s*(?:FIRST\s*10\s*(?:FT|FEET)\s*)?INSTALLATION/.test(otherRemarks)) ||
        (freeInstallation && /UNIT\s*ONLY/.test(otherRemarks));
      return differingInstallation && effectivePayNow(row) !== selling;
    })) {
      add("INSTALLATION_PRICE_REVIEW", "REVIEW", "Unit-only and installation-included offers have different prices. Verify the selected package.");
    }
  }

  return warnings;
}
