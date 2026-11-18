"use client";

import { useState, type FormEvent } from "react";
import { invokePtgData, usesEdgeData } from "@/lib/ptg/edge-api";

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
              <th>Period</th><th>Source file</th><th>Type</th><th>Products</th><th>Rows replaced</th></tr></thead>
            <tbody>{events.length ? events.map(event => <tr key={event.id}>
              <td>{event.createdAt ? new Date(event.createdAt).toLocaleString("en-PH") : "—"}</td>
              <td>{event.memoId || "—"}</td><td>{event.action || "—"}</td>
              <td>{event.importedBy || "—"}</td><td>{event.period || "—"}</td>
              <td title={event.sourceFile || ""}>{event.sourceFile || "—"}</td>
              <td>{event.memoType || "—"}</td>
              <td>{event.productCount == null ? "—" : event.productCount.toLocaleString()}</td>
              <td>{event.supersededRows == null ? "—" : event.supersededRows.toLocaleString()}</td>
            </tr>) : <tr><td colSpan={9}>No successful import events found for this selection.</td></tr>}</tbody>
          </table></div>
          <div className="ptg-memo-history-pages">
            <span>Entries {events.length ? offset + 1 : 0}–{offset + events.length}{appliedId ? " · " + appliedId : ""}</span>
            <button type="button" disabled={busy || offset === 0} onClick={() => void load(Math.max(0, offset - 40), appliedId)}>Previous</button>
            <button type="button" disabled={busy || !hasMore} onClick={() => void load(offset + 40, appliedId)}>Next</button>
          </div>
        </>}
      </>}
  </section>;
}
