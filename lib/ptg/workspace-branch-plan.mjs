const text = value => typeof value === 'string' ? value.trim() : '';
const key = value => text(value).toUpperCase();

// Plan using freshly loaded records. Never assume that equal names or codes
// alone identify the same branch when their other details disagree.
export function planWorkspaceBranch({ code, name, districtId, salesBranches, ptgBranches }) {
  const normalizedCode = key(code), normalizedName = text(name);
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(normalizedCode)) return { error: 'Use a branch code of 2–10 letters or numbers, starting with a letter.' };
  if (!normalizedName || normalizedName.length > 120) return { error: 'Enter a branch name of up to 120 characters.' };
  if (!text(districtId)) return { error: 'Select the Sales Tracker district.' };
  if (!Array.isArray(salesBranches) || !Array.isArray(ptgBranches)) return { error: 'Branch lists could not be verified.' };
  const sales = salesBranches.filter(b => key(b.code) === normalizedCode);
  const ptg = ptgBranches.filter(b => key(b.branch_code) === normalizedCode);
  if (sales.length > 1 || ptg.length > 1) return { error: 'This branch code is ambiguous. Review the existing branches first.' };
  if (sales.some(b => key(b.name) !== key(normalizedName)) || ptg.some(b => key(b.branch_name) !== key(normalizedName))) return { error: 'This code already belongs to a branch with a different name. Review the existing branches first.' };
  if (salesBranches.some(b => key(b.name) === key(normalizedName) && key(b.code) !== normalizedCode) || ptgBranches.some(b => key(b.branch_name) === key(normalizedName) && key(b.branch_code) !== normalizedCode)) return { error: 'This name already belongs to a branch with a different code. Review the existing branches first.' };
  if (sales[0] && sales[0].district_id !== districtId) return { error: 'The Sales Tracker branch is assigned to another district. Review it before continuing.' };
  if (ptg[0] && (ptg[0].status !== 'ACTIVE' || ptg[0].operational_status !== 'ON')) return { error: 'The PTG branch is inactive or offline. Review it before continuing.' };
  return { code: normalizedCode, name: normalizedName, districtId, createSales: sales.length === 0, createPtg: ptg.length === 0 };
}

// Creation is deliberately sequential. A lost response can leave one side
// created, so never retry a write automatically; refresh and report instead.
export async function setupWorkspaceBranch(input, adapters) {
  let started = false;
  try {
    const current = await adapters.load();
    const plan = planWorkspaceBranch({ ...input, salesBranches: current.sales, ptgBranches: current.ptg });
    if (plan.error) return { ok: false, message: plan.error, started: false, current };
    if (!plan.createSales && !plan.createPtg) return { ok: true, alreadyExists: true, current };
    if (plan.createSales) { started = true; await adapters.createSales(current, plan); }
    if (plan.createPtg) { started = true; await adapters.createPtg(current, plan); }
    return { ok: true, alreadyExists: false, current: await adapters.load() };
  } catch (error) {
    let current;
    if (started) { try { current = await adapters.load(); } catch { /* Outcome remains uncertain. */ } }
    return { ok: false, started, current, message: error instanceof Error ? error.message : 'Branch setup could not be completed.' };
  }
}

