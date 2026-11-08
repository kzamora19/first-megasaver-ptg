"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { requestPtgAccounts, usesEdgeAccounts } from "@/lib/ptg/accounts-client";
import { getSecuritySection, securitySections, type SecuritySection } from "@/lib/ptg/security-sections";
import AccountAdministration from "./account-administration";

type Branch = { id: string; branch_code: string; branch_name: string; status: string; operational_status: string };
type Control = { control_key: string; enabled: boolean };
type Session = { id: string; branch_id: string; account: string; device_label: string; created_at: string; last_activity_at: string };
type Permission = { permission_key: string; label: string; scope_description: string };
type Grant = { role_key: string; permission_key: string; access_level: string };
type Audit = { id: string; created_at: string; actor: string; current_role: string; event_category: string; action: string; target_identifier: string; outcome: string; message: string };
type Result = { ok: boolean; message?: string; controls?: Control[]; branches?: Branch[]; sessions?: Session[]; catalog?: Permission[]; grants?: Grant[]; events?: Audit[]; allowed?: boolean; count?: number };

const date = (value: string) => new Date(value).toLocaleString();
const descriptions: Record<SecuritySection, string> = {
  master: "Manage availability across all branches.",
  branches: "Manage branches, branch accounts, and active sessions.",
  maintenance: "Temporarily restrict branch access during maintenance.",
  admins: "Manage System Admin accounts, invitations, and passwords.",
  permissions: "Review role permissions and test authorization for your current session.",
  srp: "Update the separate product SRP register from a verified Head Office workbook.",
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

function SecurityPanel({ section }: { section: SecuritySection }) {
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [verified, setVerified] = useState(false);
  const [accountRefresh, setAccountRefresh] = useState(0);
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
      await load();
      if (action === "securityBranch") setAccountRefresh(value => value + 1);
      return message;
    });
  }

  async function importSrp(selected: File) {
    if (selected.size > 15 * 1024 * 1024) throw new Error("The workbook exceeds 15 MB.");
    const { read, utils } = await import("xlsx");
    const workbook = read(await selected.arrayBuffer());
    const sheet = workbook.SheetNames.find(name => name.trim().toLowerCase() === "product master");
    if (!sheet) throw new Error("The workbook needs a Product Master worksheet.");
    const [headers = [], ...records] = utils.sheet_to_json<string[]>(workbook.Sheets[sheet], { header: 1, raw: false, defval: "", blankrows: false });
    const columns = headers.map(value => value.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
    const barcodeIndex = columns.findIndex(value => ["barcode", "itemcode"].includes(value));
    const descriptionIndex = columns.findIndex(value => ["modeldescription", "description", "itemname", "model"].includes(value));
    const srpIndex = columns.indexOf("srp");
    if ([barcodeIndex, descriptionIndex, srpIndex].includes(-1)) throw new Error("Use Barcode, Model / Description, and SRP columns.");
    if (!records.length || records.length > 10000) throw new Error("Use a workbook containing 1 to 10,000 product rows.");
    const seen = new Set<string>();
    const rows = records.map((row, index) => {
      const barcode = row[barcodeIndex].trim();
      const description = row[descriptionIndex].trim();
      const value = row[srpIndex].replace(/[₱,\s]/g, "");
      const srp = Number(value);
      if (!barcode || !description || !/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(srp) || seen.has(barcode)) {
        throw new Error("Check the barcode, description, and SRP in product row " + (index + 1) + ". Barcodes must be unique.");
      }
      seen.add(barcode);
      return { barcode, description, srp };
    });
    const result = await request("securityImportSrp", { source: selected.name, verified, rows });
    setVerified(false);
    return "Imported " + result.count + " SRP records.";
  }

  const branches = data?.branches ?? [];
  const masterOn = data?.controls?.find(row => row.control_key === "MASTER_SYSTEM")?.enabled ?? true;
  const maintenanceOn = data?.controls?.find(row => row.control_key === "MAINTENANCE_MODE")?.enabled ?? false;
  const status = !masterOn ? "System offline" : maintenanceOn ? "Maintenance active" : "System accessible";
  const isMaster = section === "master";
  const switchOn = isMaster ? masterOn : maintenanceOn;
  const needsData = section !== "admins" && section !== "srp";

  if (!usesEdgeAccounts) return <AccountAdministration role="SYSTEM_ADMIN" />;

  return <div className="security-panel">
    <h2>{securitySections.find(([key]) => key === section)?.[1]}</h2>
    {error && <p role="alert" className="security-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {needsData && !data && !error && <p role="status">Loading security information…</p>}
    {needsData && !data && error && <button className="admin-button" disabled={busy} onClick={() => void run(async () => { await load(); return ""; })}>Retry</button>}
    {data && (section === "master" || section === "maintenance") && <>
      <section className="admin-card">
        <h3>{status}</h3>
        <p>{isMaster ? "Master System overrides branch availability." : "Maintenance preserves branch settings."} System Admins retain access to restore service.</p>
        <div className="admin-actions">
          {[true, false].map(enabled => <button key={String(enabled)} className="admin-button secondary" type="button" aria-pressed={switchOn === enabled}
            disabled={busy || switchOn === enabled}
            onClick={() => {
              if (window.confirm("Turn " + (isMaster ? "Master System" : "Maintenance Mode") + (enabled ? " on?" : " off?"))) {
                mutate("securityControl", { key: isMaster ? "MASTER_SYSTEM" : "MAINTENANCE_MODE", enabled }, "Availability updated.");
              }
            }}>{enabled ? "On" : "Off"}</button>)}
        </div>
      </section>
      {isMaster && <section className="admin-card"><h3>Branch status summary</h3>
        <ul>{branches.filter(branch => branch.status === "ACTIVE").map(branch => <li key={branch.id}>
          {branch.branch_code} · {branch.branch_name} · {masterOn && !maintenanceOn && branch.operational_status === "ON" ? "Online" : "Offline"}
        </li>)}</ul></section>}
    </>}
    {section === "branches" && data && <>
      <section className="admin-card">
        <h3>Branch registry</h3>
        <form className="security-form" onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          mutate("securityBranch", { command: "add", code: fields.get("code"), name: fields.get("name") }, "Branch added.");
        }}>
          <label>Branch code<input name="code" required pattern="[A-Za-z0-9]{2,12}" maxLength={12} /></label>
          <label>Branch name<input name="name" required maxLength={120} /></label>
          <button className="admin-button" disabled={busy}>Add branch</button>
        </form>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Code</th><th>Branch</th><th>Status</th><th>Access</th><th>Actions</th></tr></thead>
          <tbody>{branches.map(branch => <tr key={branch.id}><td>{branch.branch_code}</td><td>{branch.branch_name}</td><td>{branch.status}</td><td>{branch.operational_status}</td><td>
            <div className="admin-actions">
              {(branch.status === "ACTIVE" ? [branch.operational_status === "ON" ? "off" : "on", "deactivate"] : ["reactivate"]).map(command =>
                <button key={command} className="admin-button small secondary" disabled={busy} onClick={() => {
                  if (window.confirm("Apply " + command + " to " + branch.branch_code + "?")) {
                    mutate("securityBranch", { command, branchId: branch.id }, "Branch updated.");
                  }
                }}>{command === "on" ? "Turn on" : command === "off" ? "Turn off" : command === "deactivate" ? "Deactivate" : "Reactivate"}</button>)}
            </div>
          </td></tr>)}</tbody></table></div>
      </section>
      <AccountAdministration key={accountRefresh} role="SYSTEM_ADMIN" scope="branch" />
      <section className="admin-card">
        <h3>Active branch sessions</h3>
        <button className="admin-button small secondary" disabled={busy} onClick={() => void run(async () => { await load(); return "Sessions refreshed."; })}>Refresh sessions</button>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Branch</th><th>Account</th><th>Device / browser</th><th>Login time</th><th>Last activity</th><th>Action</th></tr></thead>
          <tbody>{data.sessions?.length ? data.sessions.map(session => <tr key={session.id}>
            <td>{branches.find(branch => branch.id === session.branch_id)?.branch_code ?? "—"}</td><td>{session.account}</td><td>{session.device_label}</td><td>{date(session.created_at)}</td><td>{date(session.last_activity_at)}</td>
            <td><button className="admin-button small secondary" disabled={busy} onClick={() => {
              if (window.confirm("Sign out this session for " + session.account + "?")) mutate("securityRevokeSession", { sessionId: session.id }, "Session signed out.");
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
      <div className="admin-table-wrap"><table className="admin-table">
        <thead><tr><th>Permission</th><th>System Admin</th><th>Branch Admin</th><th>Branch User</th><th>Scope</th></tr></thead>
        <tbody>{data.catalog?.map(permission => <tr key={permission.permission_key}><td>{permission.label}</td>
          {["SYSTEM_ADMIN", "BRANCH_ADMIN", "BRANCH_USER"].map(role => <td key={role}>{data.grants?.find(grant => grant.role_key === role && grant.permission_key === permission.permission_key)?.access_level.replaceAll("_", " ") ?? "NONE"}</td>)}
          <td>{permission.scope_description}</td></tr>)}</tbody>
      </table></div>
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
    {section === "srp" && <section className="admin-card">
      <h3>Verify the source workbook</h3>
      <p>Use the current Head Office workbook. Import time records when PTG received the workbook. It cannot establish when the prices took effect.</p>
      <p>For product names, barcodes, and categories, open <Link className="admin-link" href="/product-master/">Product Master</Link>.</p>
      <form className="security-form" onReset={() => { setFile(null); setVerified(false); }} onSubmit={event => {
        event.preventDefault();
        if (file && verified) void run(() => importSrp(file));
      }}>
        <label>Product Master workbook (.xlsx or .xls)<input type="file" accept=".xlsx,.xls" required onChange={event => {
          setFile(event.target.files?.[0] ?? null);
          setVerified(false);
        }} /></label>
        <label className="security-check"><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} required /> I verified the source and its prices.</label>
        <button className="admin-button" disabled={busy || !file || !verified}>Import Product SRP</button>
        <button className="admin-button secondary" type="reset" disabled={busy}>Clear selection</button>
      </form>
    </section>}
    {section === "audit" && data && <section className="admin-card">
      <h3>Security activity</h3>
      <p>Showing the latest {data.events?.length ?? 0} events.</p>
      <button className="admin-button small secondary" disabled={busy} onClick={() => void run(async () => { await load(); return "Audit log refreshed."; })}>Refresh log</button>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Timestamp</th><th>Account</th><th>Current role</th><th>Event</th><th>Action</th><th>Target</th><th>Result</th><th>Details</th></tr></thead>
        <tbody>{data.events?.length ? data.events.map(event => <tr key={event.id}><td>{date(event.created_at)}</td><td>{event.actor}</td><td>{event.current_role.replaceAll("_", " ")}</td><td>{event.event_category}</td><td>{event.action}</td><td>{event.target_identifier}</td><td>{event.outcome}</td><td>{event.message}</td></tr>) : <tr><td colSpan={8}>No events recorded.</td></tr>}</tbody>
      </table></div>
    </section>}
  </div>;
}
