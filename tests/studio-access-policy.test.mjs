import test from "node:test";
import assert from "node:assert/strict";
import {allowedPtgStudioRole, sessionIsLive, validStudioId} from "../supabase/functions/_shared/studio-access-policy.mjs";
const p = {role_key:"BRANCH_USER",legacy_role:"TEAM LEADER",is_active:true,must_change_password:false,session_version:3};
const now = Date.parse("2026-11-19T10:00:00Z");
const s = {user_id:"a",session_version:3,expires_at:new Date(now+120000).toISOString(),last_activity_at:new Date(now-30000).toISOString(),remember_device:false,revoked_at:null};
test("allow only active Team Leaders, Branch Admins, System Admins",()=>{
  for(const role of ["SYSTEM_ADMIN","BRANCH_ADMIN"])assert.ok(allowedPtgStudioRole({...p,role_key:role,legacy_role:""}));
  for(const legacy of ["TEAM LEADER"," team leader "])assert.ok(allowedPtgStudioRole({...p,legacy_role:legacy}));
  for(const legacy of ["BRANCH USER","","TEAM LEAD","PRODUCT SPECIALIST"])assert.equal(allowedPtgStudioRole({...p,legacy_role:legacy}),false);
  for(const role of ["SYSTEM_VIEWER","BRANCH_USER","ADMIN",""]){
    assert.equal(allowedPtgStudioRole({...p,role_key:role,legacy_role:"BRANCH USER"}),false);
  }
  assert.equal(allowedPtgStudioRole({...p,is_active:false}),false);
  assert.equal(allowedPtgStudioRole({...p,must_change_password:true}),false);
});
test("only two explicit audience-scoped destinations",()=>{
 assert.equal(validStudioId("megaframe"),true);
 assert.equal(validStudioId("flyer"),true);
 for(const id of ["../admin","branchline","https://evil.example","MEGAFRAME",null])assert.equal(validStudioId(id),false);
});
test("revoke and expire tickets when source PTG sessions are no longer valid",()=>{
 assert.equal(sessionIsLive(s,p,now),true);
 assert.equal(sessionIsLive({...s,revoked_at:new Date().toISOString()},p,now),false);
 assert.equal(sessionIsLive({...s,session_version:2},p,now),false);
 assert.equal(sessionIsLive({...s,expires_at:new Date(now-1).toISOString()},p,now),false);
 assert.equal(sessionIsLive({...s,last_activity_at:new Date(now-31*60000).toISOString()},p,now),false);
 assert.equal(sessionIsLive(s,{...p,is_active:false},now),false);
 assert.equal(sessionIsLive({...s,remember_device:true,last_activity_at:new Date(now-6*24*3600000).toISOString()},p,now),true);
});
