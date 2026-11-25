import assert from "node:assert/strict";import {test} from "node:test";import {safeMemoNotices} from "../supabase/functions/ptg-widget-announcements/projection.mjs";
test("only shared ordinary memos with verified brands and period appear",()=>{
 const common={memo_type:"MEMO_LIST",branch_id:null,period:"Nov 25–30",imported_at:"2026-11-25T00:00:00Z"};
 const memos=[{...common,id:"a",memo_id:"MEMO-1"},{...common,id:"b",memo_id:"SUBD2026-1"},{...common,id:"c",memo_id:"MEMO-2"},{...common,id:"d",memo_id:"MEMO-3",branch_id:"private"},{...common,id:"e",memo_id:"MEMO-4",period:""}];
 const products=memos.flatMap(m=>[{memo_id:m.id,brand:"B",cash_payment:99},{memo_id:m.id,brand:"A",cash_payment:1}]);
 const out=safeMemoNotices(memos,[{memo_number:"MEMO-2",campaign:"SUBDEALER"}],products);assert.equal(out.length,1);assert.deepEqual(Object.keys(out[0]),["id","title","body"]);assert.match(out[0].body,/Brand: A, B/);assert.match(out[0].body,/Period: Nov 25/);assert.ok(!JSON.stringify(out).includes("cash_payment"));
});

import {readFileSync} from "node:fs";
test("announcements require authenticated user, valid application session, active role and branch without extending idle session",()=>{const source=readFileSync(new URL("../supabase/functions/ptg-widget-announcements/index.ts",import.meta.url),"utf8");for(const required of ["auth.getUser(authorization.slice(7))",'eq("user_id", authData.user.id).is("revoked_at", null)',"Number(profile.session_version) !== Number(row.session_version)","!Number.isFinite(activity)","!Number.isFinite(expiry)",'branch.status !== "ACTIVE" || branch.operational_status !== "ON"',"session.mustChangePassword",'["SYSTEM_ADMIN","BRANCH_ADMIN","BRANCH_USER"]','is("branch_id",null)','select("memo_id,brand")'])assert.ok(source.includes(required),required);assert.ok(!/\.update\(|\.insert\(|\.delete\(|\.upsert\(/.test(source),"endpoint is read-only");});
