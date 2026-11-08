"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { requestPtgAccounts, usesEdgeAccounts } from "@/lib/ptg/accounts-client";
import { getSecuritySection, securitySections, type SecuritySection } from "@/lib/ptg/security-sections";
import AppDialog from "@/components/app-dialog";
import { useAppConfirm } from "@/components/app-confirm";
import AccountAdministration from "./account-administration";

type Branch = { id: string; branch_code: string; branch_name: string; status: string; operational_status: string };
type Control = { control_key: string; enabled: boolean };
type Session = { id: string; branch_id: string; account: string; device_label: string; created_at: string; last_activity_at: string };
type Permission = { permission_key: string; label: string; scope_description: string };
type Grant = { role_key: string; permission_key: string; access_level: string };
type Audit = { id: string; created_at: string; actor: string; current_role: string; event_category: string; action: string; target_identifier: string; outcome: string; message: string };
type Result = { ok: boolean; message?: string; controls?: Control[]; branches?: Branch[]; sessions?: Session[]; catalog?: Permission[]; grants?: Grant[]; events?: Audit[]; allowed?: boolean; count?: number; preserved?: number };

const date = (value: string) => new Date(value).toLocaleString();
const descriptions: Record<SecuritySection, string> = {
  master: "Manage Master System and Maintenance Mode across all branches.",
  branches: "Manage branches, branch accounts, and active sessions.",
  admins: "Manage System Admin accounts, invitations, and passwords.",
  permissions: "Review role permissions and test authorization for your current session.",
  srp: "Update the product SRP register manually or from a verified Head Office workbook.",
  audit: "Review recent authentication, authorization, and administrative activity.",
};

async function request(action: string, input: Record<string, unknown> = {}): Promise<Result> {
  const response = await requestPtgAccounts("POST", { ...input, action });
  const result: Result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.message || "The security request could not be completed.");
  return result;
}

export default function SecurityWorkspace() {
  const section = getSecuritySection(useSearchParams().get("section"));
  return <main className="shell admin-shell">
    <section className="hero admin-hero">
      <p className="eyebrow">ACCOUNT ADMINISTRATION · SYSTEM ADMIN</p>
      <h1>System Security</h1>
      <p className="intro">{descriptions[section]}</p>
    </section>
    <SecurityPanel key={section} section={section} />
  </main>;
}

function Rocker({ label, enabled, disabled, onChange }: {
  label: string;
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return <div className="security-rocker" role="group" aria-label={label}>
    {[true, false].map(value => <button type="button" key={String(value)} data-on={value}
      aria-pressed={value === enabled} disabled={disabled}
      onClick={() => { if (value !== enabled) onChange(value); }}>{value ? "ON" : "OFF"}</button>)}
  </div>;
}

const PAGE_SIZE = 10;

function SecurityTable({ label, headers, rows, empty }: {
  label: string;
  headers: string[];
  rows: { id: string; cells: ReactNode[] }[];
  empty: string;
}) {
  const [selectedPage, setPage] = useState(1);
  const lastPage = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(selectedPage, lastPage);
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return <>
    <table className="admin-table security-paged-table" aria-label={label}>
      <thead><tr>{headers.map(header => <th scope="col" key={header}>{header}</th>)}</tr></thead>
      <tbody>
        {visible.map(row => <tr key={row.id}>{row.cells.map((cell, index) =>
          <td key={headers[index]}><span title={typeof cell === "string" ? cell : undefined}>{cell}</span></td>
        )}</tr>)}
        {!rows.length && <tr><td colSpan={headers.length}>{empty}</td></tr>}
        {Array.from({ length: PAGE_SIZE - (rows.length ? visible.length : 1) }, (_, index) =>
          <tr key={index} aria-hidden="true"><td colSpan={headers.length} /></tr>)}
      </tbody>
    </table>
    <nav className="security-pagination" aria-label={label + " pagination"}>
      <button className="admin-button small secondary" type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
      <span role="status">Page {page} of {lastPage}</span>
      <button className="admin-button small secondary" type="button" disabled={page === lastPage} onClick={() => setPage(page + 1)}>Next</button>
    </nav>
  </>;
}

function SecurityPanel({ section }: { section: SecuritySection }) {
  const confirm = useAppConfirm();
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [manualRows, setManualRows] = useState([0]);
  const [nextRowId, setNextRowId] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [verified, setVerified] = useState(false);
  const [accountRefresh, setAccountRefresh] = useState(0);
  const [auditRefresh, setAuditRefresh] = useState(0);
  const [branchDialog, setBranchDialog] = useState<"add" | Branch | null>(null);
  const [permissionKey, setPermissionKey] = useState("");
  const [mode, setMode] = useState("VIEW");

  const load = useCallback(async () => {
    if (!usesEdgeAccounts || section === "admins" || section === "srp") return;
    const action = section === "permissions" ? "securityPermissions" : section === "audit" ? "securityAudit" : "securityStatus";
    const [result, sessionResult] = await Promise.all([
      request(action), section === "branches" ? request("securitySessions") : null,
    ]);
    setData({ ...result, sessions: sessionResult?.sessions });
  }, [section]);

  useEffect(() => {
    void load().catch(err => setError(err.message));
  }, [load]);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setNotice(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The operation failed.");
    } finally {
      setBusy(false);
    }
  }

  function mutate(action: string, input: Record<string, unknown>, message: string) {
    void run(async () => {
      await request(action, input);
      setBranchDialog(null);
      await load();
      if (action === "securityBranch") setAccountRefresh(value => value + 1);
      return message;
    });
  }

  async function importSrp(selected: File) {
    if (selected.size > 15 * 1024 * 1024) throw new Error("The workbook exceeds 15 MB.");
    const { read, utils } = await import("xlsx");
    const workbook = read(await selected.arrayBuffer());
    const sheet = ["product master", "products", "product_srp"]
      .map(expected => workbook.SheetNames.find(name => name.trim().toLowerCase() === expected))
      .find(Boolean);
    if (!sheet) throw new Error("Use a workbook with a Product Master, Products, or PRODUCT_SRP worksheet.");
    const records = utils.sheet_to_json<string[]>(workbook.Sheets[sheet], { header: 1, raw: false, defval: "", blankrows: true });
    const header = records.slice(0, 10).map(row => {
      const columns = row.map(value => value.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
      return {
        barcode: columns.findIndex(value => value === "barcode" || value === "itemcode"),
        description: ["modeldescription", "description", "itemname", "model"].map(value => columns.indexOf(value)).find(index => index >= 0) ?? -1,
        srp: columns.indexOf("srp"),
      };
    });
    const headerIndex = header.findIndex(({ barcode, description, srp }) => barcode >= 0 && description >= 0 && srp >= 0);
    if (headerIndex < 0) throw new Error("Use Barcode, Model / Description, and SRP columns.");
    const columns = header[headerIndex];
    const seen = new Set<string>();
    const rows = records.slice(headerIndex + 1).flatMap((row, index) => {
      const barcode = (row[columns.barcode] ?? "").trim();
      const description = (row[columns.description] ?? "").trim();
      const rawPrice = (row[columns.srp] ?? "").trim();
      if (!barcode && !description && !rawPrice) return [];
      const key = /^\d+$/.test(barcode) ? barcode.replace(/^0+(?=\d)/, "") : barcode.toUpperCase();
      const rowNumber = headerIndex + index + 2;
      if (!barcode || !description) throw new Error("Enter a barcode and description in worksheet row " + rowNumber + ".");
      if (seen.has(key)) throw new Error("Duplicate barcode " + barcode + " in worksheet row " + rowNumber + ".");
      seen.add(key);
      const value = rawPrice.replace(/[₱,\s]/g, "");
      const srp = Number(value);
      return [{ barcode, description, srp: /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(srp) ? srp : null }];
    });
    if (!rows.length || rows.length > 10000) throw new Error("Use a workbook containing 1 to 10,000 product rows.");
    const result = await request("securityImportSrp", { source: selected.name, verified, rows });
    setVerified(false);
    return "Saved " + result.count + " SRP records. Preserved " + (result.preserved ?? 0) + " existing records with no valid incoming price.";
  }

  function submitManualSrp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    void run(async () => {
      const barcodes = new Set<string>();
      const rows = manualRows.map((id, index) => {
        const barcode = String(fields.get("barcode-" + id) ?? "").trim();
        const description = String(fields.get("description-" + id) ?? "").trim();
        const amount = String(fields.get("srp-" + id) ?? "").trim();
        const srp = Number(amount);
        if (!barcode || !description || !amount || !Number.isFinite(srp) || srp < 0) {
          throw new Error("Enter a barcode, description, and valid SRP for product " + (index + 1) + ".");
        }
        if (barcodes.has(barcode)) throw new Error("Enter each barcode only once.");
        barcodes.add(barcode);
        return { barcode, description, srp };
      });
      const result = await request("securityImportSrp", { source: "Manual entry", verified: fields.has("verified"), rows });
      form.reset();
      setManualRows([0]);
      return "Saved " + result.count + " SRP records. Preserved " + (result.preserved ?? 0) + " existing records with no valid incoming price.";
    });
  }

  const branches = data?.branches ?? [];
  const masterOn = data?.controls?.find(row => row.control_key === "MASTER_SYSTEM")?.enabled ?? true;
  const maintenanceOn = data?.controls?.find(row => row.control_key === "MAINTENANCE_MODE")?.enabled ?? false;
  const status = !masterOn ? "System offline" : maintenanceOn ? "Maintenance active" : "System accessible";
  const needsData = section !== "admins" && section !== "srp";

  if (!usesEdgeAccounts) return <AccountAdministration role="SYSTEM_ADMIN" />;

  return <div className="security-panel">
    <h2>{securitySections.find(([key]) => key === section)?.[1]}</h2>
    {error && !branchDialog && <p role="alert" className="security-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {needsData && !data && !error && <p role="status">Loading security information…</p>}
    {needsData && !data && error && <button className="admin-button" disabled={busy} onClick={() => void run(async () => { await load(); return ""; })}>Retry</button>}
    {data && section === "master" && <>
      <p role="status"><strong>{status}</strong></p>
      <div className="security-control-grid">
        {[
          { title: "Master System", key: "MASTER_SYSTEM", enabled: masterOn, help: "Turning this off blocks branch accounts across all branches." },
          { title: "Maintenance Mode", key: "MAINTENANCE_MODE", enabled: maintenanceOn, help: "Turning this on temporarily blocks branch accounts and preserves branch settings." },
        ].map(control => <section className="admin-card" key={control.key}>
          <h3>{control.title}</h3>
          <p>{control.help}</p>
          <Rocker label={control.title} enabled={control.enabled} disabled={busy} onChange={async enabled => {
            const restrict = control.key === "MASTER_SYSTEM" ? !enabled : enabled;
            if (await confirm({
              title: "Turn " + control.title + (enabled ? " on?" : " off?"),
              message: restrict
                ? (control.key === "MAINTENANCE_MODE"
                  ? "PTG will show a maintenance warning and sign out all branch accounts. System Admins keep access."
                  : "PTG will become unavailable and sign out all branch accounts. System Admins keep access.")
                : "Branch access still depends on the other availability switch and each branch’s status.",
              label: enabled ? "Turn on" : "Turn off",
              danger: restrict,
            })) {
              mutate("securityControl", { key: control.key, enabled }, "Availability updated.");
            }
          }} />
        </section>)}
      </div>
      <p>System Admins retain full PTG access in either mode.</p>
      <section className="admin-card"><h3>Branch status summary</h3>
        <ul>{branches.filter(branch => branch.status === "ACTIVE").map(branch => <li key={branch.id}>
          {branch.branch_code} · {branch.branch_name} · {masterOn && !maintenanceOn && branch.operational_status === "ON" ? "Online" : "Offline"}
        </li>)}</ul>
      </section>
    </>}
    {section === "branches" && data && <>
      <section className="admin-card">
        <div className="security-card-heading">
          <h3>Branch registry</h3>
          <button className="admin-button" type="button" disabled={busy} onClick={() => { setError(""); setBranchDialog("add"); }}>Add branch</button>
        </div>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Code</th><th>Branch</th><th>Status</th><th>Access</th><th>Actions</th></tr></thead>
          <tbody>{branches.map(branch => <tr key={branch.id}><td>{branch.branch_code}</td><td>{branch.branch_name}</td><td>{branch.status}</td><td>
            <Rocker label={branch.branch_name + " access"} enabled={branch.operational_status === "ON"} disabled={busy || branch.status !== "ACTIVE"} onChange={async enabled => {
              if (await confirm({
                title: "Turn " + branch.branch_code + (enabled ? " on?" : " off?"),
                message: enabled ? "Branch users can sign in once system-wide restrictions are lifted." : "PTG will become unavailable for this branch and its users will be signed out.",
                label: enabled ? "Turn on" : "Turn off", danger: !enabled,
              })) {
                mutate("securityBranch", { command: enabled ? "on" : "off", branchId: branch.id }, "Branch updated.");
              }
            }} />
          </td><td>
            {branch.status === "ACTIVE"
              ? <button type="button" className="admin-button small secondary" disabled={busy} onClick={() => { setError(""); setBranchDialog(branch); }}>Deactivate</button>
              : <button type="button" className="admin-button small secondary" disabled={busy} onClick={async () => {
                if (await confirm({ title: "Reactivate " + branch.branch_code + "?", label: "Reactivate" })) mutate("securityBranch", { command: "reactivate", branchId: branch.id }, "Branch reactivated.");
              }}>Reactivate</button>}
          </td></tr>)}</tbody></table></div>
      </section>
      {branchDialog && <AppDialog title={branchDialog === "add" ? "Add branch" : "Deactivate " + branchDialog.branch_code}
        busy={busy} onClose={() => { setBranchDialog(null); setError(""); }}>
        {error && <p role="alert" className="security-error">{error}</p>}
        {branchDialog === "add" ? <form className="admin-form" onSubmit={event => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          mutate("securityBranch", { command: "add", code: fields.get("code"), name: fields.get("name") }, "Branch added.");
        }}>
          <label>Branch code<input name="code" required pattern="[A-Za-z0-9]{2,12}" maxLength={12} /></label>
          <label>Branch name<input name="name" required maxLength={120} /></label>
          <button className="admin-button" disabled={busy}>Add branch</button>
        </form> : <>
          <p>{branchDialog.branch_name} will lose PTG access and its active sessions will be signed out.</p>
          <button type="button" className="admin-button danger" disabled={busy} onClick={() => {
            mutate("securityBranch", { command: "deactivate", branchId: branchDialog.id }, "Branch deactivated.");
          }}>Deactivate branch</button>
        </>}
      </AppDialog>}
      <AccountAdministration key={accountRefresh} role="SYSTEM_ADMIN" scope="branch" />
      <section className="admin-card">
        <h3>Active branch sessions</h3>
        <button className="admin-button small secondary" disabled={busy} onClick={() => void run(async () => { await load(); return "Sessions refreshed."; })}>Refresh sessions</button>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Branch</th><th>Account</th><th>Device / browser</th><th>Login time</th><th>Last activity</th><th>Action</th></tr></thead>
          <tbody>{data.sessions?.length ? data.sessions.map(session => <tr key={session.id}>
            <td>{branches.find(branch => branch.id === session.branch_id)?.branch_code ?? "—"}</td><td>{session.account}</td><td>{session.device_label}</td><td>{date(session.created_at)}</td><td>{date(session.last_activity_at)}</td>
            <td><button className="admin-button small secondary" disabled={busy} onClick={async () => {
              if (await confirm({ title: "Sign out this session?", message: session.account + " will need to sign in again on this device.", label: "Force logout", danger: true })) mutate("securityRevokeSession", { sessionId: session.id }, "Session signed out.");
            }}>Force logout</button></td>
          </tr>) : <tr><td colSpan={6}>No active branch sessions.</td></tr>}</tbody></table></div>
      </section>
    </>}
    {section === "admins" && <>
      <p><Link className="admin-link" href="/change-password/">Change my password</Link></p>
      <section className="admin-card"><h3>Role definition</h3><p>System Admins have system-wide access, including security controls and account management.</p></section>
      <AccountAdministration role="SYSTEM_ADMIN" scope="system" />
    </>}
    {section === "permissions" && data && <section className="admin-card">
      <h3>Role permission matrix</h3>
      <SecurityTable label="Role permission matrix" empty="No permissions found."
        headers={["Permission", "System Admin", "Branch Admin", "Branch User", "Scope"]}
        rows={(data.catalog ?? []).map(permission => ({
          id: permission.permission_key,
          cells: [
            permission.label,
            ...["SYSTEM_ADMIN", "BRANCH_ADMIN", "BRANCH_USER"].map(role =>
              data.grants?.find(grant => grant.role_key === role && grant.permission_key === permission.permission_key)?.access_level.replaceAll("_", " ") ?? "NONE"
            ),
            permission.scope_description,
          ],
        }))} />
      <h3>Authorization test</h3>
      <form className="security-form" onSubmit={event => {
        event.preventDefault();
        void run(async () => (await request("securityTest", { permissionKey, mode })).allowed ? "Authorization allowed." : "Authorization denied.");
      }}>
        <label>Permission<select value={permissionKey} onChange={event => setPermissionKey(event.target.value)} required>
          <option value="">Choose a permission</option>{data.catalog?.map(permission => <option key={permission.permission_key} value={permission.permission_key}>{permission.label}</option>)}
        </select></label>
        <label>Action<select value={mode} onChange={event => setMode(event.target.value)}><option value="VIEW">View</option><option value="EXECUTE">Execute</option></select></label>
        <button className="admin-button" disabled={busy}>Test authorization</button>
      </form>
    </section>}
    {section === "srp" && <>
      <section className="admin-card">
        <h3>Enter SRPs manually</h3>
        <p>Enter one or more products. A positive SRP updates an existing barcode. A zero SRP preserves an existing record or adds a zero placeholder for a new barcode.</p>
        <form className="admin-form" onSubmit={submitManualSrp}>
          <fieldset disabled={busy} className="srp-manual-form">
            {manualRows.map((id, index) => <div className="srp-manual-fields" key={id} role="group" aria-label={"Product " + (index + 1)}>
              <label>Barcode<input name={"barcode-" + id} maxLength={100} required /></label>
              <label>Model / description<input name={"description-" + id} maxLength={1000} required /></label>
              <label>SRP (₱)<input name={"srp-" + id} type="number" min="0" step="0.01" required /></label>
              <button className="admin-button small secondary" type="button" disabled={manualRows.length === 1}
                aria-label={"Remove product " + (index + 1)} onClick={() => setManualRows(rows => rows.filter(row => row !== id))}>Remove</button>
            </div>)}
            <div className="srp-manual-actions">
              <button className="admin-button secondary" type="button" disabled={manualRows.length >= 10000} onClick={() => {
                setManualRows(rows => [...rows, nextRowId]);
                setNextRowId(nextRowId + 1);
              }}>Add product</button>
              <label className="security-check"><input type="checkbox" name="verified" required /> I verified these prices.</label>
              <button className="admin-button" type="submit">Save SRPs</button>
            </div>
          </fieldset>
        </form>
      </section>
      <section className="admin-card">
      <h3>Verify the source workbook</h3>
      <p>Use the current Head Office workbook or Product Data Extractor export. Import time records when PTG received the workbook. It cannot establish when the prices took effect.</p>
      <p>For product names, barcodes, and categories, open <Link className="admin-link" href="/product-master/">Product Master</Link>.</p>
      <form className="security-form" onReset={() => { setFile(null); setVerified(false); }} onSubmit={event => {
        event.preventDefault();
        if (file && verified) void run(() => importSrp(file));
      }}>
        <label>SRP workbook (.xlsx or .xls)<input type="file" accept=".xlsx,.xls" required onChange={event => {
          setFile(event.target.files?.[0] ?? null);
          setVerified(false);
        }} /></label>
        <label className="security-check"><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} required /> I verified the source and its prices.</label>
        <button className="admin-button" disabled={busy || !file || !verified}>Import Product SRP</button>
        <button className="admin-button secondary" type="reset" disabled={busy}>Clear selection</button>
      </form>
    </section>
    </>}
    {section === "audit" && data && <section className="admin-card">
      <h3>Security activity</h3>
      <p>Showing the latest {data.events?.length ?? 0} events.</p>
      <button className="admin-button small secondary" disabled={busy} onClick={() => void run(async () => { await load(); setAuditRefresh(value => value + 1); return "Audit log refreshed."; })}>Refresh log</button>
      <SecurityTable key={auditRefresh} label="Security activity" empty="No events recorded."
        headers={["Timestamp", "Account", "Current role", "Event", "Action", "Target", "Result", "Details"]}
        rows={(data.events ?? []).map(event => ({
          id: event.id,
          cells: [date(event.created_at), event.actor, event.current_role.replaceAll("_", " "), event.event_category,
            event.action, event.target_identifier, event.outcome, event.message],
        }))} />
    </section>}
  </div>;
}
