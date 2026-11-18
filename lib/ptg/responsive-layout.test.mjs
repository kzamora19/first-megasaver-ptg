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
