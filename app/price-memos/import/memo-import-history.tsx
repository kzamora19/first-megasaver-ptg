"use client";

import { useState, type FormEvent } from "react";
import { invokePtgData, usesEdgeData } from "@/lib/ptg/edge-api";
import { groupPriceRevisionEvents } from "@/lib/ptg/revision-diff.mjs";
import { useEffect } from "react";

type MemoAuditEvent = {
  id: number;
  memoId: string;
  action: string;
  createdAt: string;
  importedBy: string;
  sourceFile: string;
  period: string;
  memoType: string;
  productCount: number | null;
  supersededRows: number | null;
};

export default function MemoImportHistory() {
  const [memoId, setMemoId] = useState("");
  const [appliedId, setAppliedId] = useState("");
  const [events, setEvents] = useState<MemoAuditEvent[]>([]);
  const [selectedRevisionMemo, setSelectedRevisionMemo] = useState("");
  const [revisionDraft, setRevisionDraft] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  async function load(nextOffset: number, exact: string) {
    if (busy || !usesEdgeData) return;
    setBusy(true); setError("");
    try {
      const response = await invokePtgData("ptg-memos", {
        action: "history", offset: nextOffset, memoId: exact,
      }) as { events?: MemoAuditEvent[]; hasMore?: boolean };
      setEvents(response.events || []);
      setHasMore(response.hasMore === true);
      setOffset(nextOffset);
      setAppliedId(exact);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load memo import history.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(0, memoId.trim());
  }

  return <section className="admin-card" aria-label="Memo import history">
    <h3>Memo Import History</h3>
    <p className="admin-muted">System Admin only. This is a record of successful import/replacement events, not a complete historical price list. An earlier memo revision might have been replaced.</p>
    {!usesEdgeData
      ? <p className="admin-muted">Audit history requires the authenticated online PTG service.</p>
      : <>
        <form onSubmit={submit} className="ptg-memo-history-tools">
          <label className="admin-field"><span>Memo number (optional, exact match)</span>
            <input type="search" value={memoId} maxLength={120} disabled={busy}
              placeholder="Leave blank for recent imports" onChange={event => setMemoId(event.target.value)}/>
          </label>
          <button className="admin-button" type="submit" disabled={busy}>
            {busy ? "LOADING..." : loaded ? "SEARCH HISTORY" : "LOAD HISTORY"}
          </button>
        </form>
        {error && <p className="admin-alert error" role="alert">{error}</p>}
        {loaded && <>
          <div className="admin-table-wrap"><table className="admin-table">
            <thead><tr><th>Date</th><th>Memo</th><th>Action</th><th>Imported by</th>
              <th>Period</th><th>Source file</th><th>Type</th><th>Products</th><th>Rows replaced</th><th>Price changes</th></tr></thead>
            <tbody>{events.length ? events.map(event => <tr key={event.id}>
              <td>{event.createdAt ? new Date(event.createdAt).toLocaleString("en-PH") : "—"}</td>
              <td>{event.memoId || "—"}</td><td>{event.action || "—"}</td>
              <td>{event.importedBy || "—"}</td><td>{event.period || "—"}</td>
              <td title={event.sourceFile || ""}>{event.sourceFile || "—"}</td>
              <td>{event.memoType || "—"}</td>
              <td>{event.productCount == null ? "—" : event.productCount.toLocaleString()}</td>
              <td>{event.supersededRows == null ? "—" : event.supersededRows.toLocaleString()}</td>
              <td><button type="button" disabled={!event.memoId || busy} onClick={() => { setRevisionDraft(event.memoId); setSelectedRevisionMemo(event.memoId); }}>Review revisions</button></td>
            </tr>) : <tr><td colSpan={10}>No successful import events found for this selection.</td></tr>}</tbody>
          </table></div>
          <div className="ptg-memo-history-pages">
            <span>Entries {events.length ? offset + 1 : 0}–{offset + events.length}{appliedId ? " · " + appliedId : ""}</span>
            <button type="button" disabled={busy || offset === 0} onClick={() => void load(Math.max(0, offset - 40), appliedId)}>Previous</button>
            <button type="button" disabled={busy || !hasMore} onClick={() => void load(offset + 40, appliedId)}>Next</button>
          </div>
        </>}
        <div className="ptg-history-open">
          <label className="admin-field"><span>Price changes for memo</span>
            <input type="search" maxLength={120} value={revisionDraft} placeholder="Select an imported memo or enter a memo number"
              onChange={event => setRevisionDraft(event.target.value)} />
            <button type="button" disabled={busy || !revisionDraft.trim()}
              onClick={() => setSelectedRevisionMemo(revisionDraft.trim())}>View price changes</button>
          </label>
          <p className="admin-muted">Price revision snapshots will be available only for imports after the protected audit migration is approved and installed. Reviewing a memo does not change it.</p>
        </div>
        {!!selectedRevisionMemo.trim() && <MemoPriceRevisionHistory key={selectedRevisionMemo} memoNumber={selectedRevisionMemo.trim()} />}
      </>}
  </section>;
}

type RevisionEvent = {
  id: number;
  transactionId: number;
  memoNumber: string;
  barcode: string;
  operation: "INSERT" | "DELETE";
  tagThis: string;
  srp: string;
  remarks: string;
  importedBy: string;
  recordedAt: string;
  sourcePeriod: string;
};
function MemoPriceRevisionHistory({ memoNumber }: { memoNumber: string }) {
  const [entries, setEntries] = useState<RevisionEvent[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setEntries([]);
    setOffset(0);
    setLoaded(false);
    setHasMore(false);
    setError("");
    async function fetchPage(next: number) {
      setBusy(true);
      try {
        const response = await invokePtgData("ptg-memos", {
          action: "price-revisions", memoId: memoNumber, offset: next,
        }) as { events?: RevisionEvent[]; hasMore?: boolean };
        if (!current) return;
        setEntries(response.events || []);
        setHasMore(response.hasMore === true);
        setOffset(next);
        setLoaded(true);
        setError("");
      } catch (cause) {
        if (current) setError(cause instanceof Error ? cause.message : "Price revision audit unavailable.");
      } finally {
        if (current) setBusy(false);
      }
    }
    void fetchPage(0);
    return () => { current = false; };
  }, [memoNumber]);
  async function page(next: number) {
    if (busy || next < 0 || next > 50000) return;
    setBusy(true);
    try {
      const data = await invokePtgData("ptg-memos", {
        action: "price-revisions", memoId: memoNumber, offset: next,
      }) as { events?: RevisionEvent[]; hasMore?: boolean };
      setEntries(data.events || []);
      setHasMore(data.hasMore === true);
      setOffset(next);
      setLoaded(true);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Price revision audit unavailable.");
    } finally {
      setBusy(false);
    }
  }
  const pairs = groupPriceRevisionEvents(entries);
  const currency = (amount: number | null) => amount == null || !Number.isFinite(amount)
    ? "—" : "₱" + amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <section className="ptg-revision-list" aria-label="Memo price changes">
    <h4>Memo price revisions — {memoNumber}</h4>
    <p className="admin-muted">Audit begins when revision capture is installed; older replaced values cannot be reconstructed. Matching is within this page and transaction only. If a transaction is split across pages, the old/new comparison may be incomplete. This is not an automatic pricing correction.</p>
    {busy && <p role="status">Loading audit records…</p>}
    {error && <p className="admin-alert error" role="alert">{error}</p>}
    {loaded && !error && <>
      <div className="admin-table-wrap"><table className="admin-table">
        <thead><tr><th>Recorded</th><th>Barcode</th><th>Change</th><th>Previous SRP</th><th>New SRP</th>
          <th>Previous Tag This</th><th>New Tag This</th><th>Period</th><th>Imported by</th></tr></thead>
        <tbody>{pairs.length ? pairs.map(row => <tr key={row.key}>
          <td>{row.recordedAt ? new Date(row.recordedAt).toLocaleString("en-PH") : "—"}</td>
          <td>{row.barcode}</td><td>{row.status}</td>
          <td>{currency(row.oldSrp)}</td><td>{currency(row.newSrp)}</td>
          <td>{currency(row.oldPrice)}</td><td>{currency(row.newPrice)}</td>
          <td>{row.sourcePeriod || "—"}</td><td>{row.importedBy || "—"}</td>
        </tr>) : <tr><td colSpan={9}>No recorded revisions for this memo on this page.</td></tr>}</tbody>
      </table></div>
      <div className="ptg-memo-history-pages">
        <span>Revision records {entries.length ? offset + 1 : 0}–{offset + entries.length}</span>
        <button type="button" disabled={busy || offset === 0} onClick={() => void page(Math.max(0, offset - 40))}>Previous</button>
        <button type="button" disabled={busy || !hasMore} onClick={() => void page(offset + 40)}>Next</button>
      </div>
    </>}
  </section>;
}
