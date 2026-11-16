"use client";

import { useEffect, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requestPtgAccounts } from "@/lib/ptg/accounts-client";
import { validateWorkspaceInvitations } from "@/lib/ptg/workspace-invitation-validation.mjs";
import { withBasePath } from "@/lib/base-path";
import WorkspaceBranches from "./workspace-branches";

type Branch = { id: string; name: string; code: string | null; district_id: string };
type District = { id: string; name: string };
type PtgBranch = { id: string; branch_code: string; branch_name: string; status: string; operational_status: string };
type Person = { id: number; fullName: string; email: string; useSales: boolean; usePtg: boolean; salesRole: string; login: string; brand: string; districtId: string; branchId: string; branchIds: string[]; ptgRole: string; username: string; ptgBranchId: string; title: string; result?: string };
const newPerson = (id: number): Person => ({ id, fullName: "", email: "", useSales: true, usePtg: true, salesRole: "ps", login: "", brand: "", districtId: "", branchId: "", branchIds: [], ptgRole: "BRANCH_USER", username: "", ptgBranchId: "", title: "BRANCH USER" });
let salesClient: SupabaseClient | undefined;
function tracker() {
  const url = process.env.NEXT_PUBLIC_SALES_TRACKER_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SALES_TRACKER_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Sales Tracker is not configured.");
  return salesClient ??= createClient(url, key, { auth: { detectSessionInUrl: false, autoRefreshToken: false, storage: {
    getItem: n => sessionStorage.getItem(n) ?? localStorage.getItem(n),
    setItem: (n, v) => { (sessionStorage.getItem(n) !== null ? sessionStorage : localStorage).setItem(n, v); },
    removeItem: n => { sessionStorage.removeItem(n); localStorage.removeItem(n); },
  } } });
}

export default function WorkspaceInvitations() {
  const [people, setPeople] = useState<Person[]>([newPerson(1)]);
  const [ptgBranches, setPtgBranches] = useState<PtgBranch[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [salesReady, setSalesReady] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const nextId = useRef(2);
  const update = (id: number, patch: Partial<Person>) => setPeople(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const response = await requestPtgAccounts("GET");
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error("Unable to load PTG branches.");
        if (live) setPtgBranches((data.branches ?? []).filter((b: PtgBranch) => b.status === "ACTIVE" && b.operational_status === "ON"));
      } catch (e) { if (live) setMessage(e instanceof Error ? e.message : "Unable to load PTG branches."); }
      try {
        const client = tracker();
        const { data: session } = await client.auth.getSession();
        if (!session.session?.access_token) return;
        const { data: user } = await client.auth.getUser(session.session.access_token);
        if (!user.user) return;
        const { data: profile } = await client.from("profiles").select("role,active,dealer_id").eq("id", user.user.id).maybeSingle();
        if (!profile?.active || profile.role !== "admin" || !profile.dealer_id) return;
        const [d, b] = await Promise.all([
          client.from("districts").select("id,name").eq("dealer_id", profile.dealer_id).order("name"),
          client.from("branches").select("id,name,code,district_id").eq("dealer_id", profile.dealer_id).order("name"),
        ]);
        if (d.error || b.error) return;
        if (live) { setDistricts(d.data ?? []); setBranches(b.data ?? []); setSalesReady(true); }
      } catch { /* PTG-only invitations remain available. */ }
    }
    void load();
    return () => { live = false; };
  }, []);

  async function send() {
    if (running.current) return;
    const pending = people.filter(p => !p.result);
    if (!pending.length) return;
    const inputs = pending.map(p => ({ fullName: p.fullName, email: p.email,
      sales: p.useSales ? { role: p.salesRole, login: p.login, salespersonCode: p.salesRole === "ps" ? p.login : "", brand: p.brand, districtId: p.districtId, branchId: p.branchId, branchIds: p.branchIds } : null,
      ptg: p.usePtg ? { role: p.ptgRole, username: p.username, title: p.title, branchId: p.ptgBranchId } : null }));
    const checked = validateWorkspaceInvitations(inputs);
    if (!checked.valid) { setMessage(checked.rows.map((r: { errors: string[] }, i: number) => r.errors.length ? `Person ${i + 1}: ${r.errors.join(" ")}` : "").filter(Boolean).join(" ") || checked.errors.join(" ")); return; }
    if (pending.some(p => p.useSales) && !salesReady) { setMessage("Sign in to Sales Tracker as an administrator in this browser, then reopen this page."); return; }
    running.current = true; setBusy(true); setMessage("");
    try {
      for (const p of pending) {
        try {
          let salesToken = "";
          if (p.useSales) {
            const { data } = await tracker().auth.getSession();
            salesToken = data.session?.access_token ?? "";
            if (!salesToken) throw new Error("Sales Tracker session expired. No account was created for this person.");
          }
          const response = await requestPtgAccounts("POST", { action: "workspaceInvite", displayName: p.fullName, email: p.email,
            salesToken, salesKey: process.env.NEXT_PUBLIC_SALES_TRACKER_SUPABASE_PUBLISHABLE_KEY,
            sales: p.useSales ? { role: p.salesRole, login: p.login, salesperson_code: p.salesRole === "ps" ? p.login : "", brand: p.brand, district_id: p.districtId, branch_id: p.branchId, branch_ids: p.branchIds } : null,
            ptg: p.usePtg ? { username: p.username, role: p.ptgRole, legacyRole: p.title, branchId: p.ptgBranchId } : null });
          const data = await response.json();
          update(p.id, { result: data.message || (response.ok ? "Invitation sent." : "Could not complete. Check account records before trying again.") });
        } catch (e) { update(p.id, { result: e instanceof Error && e.message.includes("session expired") ? e.message : "Result could not be confirmed. Check accounts and email before trying again." }); }
      }
    } finally { running.current = false; setBusy(false); }
  }
  return <main className="ptg-main shell admin-shell invitations-page">
    <section className="hero admin-hero">
      <p className="eyebrow">BRANCHLINE DATA DESK · ACCOUNT ADMINISTRATION</p>
      <h1>User Administration</h1>
      <p className="intro">Invite people to Sales Tracker, Price Tag Generator, or both. Each person receives one email for their selected apps.</p>
    </section>
    {!salesReady && <p className="admin-alert invitations-notice">For Sales Tracker access, sign in to Sales Tracker as an administrator in this browser, then reopen this page. PTG-only invitations are available without it.</p>}
    <WorkspaceBranches tracker={tracker} ready={salesReady} branches={branches} districts={districts} ptgBranches={ptgBranches}
      onUpdated={(sales, ptg) => { setBranches(sales); setPtgBranches(ptg); }} />
    <div className="invitation-list">{people.map((p, index) => <section className="admin-card invitation-card" key={p.id}>
      <div className="invitation-card-heading"><div><h2>Person {index + 1}</h2><p className="admin-muted">Enter their details and choose their app access.</p></div>
        {people.length > 1 && !busy && <button className="admin-button small secondary" type="button" onClick={() => setPeople(rows => rows.filter(row => row.id !== p.id))}>Remove person</button>}
      </div>
      <fieldset className="invitation-fields" disabled={busy || !!p.result}>
        <div className="admin-form">
          <label>Employee full name<input autoComplete="name" value={p.fullName} onChange={e => update(p.id, { fullName: e.target.value })} /></label>
          <label>Work email<input type="email" autoComplete="email" value={p.email} onChange={e => update(p.id, { email: e.target.value })} /></label>
        </div>
        <div className="invitation-section"><h3>App access</h3><p className="admin-muted">Select the apps this person needs.</p>
          <div className="invitation-apps"><label className="invitation-choice"><input type="checkbox" checked={p.useSales} onChange={e => update(p.id, { useSales: e.target.checked })} /> Sales Tracker</label>
            <label className="invitation-choice"><input type="checkbox" checked={p.usePtg} onChange={e => update(p.id, { usePtg: e.target.checked })} /> Price Tag Generator</label></div>
        </div>
        {p.useSales && <div className="invitation-section"><h3>Sales Tracker access</h3><div className="admin-form">
          <label>Role<select value={p.salesRole} onChange={e => update(p.id, { salesRole: e.target.value, branchId: "", branchIds: [] })}>
            <option value="ps">Product Specialist</option><option value="manager">Branch Manager</option><option value="district_manager">District Manager</option><option value="inventory_controller">Inventory Controller</option><option value="stock_custodian">Stock Custodian</option></select></label>
          <label>{p.salesRole === "ps" ? "Salesperson code" : "Login ID"}<input value={p.login} onChange={e => update(p.id, { login: e.target.value })} /></label>
          {p.salesRole === "ps" && <label>Assigned brand<input value={p.brand} onChange={e => update(p.id, { brand: e.target.value })} /></label>}
          {!['inventory_controller', 'stock_custodian'].includes(p.salesRole) ? <><label>District<select value={p.districtId} onChange={e => update(p.id, { districtId: e.target.value, branchId: "" })}><option value="">Choose district</option>{districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            {p.salesRole !== "district_manager" && <label>Branch<select value={p.branchId} onChange={e => update(p.id, { branchId: e.target.value })}><option value="">Choose branch</option>{branches.filter(b => b.district_id === p.districtId).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}</> :
            <div className="invitation-branches"><label>Assigned branches<select value="" onChange={e => {
              const id = e.target.value;
              if (id && !p.branchIds.includes(id)) update(p.id, { branchIds: [...p.branchIds, id] });
            }}><option value="">Choose a branch to add</option>{branches.filter(b => !p.branchIds.includes(b.id)).map(b => <option key={b.id} value={b.id}>{b.code ? b.code + " — " : ""}{b.name}</option>)}</select></label>
              <p className="admin-muted">Choose each branch this person can access.</p>
              {p.branchIds.length > 0 && <div className="invitation-selected" aria-label="Selected branches">{p.branchIds.map(id => {
                const branch = branches.find(item => item.id === id);
                return <span className="invitation-selected-branch" key={id}>{branch?.name ?? "Selected branch"}<button type="button" aria-label={"Remove " + (branch?.name ?? "branch")} onClick={() => update(p.id, { branchIds: p.branchIds.filter(value => value !== id) })}>×</button></span>;
              })}</div>}
              {salesReady && ptgBranches.some(b => !branches.some(s => s.code?.toUpperCase() === b.branch_code.toUpperCase())) && <p className="admin-muted">This list uses Sales Tracker branches. Branches available only in PTG must first be added to Sales Tracker.</p>}
            </div>}
        </div></div>}
        {p.usePtg && <div className="invitation-section"><h3>Price Tag Generator access</h3><div className="admin-form">
          <label>Username<input value={p.username} onChange={e => update(p.id, { username: e.target.value })} /></label>
          <label>Title<select value={p.title} onChange={e => update(p.id, { title: e.target.value, ptgRole: ["BRANCH ADMIN", "BRANCH MANAGER"].includes(e.target.value) ? "BRANCH_ADMIN" : "BRANCH_USER" })}><option value="BRANCH USER">Branch User</option><option value="TEAM LEADER">Team Leader</option><option value="BRANCH ADMIN">Branch Admin</option><option value="BRANCH MANAGER">Branch Manager</option></select></label>
          <label>Branch<select value={p.ptgBranchId} onChange={e => update(p.id, { ptgBranchId: e.target.value })}><option value="">Choose branch</option>{ptgBranches.map(b => <option key={b.id} value={b.id}>{b.branch_code} — {b.branch_name}</option>)}</select></label>
        </div></div>}
      </fieldset>
      {p.result && <p className="admin-alert invitations-notice" role="status">{p.result}</p>}
    </section>)}</div>
    {message && <p className="admin-alert error" role="alert">{message}</p>}
    <div className="invitation-actions"><button type="button" className="admin-button secondary" disabled={busy} onClick={() => setPeople(rows => [...rows, newPerson(nextId.current++)])}>+ Add another person</button>
      <button type="button" className="admin-button" disabled={busy || !people.some(p => !p.result)} onClick={() => void send()}>{busy ? "Preparing invitations…" : "Send invitations"}</button></div>
    <p className="invitations-drafts"><a className="admin-link" href={withBasePath("/data-desk/?mode=invitation-drafts")}>View saved invitation drafts</a></p>
    <style jsx>{`
      .invitations-page .admin-hero { margin-bottom: 20px; }
      .invitation-list { display: grid; gap: 18px; }
      .invitation-card-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
      .invitation-card-heading h2 { margin: 0 0 5px; }
      .invitation-card-heading p, .invitation-section p { margin: 0; }
      .invitation-fields { border: 0; padding: 0; margin: 0; min-width: 0; }
      .invitation-section { margin-top: 24px; padding-top: 20px; border-top: 1px solid #e3eaf2; }
      .invitation-section h3 { margin: 0 0 6px; font-size: 16px; }
      .invitation-section .admin-form { margin-top: 14px; }
      .invitation-apps { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
      .invitation-choice { display: inline-flex; align-items: center; gap: 9px; padding: 10px 12px; border: 1px solid #d8e3ef; border-radius: 8px; color: #234468; font-size: 13px; font-weight: 700; }
      .invitation-choice input { width: 17px; height: 17px; margin: 0; accent-color: #164a8a; }
      .invitation-branches { min-width: 0; grid-column: 1 / -1; }
      .invitation-branches > label { max-width: calc(50% - 8px); }
      .invitation-branches > p { margin: 8px 0 0; }
      .invitation-selected { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .invitation-selected-branch { display: inline-flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; border: 1px solid #c7d9ee; border-radius: 8px; background: #f4f8fd; color: #234468; font-size: 13px; font-weight: 700; }
      .invitation-selected-branch button { border: 0; padding: 0 3px; background: transparent; color: #234468; font-size: 20px; cursor: pointer; }
      .invitation-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
      .invitations-notice { background: #eef5fd; color: #294b70; }
      .invitations-drafts { margin: 24px 0; }
      @media (max-width: 760px) { .invitation-card-heading { flex-direction: column; } .invitation-actions > button { flex: 1 1 100%; } .invitation-branches > label { max-width: none; } }
    `}</style>
  </main>;
}

