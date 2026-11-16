import test from 'node:test';
import assert from 'node:assert/strict';
import { planWorkspaceBranch, setupWorkspaceBranch } from './workspace-branch-plan.mjs';
const ptg = { branch_code:'VAL', branch_name:'Valenzuela', status:'ACTIVE', operational_status:'ON' };
const sales = { code:'VAL', name:'VALENZUELA', district_id:'district' };
const input = { code:'val', name:'Valenzuela', districtId:'district', salesBranches:[], ptgBranches:[] };
test('plans one new branch in both apps', () => assert.deepEqual(planWorkspaceBranch(input), {code:'VAL',name:'Valenzuela',districtId:'district',createSales:true,createPtg:true}));
test('plans only the missing side when codes and names agree', () => {
  assert.equal(planWorkspaceBranch({...input,ptgBranches:[ptg]}).createPtg,false);
  assert.equal(planWorkspaceBranch({...input,salesBranches:[sales]}).createSales,false);
  assert.equal(planWorkspaceBranch({...input,salesBranches:[sales],ptgBranches:[ptg]}).createSales,false);
});
test('does not merge branches with mismatched names, codes or districts', () => {
  assert.ok(planWorkspaceBranch({...input,ptgBranches:[{...ptg,branch_name:'Other'}]}).error);
  assert.ok(planWorkspaceBranch({...input,salesBranches:[{...sales,code:'OTHER'}]}).error);
  assert.ok(planWorkspaceBranch({...input,salesBranches:[{...sales,district_id:'other'}]}).error);
});
test('requires a valid code and an explicit district, and avoids disabled PTG branches', () => {
  assert.ok(planWorkspaceBranch({...input,code:'1'}).error);
  assert.ok(planWorkspaceBranch({...input,districtId:''}).error);
  assert.ok(planWorkspaceBranch({...input,ptgBranches:[{...ptg,status:'INACTIVE'}]}).error);
});
test('creates both sides once, and refreshes their lists', async () => {
  const events = [];
  const current = {sales:[],ptg:[]};
  const result = await setupWorkspaceBranch(input, { load: async () => { events.push('load'); return current; }, createSales: async () => { events.push('sales'); }, createPtg: async () => { events.push('ptg'); } });
  assert.equal(result.ok,true); assert.deepEqual(events,['load','sales','ptg','load']);
});
test('links an existing PTG branch by creating only the missing Sales side', async () => {
  const events=[];
  const result = await setupWorkspaceBranch(input, {load:async () => ({sales:[],ptg:[ptg]}),createSales:async () => events.push('sales'),createPtg:async () => events.push('ptg')});
  assert.equal(result.ok,true); assert.deepEqual(events,['sales']);
});
test('a mismatch causes no writes and a failed second write is not retried', async () => {
  let writes=0;
  let result = await setupWorkspaceBranch(input, {load:async () => ({sales:[],ptg:[{...ptg,branch_name:'Other'}]}),createSales:async () => writes++,createPtg:async () => writes++});
  assert.equal(result.ok,false); assert.equal(result.started,false); assert.equal(writes,0);
  const events=[];
  result = await setupWorkspaceBranch(input, {load:async () => {events.push('load');return {sales:[],ptg:[]};},createSales:async () => events.push('sales'),createPtg:async () => {events.push('ptg');throw Error('unconfirmed');}});
  assert.equal(result.ok,false); assert.equal(result.started,true); assert.deepEqual(events,['load','sales','ptg','load']);
});

