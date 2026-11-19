import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const root = new URL("../../", import.meta.url);
const migration = readFileSync(new URL("supabase/migrations/20261119021936_append_only_memo_price_revisions_release.sql",root),"utf8");
const edge = readFileSync(new URL("supabase/functions/ptg-memos/index.ts",root),"utf8");
const page = readFileSync(new URL("app/price-memos/import/memo-import-history.tsx",root),"utf8");

test("price revision audit snapshots are private, append-only, and service-role-only", () => {
  assert.match(migration, /create table if not exists private\.ptg_memo_price_revisions/);
  assert.match(migration, /after insert or delete on public\.memo_products/);
  assert.match(migration, /txid_current\(\)/);
  assert.match(migration, /to_jsonb\(v_row\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table private\.ptg_memo_price_revisions from public, anon, authenticated/);
  assert.match(migration, /if \(select auth\.role\(\)\) <> 'service_role'/);
  assert.match(migration, /revoke all on function public\.ptg_admin_memo_price_revisions\(text,integer\)/);
  assert.match(migration, /recorded_at timestamptz/);
});

test("System Admin alone may fetch sanitized revision data, without exposing import UUID or raw JSON", () => {
  const start = edge.indexOf('if (requestedAction === "price-revisions")');
  const end = edge.indexOf('if (requestedAction === "history")', start);
  const section = edge.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(section, /session\.role !== "SYSTEM_ADMIN"/);
  assert.match(section, /ptg_admin_memo_price_revisions/);
  assert.match(section, /if \(!memoNumber/);
  assert.match(section, /ImportedById|importedById/);
  assert.match(section, /const \{ importedById, \.\.\.rest \} = row;/);
  assert.doesNotMatch(section, /row_snapshot|cash_payment/);
});

test("memo audit UI shows page-local before/after and acknowledges nonretroactive history", () => {
  assert.match(page, /groupPriceRevisionEvents\(entries\)/);
  assert.match(page, /action: "price-revisions"/);
  assert.match(page, /Review revisions/);
  assert.match(page, /View price changes/);
  assert.match(page, /Previous Tag This/);
  assert.match(page, /New Tag This/);
  assert.match(page, /Audit begins when revision capture is installed/);
  assert.match(page, /If a transaction is split across pages/);
  assert.match(page, /disabled=\{busy \|\| !hasMore\}/);
  assert.doesNotMatch(page, /<button[^>]+onClick=\{\(\) => delete/i);
});
