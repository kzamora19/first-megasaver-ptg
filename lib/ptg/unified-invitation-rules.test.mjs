import assert from "node:assert/strict";
import test from "node:test";
import { matchUnifiedBranches, unifiedPtgGrant, validateUnifiedInvitation } from "./unified-invitation-rules.mjs";

const sales = [{id:"s1",code:"STGO",name:"Santiago",dealer_id:"dealer1",district_id:"district1"}];
const ptg = [{id:"p1",branch_code:"stgo",branch_name:"Santiago",status:"ACTIVE",operational_status:"ON"}];
const branch = matchUnifiedBranches(sales,ptg)[0];

test("branch pairing is by verified branch code, never by unrelated UUID",()=>{
  assert.equal(branch.salesBranchId,"s1");
  assert.equal(branch.ptgBranchId,"p1");
  assert.equal(branch.code,"STGO");
});
test("rejects duplicate branch codes rather than guessing",()=>{
  assert.throws(()=>matchUnifiedBranches([sales[0], {...sales[0],id:"another"}],ptg),/Duplicate/);
});
test("manager receives Branch Manager entitlement only when requested",()=>{
  assert.deepEqual(unifiedPtgGrant("manager","BRANCH_MANAGER"),{role:"BRANCH_ADMIN",legacyRole:"BRANCH MANAGER"});
  assert.equal(unifiedPtgGrant("manager","NONE"),null);
});
test("Product Specialist has no default PTG entitlement; Team Leader only when approved",()=>{
  assert.equal(unifiedPtgGrant("ps","NONE"),null);
  assert.deepEqual(unifiedPtgGrant("ps","TEAM_LEADER"),{role:"BRANCH_USER",legacyRole:"TEAM LEADER"});
  assert.throws(()=>unifiedPtgGrant("ps","BRANCH_MANAGER"),/incompatible/);
});
test("builds a new manager invitation plan without changing any account",()=>{
  const plan=validateUnifiedInvitation({fullName:"Demo Employee",login:"demo-manager",email:"new@example.com",salesRole:"manager",ptgAccess:"BRANCH_MANAGER"},branch);
  assert.equal(plan.applicationAccess.ptg,true);
  assert.equal(plan.ptgRole,"BRANCH_ADMIN");
  assert.equal(plan.salesBranchId,"s1");
  assert.equal(plan.ptgBranchId,"p1");
});
test("blocks missing salesperson code and brand",()=>{
  const input={fullName:"Demo Employee",login:"demo-ps",email:"new@example.com",salesRole:"ps",ptgAccess:"NONE"};
  assert.throws(()=>validateUnifiedInvitation(input,branch),/salesperson code/i);
  assert.throws(()=>validateUnifiedInvitation({...input,salespersonCode:"007"},branch),/brand/i);
});
test("blocks unrelated or unmapped branch, before provisioning",()=>{
  assert.throws(()=>validateUnifiedInvitation({fullName:"Demo Employee",login:"demo-manager",email:"new@example.com",salesRole:"manager",ptgAccess:"BRANCH_MANAGER"},undefined),/verified Sales Tracker/);
});
