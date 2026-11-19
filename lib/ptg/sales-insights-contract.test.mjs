import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const web = readFileSync(new URL("app/products/product-search.tsx", root), "utf8");
const server = readFileSync(new URL("supabase/functions/ptg-products/index.ts", root), "utf8");

test("PTG sales activity is opt-in and requires verified PTG user session", () => {
  assert.match(web, /NEXT_PUBLIC_PTG_SALES_INSIGHTS_ENABLED === "true"/);
  assert.match(server, /PTG_SALES_INSIGHTS_ENABLED/);
  assert.match(server, /if \(session\.mustChangePassword \|\| !\["SYSTEM_ADMIN", "BRANCH_ADMIN", "BRANCH_USER"\]/);
  assert.match(server, /const session = await getSession\(request\)/);
  assert.match(server, /case "insights": return await productInsights/);
  assert.match(server, /readSalesInventory\(request, "insights", clean\(body\.barcode, 64\)\)/);
});

test("PTG displays only aggregate data and never changes the print queue", () => {
  assert.match(web, /Sales Tracker · Product insights/);
  assert.match(web, /aria-label="Sales Tracker product insights"/);
  assert.match(web, /Read-only aggregated totals/);
  assert.match(web, /No customer or Product Specialist identities are shared/);
  assert.match(web, /className="ptg-product-insights ptg-print-hide"/);
  const sectionStart = web.indexOf('{salesInsightsEnabled && <section className="ptg-product-insights');
  const sectionEnd = web.indexOf('        {(() => {', sectionStart);
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart, "Insights panel must remain isolated");
  const section = web.slice(sectionStart, sectionEnd);
  assert.ok(!section.includes("toggleProduct("));
  assert.ok(!section.includes("setQueue("));
  assert.doesNotMatch(section, /customer_name|ps_name|salesperson_code|payment_mode/);
});

test("failure does not affect price search, print queue or certificate users", () => {
  assert.match(web, /PTG prices and printing are unaffected/);
  assert.match(web, /setInsightsMessage\(error instanceof Error/);
  assert.match(web, /return \(\) => \{ active = false; \}/);
});

test("existing Flyer Studio origin remains allowed after the PTG gateway update", () => {
  assert.match(server, /https:\/\/flyer-studio-ken-s-project5\.vercel\.app/);
});
