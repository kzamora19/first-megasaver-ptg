import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const layout=read("components/workspace-layout.tsx");
const styles=read("app/globals.css");
const tracker=read("app/studios/page.tsx");

test("PTG and Data Desk have the approved unique sidebar module labels",()=>{
  assert.match(layout,/<small>\{desk \? "DATA DESK" : "PRICE TAG GENERATOR"\}<\/small>/);
  assert.equal((layout.match(/PRICE TAG GENERATOR/g)||[]).length,1);
  assert.equal((layout.match(/DATA DESK/g)||[]).length,1);
  assert.match(layout,/branchline-logo\.png/);
  assert.match(styles,/\.ptg-app \.ptg-brand small\{/);
});
test("PTG navigation adopts actual Branchline colors, without touching print-specific layout",()=>{
  const css=styles.slice(styles.indexOf("BRANCHLINE unified app staging design"));
  assert.match(css,/--branchline-navy:#1d2836/);
  assert.match(css,/--branchline-blue:#355ee8/);
  assert.match(css,/--branchline-blue-dark:#2348c7/);
  assert.match(css,/--branchline-blue-soft:#eef2ff/);
  assert.match(css,/\.ptg-app \.ptg-sidebar/);
  assert.match(css,/\.ptg-app \.ptg-nav-item.active/);
  assert.doesNotMatch(css,/canvas|@media print|price-tag-print|print-frame/i);
  assert.match(tracker,/const destinations:Record<Studio/);
});
