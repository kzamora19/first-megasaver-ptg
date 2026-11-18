import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const root = new URL("../../", import.meta.url);
const edge = readFileSync(new URL("supabase/functions/ptg-memos/index.ts",root),"utf8");
const page = readFileSync(new URL("app/price-memos/import/page.tsx",root),"utf8");
const ui = readFileSync(new URL("app/price-memos/import/memo-import-history.tsx",root),"utf8");
const search = readFileSync(new URL("app/products/product-search.tsx",root),"utf8");

test("memo audit can be requested only by System Admin after session validation", () => {
  const action = edge.indexOf('requestedAction === "history"');
  const role = edge.indexOf('if (session.role !== "SYSTEM_ADMIN")', action);
  const session = edge.indexOf("const session = await getSession(request)");
  assert.ok(action > session && role > action);
  assert.match(edge, /return respond\(origin, fail\("System Admin access required\."\), 403\)/);
  assert.match(edge, /\.eq\("event_category", "PRICE_MEMO"\)/);
  assert.match(edge, /\.eq\("outcome", "SUCCESS"\)/);
  assert.match(edge, /\.range\(rawOffset, rawOffset \+ pageSize\)/);
  assert.match(edge, /rawOffset > 50000/);
  assert.match(edge, /return respond\(origin, fail\("Unsupported memo operation\."\), 400\)/);
});

test("audit response is curated and omits raw metadata and internal identity IDs", () => {
  const start = edge.indexOf('if (requestedAction === "history")');
  const end = edge.indexOf('if (requestedAction !== "import")',start);
  const view = edge.slice(start,end);
  assert.match(view,/actor_user_id/);
  assert.match(view,/display_name/);
  assert.match(view,/importedBy: clean\(/);
  assert.match(view,/sourceFile: clean\(/);
  assert.ok(!view.includes("events: found"));
  assert.ok(!view.includes("...event"));
  assert.ok(!view.includes("metadata: meta"));
  assert.match(view,/hasMore:/);
});

test("history is not present in branch-admin UI, and price import remains independent", () => {
  assert.match(page, /session\.role === "SYSTEM_ADMIN" && <div className="admin-layout"><MemoImportHistory/);
  assert.match(ui, /action: "history"/);
  assert.match(ui, /Memo Import History/);
  assert.match(ui, /not a complete historical price list/);
  assert.match(ui, /disabled=\{busy \|\| offset === 0\}/);
  assert.match(ui, /disabled=\{busy \|\| !hasMore\}/);
  assert.match(ui, /sourceFile/);
});

test("print preflight is advisory and cannot change the source tag layout", () => {
  assert.match(search, /reviewPrintQueue\(queue, format, \{ airconPages: airconPages\.length \}\)/);
  assert.match(search,/aria-label="Print preflight summary"/);
  assert.match(search,/These are advisory checks/);
  const button = search.indexOf('onClick={printTags}');
  assert.ok(button > 0);
  const print = search.slice(search.indexOf('function printTags()'),search.indexOf('function airconBrandArtwork(',search.indexOf('function printTags()')));
  assert.ok(!print.includes("printReview"));
  assert.ok(search.includes("@page{size:letter"));
});
