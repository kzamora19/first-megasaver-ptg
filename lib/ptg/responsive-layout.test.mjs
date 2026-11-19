import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("../../app/products/product-search.tsx", import.meta.url), "utf8");
const globalCss = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

test("PTG uses native screen text sizing instead of a scaled desktop page", () => {
  assert.match(component, /\.legacy-ptg-main\{container-type:inline-size;font-size:14px/);
  assert.match(globalCss, /@media screen\{\s*\.ptg-nav-label\{font-size:11px/);
  assert.match(component, /\.legacy-products-table\{min-width:900px;font-size:12px/);
  assert.match(component, /\.legacy-search-form button\{height:38px;font-size:12px/);
});

test("PTG changes to a single-column workflow when its pane is narrow", () => {
  assert.match(component, /@container \(max-width:1020px\)\{[\s\S]*?grid-template-areas:"search" "results" "queue" "print"/);
  assert.match(component, /@media screen and \(max-width:600px\)\{/);
  assert.match(globalCss, /@media screen and \(min-width:721px\) and \(max-width:1340px\)/);
  assert.match(globalCss, /\.ptg-app\{grid-template-columns:clamp\(200px,18vw,235px\) minmax\(0,1fr\)\}/);
});

test("Responsive overrides stay outside the existing print layout", () => {
  const screenOverride = component.indexOf("/* Display-only: let the available PTG pane width");
  const printOverride = component.indexOf("        @media print{", screenOverride);
  assert.ok(screenOverride >= 0 && printOverride > screenOverride);
  assert.match(component.slice(printOverride), /@page\{size:letter/);
  assert.match(component.slice(printOverride), /\.legacy-print-sheet\{width:8\.5in!important;height:11in!important/);
  assert.match(globalCss, /@media print\{\s*\.ptg-app,\.ptg-workspace-content\{display:block!important/);
});

test("Search results omit Remarks while preserving queue and modal details", () => {
  const start = component.indexOf('<section className="legacy-results-panel ptg-print-hide">');
  const queue = component.indexOf('<section className="legacy-queue-panel ptg-print-hide">', start);
  const print = component.indexOf('<section id="print-price-tags"', queue);
  assert.ok(start >= 0 && queue > start && print > queue);
  const results = component.slice(start, queue);
  const queued = component.slice(queue, print);
  const headers = section => [...section.matchAll(/<th(?:\s[^>]*)?>(.*?)<\/th>/g)].map(match => match[1]);
  const resultHeadings = headers(results);
  const queueHeadings = headers(queued);
  assert.deepEqual(resultHeadings.slice(1), ["Barcode", "Brand", "Model", "SRP", "TAG THIS", "Status"]);
  assert.deepEqual(queueHeadings.slice(1), ["Barcode", "Brand", "Model", "SRP", "TAG THIS", "Status", "Format / Copies"]);
  assert.equal(resultHeadings.length, 7);
  assert.equal(queueHeadings.length, 8);
  assert.match(queued, /className="ptg-queue-print-settings"/);
  assert.doesNotMatch(results, /product\.remarks/);
  assert.doesNotMatch(queued, /product\.remarks \|\| "N\/A"/);
  assert.match(component, /<dt>Remarks<\/dt><dd>\{detailProduct\.remarks \|\| "N\/A"\}<\/dd>/);
  assert.match(results, /<BlankRows used=\{Math\.max\(1, results\.length\)\} columns=\{7\}/);
  assert.match(queued, /<BlankRows used=\{Math\.max\(1, queueRows\.length\)\} columns=\{batchPlannerEnabled \? 8 : 7\} \/>/);
  assert.match(results, /colSpan=\{7\} className="legacy-empty-row">Loading products/);
  assert.match(results, /colSpan=\{7\} className="legacy-empty-row">No products found/);
  assert.match(queued, /colSpan=\{batchPlannerEnabled \? 8 : 7\} className="legacy-queue-empty"/);
});

test("Search results use separate widths and do not alter print queue rendering", () => {
  assert.match(component, /<table className="legacy-products-table legacy-search-results-table">/);
  assert.match(component, /\.legacy-results-panel \.legacy-search-results-table\{min-width:760px\}/);
  assert.match(component, /\.legacy-products-table\{min-width:900px;font-size:12px\}/);
  assert.match(component, /\.legacy-results-panel \.legacy-search-results-table :is\(td:nth-child\(5\),td:nth-child\(6\)\)\{white-space:nowrap\}/);
  assert.match(component, /function BlankRows\(\{ used, columns = 8 \}/);
});

test("optional queue planner exposes per-product format and copies while keeping default print unchanged", () => {
  assert.match(component, /Plan print formats and copies per product/);
  assert.match(component, /setBatchPlannerEnabled\(event.target.checked\)/);
  assert.match(component, /setPrintPreferences\(previous =>/);
  assert.match(component, /aria-label=\{"Print copies for "/);
  assert.match(component, /aria-label=\{"Print format for "/);
  assert.match(component, /plannedGroups\.map\(group =>/);
  assert.match(component, /ptg-queue-print-settings/);
  assert.match(component, /batchPlannerEnabled && <td className="ptg-queue-print-settings"/);
  assert.match(component, /!batchPlannerEnabled && <section id="print-price-tags"/);
  assert.match(component, /SAVE selected group/);
  assert.match(component, /Print selected group/);
  assert.match(component, /format \+ ":" \+ sheetIndex/);
  assert.match(component, /product\.id \+ ":" \+ copyIndex/);
});

test("TL subdealer filter is role-scoped and duplicate barcode price panel is absent", () => {
  assert.match(component, /normalizedLegacyRole === "TEAM LEADER"/);
  assert.match(component, /canSeeSubdealer && <label className="legacy-stock-filter ptg-subdealer-filter"/);
  assert.match(component, /canSeeCashPrice && amount\(detailProduct\.cash_payment\)/);
  assert.doesNotMatch(component, /<h3>Price options for this barcode<\/h3>/);
  assert.match(component, /Price options — selected memo/);
});
