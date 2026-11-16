"use client";

import { useRef, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requestPtgAccounts } from "@/lib/ptg/accounts-client";
import { setupWorkspaceBranch } from "@/lib/ptg/workspace-branch-plan.mjs";

type Branch = { id: string; name: string; code: string | null; district_id: string };
type District = { id: string; name: string };
type PtgBranch = { id: string; branch_code: string; branch_name: string; status: string; operational_status: string };

export default function WorkspaceBranches({ tracker, ready, branches, districts, ptgBranches, onUpdated }: {
  tracker: () => SupabaseClient; ready: boolean; branches: Branch[]; districts: District[]; ptgBranches: PtgBranch[];
  onUpdated: (sales: Branch[], ptg: PtgBranch[]) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [district, setDistrict] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const running = useRef(false);
  const ptgOnly = ptgBranches.filter(b => !branches.some(s => s.code?.toUpperCase() === b.branch_code.toUpperCase()));

  async function loadFresh() {
    const client = tracker();
    const { data: stored } = await client.auth.getSession();
    if (!stored.session?.access_token) throw Error("Sign in to Sales Tracker as an administrator first.");
    const { data: user, error: userError } = await client.auth.getUser(stored.session.access_token);
    if (userError || !user.user) throw Error("The Sales Tracker session has expired.");
    const { data: profile, error: profileError } = await client.from("profiles").select("role,active,dealer_id").eq("id", user.user.id).maybeSingle();
    if (profileError || !profile?.active || profile.role !== "admin" || !profile.dealer_id) throw Error("An active Sales Tracker administrator is required.");
    const [sales, ptgResponse] = await Promise.all([
      client.from("branches").select("id,name,code,district_id").eq("dealer_id", profile.dealer_id).order("name"),
      requestPtgAccounts("GET"),
    ]);
    const ptgData = await ptgResponse.json();
    if (sales.error || !ptgResponse.ok || !ptgData.ok || !Array.isArray(ptgData.branches)) throw Error("Both branch lists could not be verified.");
    return { client, sales: (sales.data ?? []) as Branch[], ptg: ptgData.branches as PtgBranch[] };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (running.current) return;
    running.current = true;
    setBusy(true); setFailed(false); setMessage("");
    try {
      const result = await setupWorkspaceBranch({ code, name, districtId: district }, {
        load: loadFresh,
        createSales: async (current: Awaited<ReturnType<typeof loadFresh>>, plan: { districtId: string; name: string; code: string }) => {
          const { error } = await current.client.rpc("create_branch", { p_district_id: plan.districtId, p_name: plan.name, p_code: plan.code });
          if (error) throw Error("Sales Tracker could not confirm branch creation: " + error.message);
        },
        createPtg: async (_current: Awaited<ReturnType<typeof loadFresh>>, plan: { name: string; code: string }) => {
          const response = await requestPtgAccounts("POST", { action: "securityBranch", command: "add", code: plan.code, name: plan.name });
          const data = await response.json();
          if (!response.ok || !data.ok) throw Error("PTG could not confirm branch creation: " + (data.message || "Check the branch list."));
        },
      });
      if (result.current) onUpdated(result.current.sales, result.current.ptg.filter((b: PtgBranch) => b.status === "ACTIVE" && b.operational_status === "ON"));
      if (!result.ok) {
        setFailed(true);
        setMessage((result.message || "Branch setup could not be completed.") + (result.started ? " Check both branch lists before trying again; one app may already have created it." : ""));
      } else {
        setMessage(result.alreadyExists ? "This branch already exists in both apps." : "The branch is available in both Sales Tracker and PTG.");
        if (!result.alreadyExists) { setCode(""); setName(""); setDistrict(""); }
      }
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Branch setup could not be completed.");
    } finally { running.current = false; setBusy(false); }
  }

  return <details className="admin-card workspace-branch-setup">
    <summary>Set up a branch in both apps</summary>
    <p className="admin-muted">Add a new branch to both apps or add a PTG branch to Sales Tracker. Choose its Sales Tracker district.</p>
    {!ready && <p className="admin-muted">Sign in to Sales Tracker as an administrator to set up branches.</p>}
    <form className="admin-form" onSubmit={event => void submit(event)}>
      {ptgOnly.length > 0 && <label>Existing PTG branch (optional)<select defaultValue="" disabled={!ready || busy} onChange={e => {
        const branch = ptgOnly.find(item => item.id === e.target.value);
        if (branch) { setCode(branch.branch_code); setName(branch.branch_name); }
      }}><option value="">Enter a new branch instead</option>{ptgOnly.map(b => <option key={b.id} value={b.id}>{b.branch_code} — {b.branch_name}</option>)}</select></label>}
      <label>Branch code<input required pattern="[A-Za-z][A-Za-z0-9]{1,9}" maxLength={10} disabled={!ready || busy} value={code} onChange={e => setCode(e.target.value)} /></label>
      <label>Branch name<input required maxLength={120} disabled={!ready || busy} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Sales Tracker district<select required disabled={!ready || busy} value={district} onChange={e => setDistrict(e.target.value)}><option value="">Choose district</option>{districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <div className="workspace-branch-submit"><button className="admin-button" disabled={!ready || busy}>{busy ? "Setting up…" : "Set up branch"}</button></div>
    </form>
    {message && <p role={failed ? "alert" : "status"} className={"admin-alert " + (failed ? "error" : "success")}>{message}</p>}
    <style jsx>{`
      .workspace-branch-setup { margin-bottom: 18px; }
      .workspace-branch-setup summary { cursor: pointer; font-size: 16px; font-weight: 800; color: #164a8a; }
      .workspace-branch-setup .admin-form { margin-top: 16px; }
      .workspace-branch-submit { display: flex; align-items: end; }
    `}</style>
  </details>;
}

