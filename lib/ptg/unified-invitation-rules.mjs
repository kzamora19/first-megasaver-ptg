/**
 * New accounts only. A Sales Tracker account is the canonical identity.
 * PTG entitlements never follow merely from the employee's email.
 * @typedef {{id:string,code:string,name:string,district_id?:string,dealer_id?:string}} SalesBranch
 * @typedef {{id:string,branch_code:string,branch_name:string,status:string,operational_status:string}} PtgBranch
 */
export function normalizeBranchCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

/** @param {SalesBranch[]} salesBranches @param {PtgBranch[]} ptgBranches */
export function matchUnifiedBranches(salesBranches, ptgBranches) {
  const byCode = new Map();
  for (const branch of ptgBranches) {
    if (branch.status !== "ACTIVE" || branch.operational_status !== "ON") continue;
    const code = normalizeBranchCode(branch.branch_code);
    if (!code || byCode.has(code)) throw Error("Duplicate PTG branch code: " + code);
    byCode.set(code, branch);
  }
  const result = [];
  const seen = new Set();
  for (const branch of salesBranches) {
    const code = normalizeBranchCode(branch.code);
    if (!code || seen.has(code)) throw Error("Duplicate Sales Tracker branch code: " + code);
    seen.add(code);
    const ptg = byCode.get(code);
    if (ptg && branch.district_id && branch.dealer_id) result.push({
      code, salesBranchId: branch.id, salesDistrictId: branch.district_id,
      salesDealerId: branch.dealer_id, ptgBranchId: ptg.id,
      name: branch.name || ptg.branch_name,
    });
  }
  return result.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * @param {'manager'|'ps'} salesRole
 * @param {'NONE'|'BRANCH_MANAGER'|'TEAM_LEADER'} ptgAccess
 */
export function unifiedPtgGrant(salesRole, ptgAccess) {
  if (ptgAccess === "NONE") return null;
  if (salesRole === "manager" && ptgAccess === "BRANCH_MANAGER")
    return { role: "BRANCH_ADMIN", legacyRole: "BRANCH MANAGER" };
  if (salesRole === "ps" && ptgAccess === "TEAM_LEADER")
    return { role: "BRANCH_USER", legacyRole: "TEAM LEADER" };
  throw Error("That PTG access level is incompatible with the Sales Tracker role.");
}

/** Validate an invitation preview before any account is created. */
export function validateUnifiedInvitation(input, branch) {
  const fullName = String(input.fullName ?? "").trim();
  const login = String(input.login ?? "").trim();
  const email = String(input.email ?? "").trim().toLowerCase();
  if (fullName.length < 3 || fullName.length > 120) throw Error("Enter the employee's full name.");
  if (!/^[a-z0-9._-]{3,32}$/i.test(login)) throw Error("Enter a valid login ID (3–32 letters, numbers, . _ or -).");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Error("Enter a valid invitation email address.");
  if (!branch?.salesBranchId || !branch?.salesDistrictId || !branch?.ptgBranchId || !branch?.salesDealerId)
    throw Error("Select a branch with a verified Sales Tracker and PTG code match.");
  if (!["manager", "ps"].includes(input.salesRole)) throw Error("Selected Sales Tracker role is not supported in this pilot.");
  if (input.salesRole === "ps") {
    if (!/^[a-z0-9._-]{2,32}$/i.test(String(input.salespersonCode ?? "").trim()))
      throw Error("Product Specialists need a salesperson code.");
    if (!String(input.brand ?? "").trim()) throw Error("Product Specialists need an assigned brand.");
  }
  const ptg = unifiedPtgGrant(input.salesRole, input.ptgAccess);
  return { fullName, login, email,
    salesRole: input.salesRole,
    salespersonCode: input.salesRole === "ps" ? String(input.salespersonCode).trim() : null,
    assignedBrand: input.salesRole === "ps" ? String(input.brand).trim() : null,
    salesBranchId: branch.salesBranchId,
    salesDistrictId: branch.salesDistrictId,
    salesDealerId: branch.salesDealerId,
    ptgBranchId: ptg ? branch.ptgBranchId : null,
    branchCode: branch.code,
    ptgRole: ptg?.role ?? null,
    ptgLegacyRole: ptg?.legacyRole ?? null,
    applicationAccess: { salesTracker: true, ptg: ptg !== null },
  };
}
