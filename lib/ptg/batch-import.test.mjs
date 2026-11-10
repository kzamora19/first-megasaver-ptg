import assert from "node:assert/strict";
import test from "node:test";
import { buildBatchPlan, runBatch, sourceDivisions } from "./batch-import.ts";

const branches = [{ id: "stg", name: "Santiago", code: "STG" }];
const catalog = { barcode: "00000101", brand: "TCL", description: "Fixture TV", category: "TV", sub_category: "LED", srp: 120 };
const preview = { valid: true, catalog: [catalog], issues: [], sales: [], daily: [], inventory: [] };
const engine = {
  createImportJobs: () => [
    { label: "1 catalog product", rpc: "import_unified_products", params: { p_items: [catalog] }, status: "pending" },
    { label: "Replace inventory", rpc: "import_unified_inventory",
      params: { p_branch: "stg", p_reported_at: "2026-11-09T10:00:00+08:00" }, status: "pending" },
  ],
};
const memo = { name: "memo.xlsx", parsed: { memoId: "PMP-001", period: "November 1–30, 2026", memoType: "MEMO_LIST", products: [{}] } };

test("build plan keeps the selected operations, PTG catalog omits price, and inventory scope includes timestamp", () => {
  const plan = buildBatchPlan(engine, preview, ["inventory", "ptg-catalog", "ptg-memos"], [memo], branches, () => "test");
  assert.equal(plan.issues.length, 0);
  assert.deepEqual(plan.jobs.map(job => job.target), ["sales", "ptg", "ptg"]);
  assert.match(plan.jobs[0].scope, /Santiago.*2026-11-09/);
  assert.equal(plan.jobs[1].ptg.body.rows[0].srp, undefined);
  assert.equal(plan.jobs[2].ptg.body.duplicateAction, "SKIP");
});

test("duplicate memo or missing selected report blocks the plan", () => {
  const plan = buildBatchPlan(engine, preview, ["daily", "ptg-memos"], [memo, memo], branches, () => "test");
  assert.equal(plan.issues.filter(issue => issue.severity === "ERROR").length, 2);
  assert.deepEqual(sourceDivisions([{ rows: [["divisioncode"], ["STG"], ["stg"], [""]], config: { role: "reference", header: 0 } }]), ["STG"]);
});

test("resume skips confirmed jobs and stops if the response was uncertain", async () => {
  let jobs = buildBatchPlan(engine, preview, ["inventory", "ptg-catalog", "ptg-memos"], [memo], branches, () => "test").jobs;
  const calls = [];
  const update = current => { jobs = current; };
  await runBatch(jobs, async () => {}, async job => {
    calls.push(job.key);
    return job.target === "sales" ? { state: "saved" } : { state: "blocked" };
  }, update);
  assert.deepEqual(jobs.map(job => job.state), ["saved", "blocked", "pending"]);
  await runBatch(jobs, async () => {}, async job => {
    calls.push(job.key);
    throw new Error("Connection lost");
  }, update);
  await runBatch(jobs, async () => {}, async job => { calls.push(job.key); return { state: "saved" }; }, update);
  assert.deepEqual(jobs.map(job => job.state), ["saved", "verify", "pending"]);
  assert.deepEqual(calls, ["sales-0", "ptg-catalog-0", "ptg-catalog-0"]);
});
