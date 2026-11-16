"use client";

import { useEffect, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requestPtgAccounts } from "@/lib/ptg/accounts-client";
import { validateWorkspaceInvitations } from "@/lib/ptg/workspace-invitation-validation.mjs";
import { withBasePath } from "@/lib/base-path";

type Branch = { id: string; name: string; district_id: string };
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
          client.from("branches").select("id,name,district_id").eq("dealer_id", profile.dealer_id).order("name"),
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
  return <main className="ptg-main"><h1>User Administration</h1>
    <p>Invite one or more people to Sales Tracker, Price Tag Generator, or both. Each person receives one email with the access selected for them.</p>
    <p><a href={withBasePath("/data-desk/?mode=invitation-drafts")}>View existing invitation drafts</a></p>
    {!salesReady && <p className="admin-muted">For Sales Tracker access, sign in to Sales Tracker as an administrator in this browser, then reopen this page. PTG-only invitations are available without it.</p>}
    {people.map((p, index) => <section className="admin-card" key={p.id}>
      <h2>Person {index + 1}</h2><fieldset disabled={busy || !!p.result}>
        <p><label>Full name <input value={p.fullName} onChange={e => update(p.id, { fullName: e.target.value })} /></label></p>
        <p><label>Email <input type="email" value={p.email} onChange={e => update(p.id, { email: e.target.value })} /></label></p>
        <p><label><input type="checkbox" checked={p.useSales} onChange={e => update(p.id, { useSales: e.target.checked })} /> Sales Tracker</label>{" "}
        <label><input type="checkbox" checked={p.usePtg} onChange={e => update(p.id, { usePtg: e.target.checked })} /> Price Tag Generator</label></p>
        {p.useSales && <div><h3>Sales Tracker access</h3>
          <p><label>Role <select value={p.salesRole} onChange={e => update(p.id, { salesRole: e.target.value, branchId: "", branchIds: [] })}>
            <option value="ps">Product Specialist</option><option value="manager">Branch Manager</option><option value="district_manager">District Manager</option><option value="inventory_controller">Inventory Controller</option><option value="stock_custodian">Stock Custodian</option></select></label></p>
          <p><label>{p.salesRole === "ps" ? "Salesperson code" : "Login ID"} <input value={p.login} onChange={e => update(p.id, { login: e.target.value })} /></label></p>
          {p.salesRole === "ps" && <p><label>Brand <input value={p.brand} onChange={e => update(p.id, { brand: e.target.value })} /></label></p>}
          {!['inventory_controller', 'stock_custodian'].includes(p.salesRole) ? <><p><label>District <select value={p.districtId} onChange={e => update(p.id, { districtId: e.target.value, branchId: "" })}><option value="">Choose district</option>{districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label></p>
            {p.salesRole !== "district_manager" && <p><label>Branch <select value={p.branchId} onChange={e => update(p.id, { branchId: e.target.value })}><option value="">Choose branch</option>{branches.filter(b => b.district_id === p.districtId).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label></p>}</> :
            <fieldset><legend>Assigned branches</legend>{branches.map(b => <label key={b.id} style={{ display: "block" }}><input type="checkbox" checked={p.branchIds.includes(b.id)} onChange={e => update(p.id, { branchIds: e.target.checked ? [...p.branchIds, b.id] : p.branchIds.filter(id => id !== b.id) })} /> {b.name}</label>)}</fieldset>}
        </div>}
        {p.usePtg && <div><h3>Price Tag Generator access</h3>
          <p><label>Username <input value={p.username} onChange={e => update(p.id, { username: e.target.value })} /></label></p>
          <p><label>Title <select value={p.title} onChange={e => update(p.id, { title: e.target.value, ptgRole: ["BRANCH ADMIN", "BRANCH MANAGER"].includes(e.target.value) ? "BRANCH_ADMIN" : "BRANCH_USER" })}><option value="BRANCH USER">Branch User</option><option value="TEAM LEADER">Team Leader</option><option value="BRANCH ADMIN">Branch Admin</option><option value="BRANCH MANAGER">Branch Manager</option></select></label></p>
          <p><label>Branch <select value={p.ptgBranchId} onChange={e => update(p.id, { ptgBranchId: e.target.value })}><option value="">Choose branch</option>{ptgBranches.map(b => <option key={b.id} value={b.id}>{b.branch_code} — {b.branch_name}</option>)}</select></label></p>
        </div>}
      </fieldset>
      {p.result && <p role="status"><strong>{p.result}</strong></p>}
      {people.length > 1 && !busy && <button type="button" onClick={() => setPeople(rows => rows.filter(row => row.id !== p.id))}>Remove person</button>}
    </section>)}
    {message && <p role="alert">{message}</p>}
    <p><button type="button" disabled={busy} onClick={() => setPeople(rows => [...rows, newPerson(nextId.current++)])}>Add another person</button>{" "}
      <button type="button" className="admin-button" disabled={busy || !people.some(p => !p.result)} onClick={() => void send()}>{busy ? "Preparing invitations…" : "Send invitations"}</button></p>
  </main>;
}

