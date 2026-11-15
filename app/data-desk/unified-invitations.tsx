"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPtgAppSessionId } from "@/lib/ptg/auth-client";

type SalesAdminScope = {
  scope: { userId: string; branches: { id: string; name: string; code: string }[] };
  client: SupabaseClient;
};
type Draft = {
  id: string; full_name: string; email: string; login_id: string;
  job_title: string; sales_role: string; ptg_role: string | null;
  branch_id: string | null; created_at: string; status: "DRAFT";
};
type JobTitle = "PRODUCT_SPECIALIST" | "TEAM_LEADER" | "BRANCH_MANAGER" |
  "DISTRICT_MANAGER" | "INVENTORY_CONTROLLER" | "STOCK_CUSTODIAN";
const roles: { value: JobTitle; label: string; salesRole: string; canPtg: boolean }[] = [
  { value: "PRODUCT_SPECIALIST", label: "Product Specialist", salesRole: "ps", canPtg: false },
  { value: "TEAM_LEADER", label: "Team Leader", salesRole: "ps", canPtg: true },
  { value: "BRANCH_MANAGER", label: "Branch Manager", salesRole: "manager", canPtg: true },
  { value: "DISTRICT_MANAGER", label: "District Manager", salesRole: "district_manager", canPtg: false },
  { value: "INVENTORY_CONTROLLER", label: "Inventory Controller", salesRole: "inventory_controller", canPtg: false },
  { value: "STOCK_CUSTODIAN", label: "Stock Custodian", salesRole: "stock_custodian", canPtg: false },
];
const eligiblePtg = (role: JobTitle) => roles.find(item => item.value === role)?.canPtg === true;

export default function UnifiedInvitations({
  verifyPtg, verifySales,
}: {
  verifyPtg: (sessionId: string) => Promise<void>;
  verifySales: () => Promise<SalesAdminScope>;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [branches, setBranches] = useState<SalesAdminScope["scope"]["branches"]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loginId, setLoginId] = useState("");
  const [jobTitle, setJobTitle] = useState<JobTitle>("TEAM_LEADER");
  const [branchId, setBranchId] = useState("");
  const [brand, setBrand] = useState("");
  const [salespersonCode, setSalespersonCode] = useState("");
  const [ptgRole, setPtgRole] = useState<string>("TEAM_LEADER");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  // The current projects still have independent sessions. Both administrators
  // must be verified for this limited DRAFT workflow until central SSO exists.
  const checkAdmin = useCallback(async () => {
    const sessionId = getPtgAppSessionId();
    if (!sessionId) throw Error("Sign in to PTG as System Admin first.");
    await verifyPtg(sessionId);
    const sales = await verifySales();
    const { data: person, error: profileError } = await sales.client.from("profiles")
      .select("dealer_id,active,role").eq("id", sales.scope.userId).single();
    if (profileError || person?.role !== "admin" || person.active !== true ||
        typeof person.dealer_id !== "string") {
      throw Error("A verified Sales Tracker administrator is required.");
    }
    return { ...sales, dealerId: person.dealer_id as string };
  }, [verifyPtg, verifySales]);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const verified = await checkAdmin();
      const { data, error: queryError } = await verified.client
        .from("unified_invitation_drafts")
        .select("id,full_name,email,login_id,job_title,sales_role,ptg_role,branch_id,created_at,status")
        .eq("dealer_id", verified.dealerId).order("created_at", { ascending: false }).limit(100);
      if (queryError) throw Error("Invitation draft storage is not available: " + queryError.message);
      setDrafts((data ?? []) as Draft[]);
      setBranches(verified.scope.branches);
      setBranchId(current => current || verified.scope.branches[0]?.id || "");
      setReady(true);
    } catch (cause) {
      setReady(false);
      setError(cause instanceof Error ? cause.message : "Unable to verify account access.");
    }
  }, [checkAdmin]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(""); setMessage(""); setBusy(true);
    try {
      const verified = await checkAdmin();
      const title = roles.find(role => role.value === jobTitle)!;
      const targetPtgRole = eligiblePtg(jobTitle) ? ptgRole || null : null;
      if (!name.trim() || !email.trim() || !loginId.trim()) throw Error("Employee name, email, and login ID are required.");
      if (title.salesRole === "ps" && (!brand.trim() || !salespersonCode.trim())) {
        throw Error("Sales Tracker requires a brand and salesperson code for PS/Team Leader records.");
      }
      if (jobTitle !== "DISTRICT_MANAGER" && !branchId) throw Error("Choose a branch.");
      const normalizedEmail = email.trim().toLowerCase();
      // This creates a record only. It never creates Supabase Auth users,
      // sends invitation emails, or writes app permission grants.
      const { error: writeError } = await verified.client.from("unified_invitation_drafts").insert({
        dealer_id: verified.dealerId,
        created_by: verified.scope.userId,
        full_name: name.trim(), email: normalizedEmail,
        login_id: loginId.trim(), job_title: jobTitle,
        sales_role: title.salesRole,
        branch_id: jobTitle === "DISTRICT_MANAGER" ? null : branchId,
        assigned_brand: title.salesRole === "ps" ? brand.trim() : null,
        salesperson_code: title.salesRole === "ps" ? salespersonCode.trim() : null,
        ptg_role: targetPtgRole,
        status: "DRAFT",
      });
      if (writeError) throw Error(writeError.code === "23505"
        ? "A draft for this email already exists. Review it instead of creating a duplicate."
        : writeError.message);
      setName(""); setEmail(""); setLoginId(""); setBrand(""); setSalespersonCode("");
      setMessage("Invitation draft saved. No email was sent, and no user account was created.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save draft.");
    } finally { setBusy(false); }
  }

  async function removeDraft(draft: Draft) {
    if (!window.confirm("Discard this invitation draft? No employee account will be affected.")) return;
    setError(""); setMessage(""); setBusy(true);
    try {
      const verified = await checkAdmin();
      const { error: deleteError } = await verified.client.from("unified_invitation_drafts")
        .delete().eq("id", draft.id).eq("dealer_id", verified.dealerId);
      if (deleteError) throw Error(deleteError.message);
      setMessage("Draft discarded. No accounts were changed.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to discard draft.");
    } finally { setBusy(false); }
  }

  return <main className="ptg-main shell admin-shell">
    <section className="hero admin-hero">
      <p className="eyebrow">BRANCHLINE DATA DESK • ACCOUNT ADMINISTRATION</p>
      <h1>Unified Invitations</h1>
      <p className="intro">Prepare one new-employee identity and choose which applications it should access.</p>
    </section>
    <section className="admin-card">
      <h2>New-user invitations — draft phase</h2>
      <p className="admin-muted">Invitations are not yet being sent. Shared sign-in requires the Sales Tracker identity-provider and PTG OAuth connection to be configured and security-tested. Existing accounts remain unchanged.</p>
      {error && <p className="admin-alert error" role="alert">{error}</p>}
      {message && <p role="status" className="admin-alert success">{message}</p>}
      <button className="admin-button" type="button" onClick={() => void refresh()} disabled={busy}>Refresh invitation drafts</button>
      {ready && <form className="admin-form" onSubmit={event => void save(event)}>
        <label>Employee full name<input required value={name} maxLength={140} onChange={event => setName(event.target.value)} /></label>
        <label>Work email<input required type="email" value={email} maxLength={254} onChange={event => setEmail(event.target.value)} /></label>
        <label>Login ID<input required value={loginId} maxLength={80} onChange={event => setLoginId(event.target.value)} /></label>
        <label>Position<select value={jobTitle} onChange={event => {
          const title = event.target.value as JobTitle;
          setJobTitle(title);
          setPtgRole(title === "TEAM_LEADER" ? "TEAM_LEADER" : title === "BRANCH_MANAGER" ? "BRANCH_MANAGER" : "");
        }}>{roles.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
        {jobTitle !== "DISTRICT_MANAGER" && <label>Branch<select value={branchId} required
          onChange={event => setBranchId(event.target.value)}>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code || branch.name} — {branch.name}</option>)}
        </select></label>}
        {roles.find(role => role.value === jobTitle)?.salesRole === "ps" && <>
          <label>Assigned brand<input required value={brand} onChange={event => setBrand(event.target.value)} /></label>
          <label>Salesperson code<input required value={salespersonCode} onChange={event => setSalespersonCode(event.target.value)} /></label>
        </>}
        <label>Sales Tracker access<input readOnly value={roles.find(role => role.value === jobTitle)?.label || ""} /></label>
        <label>PTG access
          <select value={eligiblePtg(jobTitle) ? ptgRole : ""} disabled={!eligiblePtg(jobTitle)}
            onChange={event => setPtgRole(event.target.value)}>
            <option value="">No PTG access</option>
            {jobTitle === "TEAM_LEADER" && <option value="TEAM_LEADER">Team Leader</option>}
            {jobTitle === "BRANCH_MANAGER" && <>
              <option value="BRANCH_MANAGER">Branch Manager</option>
              <option value="BRANCH_ADMIN">Branch Admin</option>
            </>}
          </select>
        </label>
        <p className="admin-muted">Permissions are proposals only. PTG branch mapping and unified credentials will be validated before activation.</p>
        <button className="admin-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save invitation draft"}</button>
      </form>}
    </section>
    <section className="admin-card">
      <h2>Invitation drafts</h2>
      {!ready ? <p className="admin-muted">Verify both current administrator sessions to view drafts.</p> :
      drafts.length === 0 ? <p className="admin-muted">No new-user invitation drafts yet.</p> :
      <div className="admin-table-wrap"><table className="admin-table">
        <thead><tr><th>Employee</th><th>Login</th><th>Position</th><th>PTG grant</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{drafts.map(draft => <tr key={draft.id}>
          <td>{draft.full_name}<small>{draft.email}</small></td>
          <td>{draft.login_id}</td><td>{roles.find(role => role.value === draft.job_title)?.label ?? draft.job_title}</td>
          <td>{draft.ptg_role?.replaceAll("_", " ") ?? "None"}</td>
          <td>{draft.status} · Not sent</td>
          <td><button type="button" disabled={busy} onClick={() => void removeDraft(draft)}>Discard draft</button></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </main>;
}
