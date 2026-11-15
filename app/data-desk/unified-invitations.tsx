"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requestPtgAccounts } from "@/lib/ptg/accounts-client";
import { invokePtgData } from "@/lib/ptg/edge-api";
import { getPtgAppSessionId } from "@/lib/ptg/auth-client";
import {
  matchUnifiedBranches, validateUnifiedInvitation,
} from "@/lib/ptg/unified-invitation-rules.mjs";

// Phase 1 deliberately does NOT create employees or send invitations.
// It verifies that the operator has independent admin access to both
// existing applications, maps branch codes, and reviews app entitlements.
type SalesBranch = { id: string; name: string; code: string; dealer_id: string; district_id: string };
type PtgBranch = { id: string; branch_code: string; branch_name: string; status: string; operational_status: string };
type Account = { email?: string | null; display_name?: string };
type Match = { code: string; salesBranchId: string; salesDistrictId: string; salesDealerId: string; ptgBranchId: string; name: string };
type SalesVerification = {
  scope: { userId: string; branches: Array<{ id: string; name: string; code: string }> };
  client: SupabaseClient;
};

export default function UnifiedInvitations({
  verifyPtg, verifySales,
}: {
  verifyPtg: (sessionId: string) => Promise<void>;
  verifySales: () => Promise<SalesVerification>;
}) {
  const [branches, setBranches] = useState<Match[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [salesClient, setSalesClient] = useState<SalesVerification["client"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState("");
  const [review, setReview] = useState<Record<string, unknown> | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingSalesId, setPendingSalesId] = useState("");
  const [invitationStatus, setInvitationStatus] = useState("");
  // Never enable live account creation until both projects' schema,
  // identity broker, acceptance, and revocation tests have passed.
  const enabled = process.env.NEXT_PUBLIC_UNIFIED_INVITATIONS_ENABLED === "true";
  const [fullName, setFullName] = useState("");
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [salesRole, setSalesRole] = useState<"manager" | "ps">("manager");
  const [ptgAccess, setPtgAccess] = useState<"NONE" | "BRANCH_MANAGER" | "TEAM_LEADER">("BRANCH_MANAGER");
  const [branchCode, setBranchCode] = useState("");
  const [salespersonCode, setSalespersonCode] = useState("");
  const [brand, setBrand] = useState("");

  const verifyConnections = useCallback(async () => {
    setLoading(true);
    setProblem("");
    setReview(null);
    try {
      const sessionId = getPtgAppSessionId();
      if (!sessionId) throw Error("Sign in as PTG System Admin.");
      await verifyPtg(sessionId);
      const [sales, ptgResponse] = await Promise.all([
        verifySales(),
        requestPtgAccounts("GET"),
      ]);
      if (!ptgResponse.ok) throw Error("PTG account administration is unavailable.");
      const ptgData = await ptgResponse.json() as { ok?: boolean; branches?: PtgBranch[]; accounts?: Account[]; message?: string };
      if (!ptgData.ok) throw Error(ptgData.message || "PTG branch access could not be verified.");
      const salesResult = await sales.client.from("branches")
        .select("id,name,code,dealer_id,district_id")
        .in("id", sales.scope.branches.map(branch => branch.id));
      if (salesResult.error || !Array.isArray(salesResult.data)) {
        throw Error("Could not verify Sales Tracker branch IDs and districts.");
      }
      const matches = matchUnifiedBranches(salesResult.data as SalesBranch[], ptgData.branches ?? []) as Match[];
      if (!matches.length) throw Error("No active branches have matching codes in both applications. Correct the branch mapping before inviting.");
      setBranches(matches);
      setAccounts(ptgData.accounts ?? []);
      setSalesClient(sales.client);
      setBranchCode(old => matches.some(x => x.code === old) ? old : matches[0].code);
    } catch (e) {
      setBranches([]);
      setSalesClient(null);
      setProblem(e instanceof Error ? e.message : "Unable to verify both admin sessions.");
    } finally {
      setLoading(false);
    }
  }, [verifyPtg, verifySales]);

  useEffect(() => { void verifyConnections(); }, [verifyConnections]);

  async function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checking || !salesClient) return;
    setProblem("");
    setReview(null);
    setChecking(true);
    try {
      await verifyPtg(getPtgAppSessionId());
      // Verify the Sales Tracker administrator again before reading accounts.
      const verified = await verifySales();
      const branch = branches.find(item => item.code === branchCode);
      const plan = validateUnifiedInvitation({
        fullName, login, email, salesRole, ptgAccess, salespersonCode, brand,
      }, branch) as Record<string, unknown>;
      const collidesWithPtg = accounts.some(account => account.email?.trim().toLowerCase() === email.trim().toLowerCase());
      if (collidesWithPtg) throw Error("That email is already used by a PTG account. Existing accounts are excluded from unified invitations.");
      const duplicate = await verified.client.from("profiles").select("id")
        .ilike("login_id", login.trim()).limit(1);
      if (duplicate.error) throw Error("Could not check Sales Tracker for an existing login ID.");
      if (duplicate.data?.length) throw Error("That login ID already belongs to a Sales Tracker account. Existing accounts are excluded.");
      setReview(plan);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Unable to validate this invitation.");
    } finally {
      setChecking(false);
    }
  }

  async function sendUnifiedInvitation() {
    if (!review || !enabled || sending) return;
    setProblem("");
    setSending(true);
    try {
      await verifyPtg(getPtgAppSessionId());
      const sales = await verifySales();
      const { data: loginSession } = await sales.client.auth.getSession();
      const token = loginSession.session?.access_token;
      if (!token) throw Error("Your Sales Tracker admin session has expired.");
      const url = process.env.NEXT_PUBLIC_SALES_TRACKER_SUPABASE_URL;
      const apiKey = process.env.NEXT_PUBLIC_SALES_TRACKER_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !apiKey) throw Error("Sales Tracker is not configured.");
      async function salesAction(payload: Record<string, unknown>) {
        const response = await fetch(url!.replace(/\\/$/, "") + "/functions/v1/admin-create-user", {
          method: "POST", cache: "no-store",
          headers: { apikey: apiKey!, Authorization: "Bearer " + token,
            "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({})) as {
          ok?: boolean; user_id?: string; error?: string; invitation_status?: string;
        };
        if (!response.ok) throw Error(result.error || "Sales Tracker unified invitation failed.");
        return result;
      }
      // Once a Sales identity is staged, retry this exact ID; never create
      // a duplicate because a later PTG or email step failed.
      let userId = pendingSalesId;
      if (!userId) {
        const prepared = await salesAction({
          unified: true, ptg_access: review.ptgRole ? ptgAccess : "NONE",
          full_name: review.fullName, login: review.login,
          email: review.email, role: review.salesRole,
          district_id: review.salesDistrictId, branch_id: review.salesBranchId,
          salesperson_code: review.salespersonCode,
          brand: review.assignedBrand,
        });
        if (!prepared.user_id) throw Error("Sales Tracker did not return a staged identity.");
        userId = prepared.user_id;
        setPendingSalesId(userId);
        setInvitationStatus("Sales account prepared. Linking PTG access…");
      }
      if (review.ptgRole) {
        const provision = await invokePtgData("ptg-unified-provision", {
          salesUserId: userId, salesAdminAccessToken: token,
        }) as { ptgUserId?: string; created?: boolean };
        if (!provision.ptgUserId) throw Error("PTG did not return a linked identity.");
        await salesAction({
          action: "unified_link", user_id: userId, ptg_user_id: provision.ptgUserId,
        });
        setInvitationStatus("Both application grants linked. Sending one invitation…");
      }
      await salesAction({ action: "unified_finalize", user_id: userId });
      setInvitationStatus("One invitation was emailed. No PTG password was sent.");
      setPendingSalesId("");
      setReview(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Unified invitation could not finish.");
      setInvitationStatus(pendingSalesId
        ? "The Sales account remains pending. Use Resume invitation; do not create another employee."
        : "No invitation delivery was confirmed.");
    } finally {
      setSending(false);
    }
  }

  return <main className="ptg-main shell admin-shell">
    <section className="hero admin-hero">
      <p className="eyebrow">DATA DESK · PEOPLE & ACCESS</p>
      <h1>Unified Invitations</h1>
      <p className="intro">One invitation and one Sales Tracker identity for new employees, with separately controlled PTG access.</p>
    </section>
    <section className="admin-card">
      <h2>Invitation readiness review</h2>
      <p className="admin-muted">Verify both administrator sessions, branch codes, employee identity, and application permissions before inviting. Existing accounts are not migrated or modified.</p>
      <button type="button" className="admin-button secondary" disabled={loading || checking} onClick={() => void verifyConnections()}>
        {loading ? "Verifying…" : "Recheck both applications"}
      </button>
      {problem && <p role="alert" className="admin-alert error">{problem}</p>}
      {invitationStatus && <p role="status" className="admin-alert">{invitationStatus}</p>}
      {!loading && branches.length > 0 && <form className="admin-form" onSubmit={event => void validate(event)}>
        <label>Full name<input required maxLength={120} value={fullName} onChange={event => setFullName(event.target.value)} autoComplete="name"/></label>
        <label>New login ID<input required maxLength={32} value={login} onChange={event => setLogin(event.target.value)} autoComplete="off"/></label>
        <label>Invitation email<input required type="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} autoComplete="email"/></label>
        <label>Linked branch<select value={branchCode} onChange={event => setBranchCode(event.target.value)}>
          {branches.map(branch => <option key={branch.code} value={branch.code}>{branch.code} — {branch.name}</option>)}
        </select></label>
        <label>Sales Tracker role<select value={salesRole} onChange={event => {
          const role = event.target.value as "manager" | "ps";
          setSalesRole(role);
          setPtgAccess(role === "manager" ? "BRANCH_MANAGER" : "NONE");
        }}>
          <option value="manager">Branch Manager</option>
          <option value="ps">Product Specialist</option>
        </select></label>
        {salesRole === "ps" && <>
          <label>Salesperson code<input value={salespersonCode} onChange={event => setSalespersonCode(event.target.value)} required/></label>
          <label>Assigned brand<input value={brand} onChange={event => setBrand(event.target.value)} required/></label>
        </>}
        <label>PTG access<select value={ptgAccess} onChange={event => setPtgAccess(event.target.value as typeof ptgAccess)}>
          <option value="NONE">No PTG access</option>
          {salesRole === "manager" && <option value="BRANCH_MANAGER">Branch Manager — PTG enabled</option>}
          {salesRole === "ps" && <option value="TEAM_LEADER">Team Leader — PTG enabled</option>}
        </select></label>
        <button type="submit" className="admin-button" disabled={checking || !branches.length}>
          {checking ? "Validating…" : "Validate invitation"}
        </button>
      </form>}
      {review && <div className="admin-card">
        <h3>Validated invitation preview</h3>
        <p className="admin-muted">New employee only. Branch IDs are matched by branch code, not assumed to be identical between databases.</p>
        <table className="admin-table"><tbody>
          <tr><th>Employee</th><td>{String(review.fullName)}</td></tr>
          <tr><th>Login</th><td>{String(review.login)}</td></tr>
          <tr><th>Email</th><td>{String(review.email)}</td></tr>
          <tr><th>Linked branch</th><td>{String(review.branchCode)}</td></tr>
          <tr><th>Sales Tracker</th><td>{String(review.salesRole)}</td></tr>
          <tr><th>PTG</th><td>{review.ptgRole ? String(review.ptgLegacyRole) : "No access"}</td></tr>
        </tbody></table>
        {enabled ? <button type="button" className="admin-button"
          disabled={sending} onClick={() => void sendUnifiedInvitation()}>
          {sending ? "Preparing invitation…" : pendingSalesId ? "Resume pending invitation" : "Send one unified invitation"}
        </button> : <p role="status"><strong>Review complete.</strong> Sending is not enabled until both projects' shared sign-in and cross-app revocation tests pass.</p>}
      </div>}
    </section>
  </main>;
}
