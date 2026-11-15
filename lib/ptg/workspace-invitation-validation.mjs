// Pure validation for a batch of Workspace invitations. This does not create
// accounts, send messages, or store credentials.
const salesRoles = new Set(['ps', 'manager', 'district_manager', 'inventory_controller', 'stock_custodian']);
const ptgRoles = new Set(['BRANCH_USER', 'BRANCH_ADMIN']);
const text = value => typeof value === 'string' ? value.trim() : '';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ptgUserPattern = /^[A-Z0-9._-]{3,32}$/;
// Match Sales Tracker's loginEmail conversion, including Philippine mobile aliases.
function salesLoginKey(raw) {
  const value = raw.trim().toLowerCase();
  if (value.includes('@')) return emailPattern.test(value) ? value : '';
  if (/^\+?[\d\s-]{7,20}$/.test(value)) {
    let digits = value.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '63' + digits.slice(1);
    return digits.length >= 7 && digits.length <= 15 ? `${digits}@login.branchline.app` : '';
  }
  return /^[a-z0-9._-]{3,40}$/.test(value) ? `${value}@login.branchline.app` : '';
}

/** Validate each recipient separately while detecting duplicate logins in a batch. */
export function validateWorkspaceInvitations(input) {
  if (!Array.isArray(input) || !input.length) return { valid: false, rows: [], errors: ['Add at least one person.'] };
  const seenSales = new Map();
  const seenPtg = new Map();
  const rows = input.map((item, index) => {
    const row = item && typeof item === 'object' ? item : {};
    const errors = [];
    const fullName = text(row.fullName);
    const email = text(row.email).toLowerCase();
    const sales = row.sales && typeof row.sales === 'object' ? row.sales : null;
    const ptg = row.ptg && typeof row.ptg === 'object' ? row.ptg : null;
    if (!fullName) errors.push('Enter a full name.');
    if (!emailPattern.test(email) || email.length > 254) errors.push('Enter a valid invitation email.');
    if (!sales && !ptg) errors.push('Select at least one app.');
    let normalizedSales = null;
    let normalizedPtg = null;
    if (sales) {
      const role = text(sales.role);
      const code = text(sales.salespersonCode);
      const login = role === 'ps' ? code : text(sales.login);
      const districtId = text(sales.districtId);
      const branchId = text(sales.branchId);
      const branchIds = Array.isArray(sales.branchIds) ? [...new Set(sales.branchIds.map(text).filter(Boolean))] : [];
      const brand = text(sales.brand);
      if (!salesRoles.has(role)) errors.push('Select a valid Sales Tracker role.');
      if (!login) errors.push(role === 'ps' ? 'Enter the salesperson code.' : 'Enter the Sales Tracker login.');
      else if (!salesLoginKey(login)) errors.push('Enter a valid Sales Tracker login.');
      if (role === 'ps' && !brand) errors.push('Enter the Product Specialist brand.');
      if (['ps', 'manager', 'district_manager'].includes(role) && !districtId) errors.push('Select the Sales Tracker district.');
      if (['ps', 'manager'].includes(role) && !branchId) errors.push('Select the Sales Tracker branch.');
      if (['inventory_controller', 'stock_custodian'].includes(role) && !branchIds.length) errors.push('Assign at least one inventory branch.');
      if (login) {
        const key = salesLoginKey(login);
        if (key && seenSales.has(key)) errors.push(`Sales Tracker login is repeated in row ${seenSales.get(key)}.`);
        else if (key) seenSales.set(key, index + 1);
      }
      normalizedSales = { role, login, salespersonCode: code, districtId, branchId, branchIds, brand };
    }
    if (ptg) {
      const role = text(ptg.role).toUpperCase();
      const username = text(ptg.username).toUpperCase();
      const branchId = text(ptg.branchId);
      const title = text(ptg.title).toUpperCase();
      if (!ptgRoles.has(role)) errors.push('Select a valid PTG branch role.');
      if (!ptgUserPattern.test(username)) errors.push('PTG username must contain 3–32 letters, numbers, dots, underscores or hyphens.');
      if (!branchId) errors.push('Select the PTG branch.');
      const titles = role === 'BRANCH_USER' ? ['BRANCH USER', 'TEAM LEADER'] : ['BRANCH ADMIN', 'BRANCH MANAGER'];
      if (!titles.includes(title)) errors.push('Select a PTG title that matches the role.');
      if (username) {
        if (seenPtg.has(username)) errors.push(`PTG username is repeated in row ${seenPtg.get(username)}.`);
        else seenPtg.set(username, index + 1);
      }
      normalizedPtg = { role, username, branchId, title };
    }
    return { fullName, email, sales: normalizedSales, ptg: normalizedPtg, errors };
  });
  return { valid: rows.every(row => !row.errors.length), rows, errors: [] };
}

