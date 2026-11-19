import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../app/products/product-search.tsx", import.meta.url), "utf8");

test("the two approved PTG labels remain SAVE and Print", () => {
  const save = source.match(/className="save-pdf"[^>]*>\s*▣ SAVE<\/button>/g) || [];
  const print = source.match(/className="print-tags"[^>]*>\s*▣ Print<\/button>/g) || [];
  assert.equal(save.length, 1, "SAVE must appear on the existing Save button");
  assert.equal(print.length, 1, "Print must appear on the existing Print button");
  assert.doesNotMatch(source, />\s*▣ SAVE AS PDF<\/button>/);
  assert.doesNotMatch(source, />\s*▣ Print Price Tags<\/button>/);
});
