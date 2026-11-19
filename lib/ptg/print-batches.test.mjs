import test from "node:test";
import assert from "node:assert/strict";
import { groupedPrintPlan,expandedPrintBatch,normalizePrintCopies } from "./print-batches.mjs";

test("group formats and copies without changing existing queue or merging separate offers", () => {
  const input = Object.freeze([
    Object.freeze({ id:"reg",barcode:"00000528" }),
    Object.freeze({ id:"promo",barcode:"00000528" }),
    Object.freeze({ id:"other",barcode:"00000039" }),
  ]);
  const plans = Object.freeze({
    reg: { format:"ONE",copies:2 },
    promo: { format:"FOUR",copies:3 },
    other: { format:"FOUR",copies:1 },
  });
  assert.deepEqual(groupedPrintPlan(input,plans,"ONE"),[
    { format:"ONE",products:1,copies:2 },
    { format:"FOUR",products:2,copies:4 },
  ]);
  assert.deepEqual(expandedPrintBatch(input,plans,"FOUR","ONE",true).map(item=>item.id),["promo","promo","promo","other"]);
  assert.deepEqual(expandedPrintBatch(input,plans,"ONE","ONE",true).map(item=>item.id),["reg","reg"]);
  assert.deepEqual(expandedPrintBatch(input,plans,"FOUR","ONE",false).map(item=>item.id),["reg","promo","other"]);
  assert.equal(input.length,3);
});

test("invalid quantities cannot create unlimited print copies or negative print sheets", () => {
  assert.equal(normalizePrintCopies(0),1);
  assert.equal(normalizePrintCopies(-3),1);
  assert.equal(normalizePrintCopies(21),1);
  assert.equal(normalizePrintCopies(2.4),1);
  assert.equal(normalizePrintCopies("5"),5);
  assert.equal(expandedPrintBatch([{id:"a"}],{a:{format:"TWO",copies:999}},"TWO","ONE",true).length,1);
  assert.deepEqual(expandedPrintBatch([],{},"ONE","ONE",true),[]);
  assert.throws(()=>groupedPrintPlan([],{},"INVALID"),/Unsupported/);
});

test("aircon duplicate copies stay individual entries for the existing capacity-slot paginator", () => {
  const queue=[{id:"ac1",brand:"LG",description:"1.5 HP",barcode:"123"}];
  const planned=expandedPrintBatch(queue,{ac1:{format:"AIRCON",copies:3}},"AIRCON","ONE",true);
  assert.equal(planned.length,3);
  assert.equal(planned[0],queue[0]);
  assert.equal(planned[2],queue[0]);
});
