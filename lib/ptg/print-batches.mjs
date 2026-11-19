const FORMATS = ["ONE","TWO","FOUR","SIX","AIRCON","SMALL_APPS","CARAVAN"];
export function normalizePrintCopies(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 20 ? count : 1;
}
export function groupedPrintPlan(queue = [], preferences = {}, defaultFormat = "ONE") {
  if (!FORMATS.includes(defaultFormat)) throw new Error("Unsupported default print format.");
  const groups = new Map(FORMATS.map(format => [format, { format, products: 0, copies: 0 }]));
  for (const product of queue) {
    const plan = preferences[product.id] || {};
    const format = FORMATS.includes(plan.format) ? plan.format : defaultFormat;
    const group = groups.get(format);
    group.products++;
    group.copies += normalizePrintCopies(plan.copies);
  }
  return [...groups.values()].filter(group => group.products > 0);
}
export function expandedPrintBatch(queue = [], preferences = {}, format = "ONE", defaultFormat = "ONE", enabled = false) {
  if (!FORMATS.includes(format)) throw new Error("Unsupported print format.");
  if (!enabled) return [...queue];
  const expanded = [];
  for (const product of queue) {
    const plan = preferences[product.id] || {};
    const selected = FORMATS.includes(plan.format) ? plan.format : defaultFormat;
    if (selected !== format) continue;
    const copies = normalizePrintCopies(plan.copies);
    for (let index = 0; index < copies; index++) expanded.push(product);
  }
  return expanded;
}
