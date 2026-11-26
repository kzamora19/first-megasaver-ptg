// Runs ONLY against the fresh loopback Supabase CLI test stack.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createClient} from "@supabase/supabase-js";
import {runCleanup} from "../../supabase/functions/_shared/retention-cleanup.mjs";
const settings=Object.fromEntries(readFileSync(process.argv[2],"utf8").split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const at=l.indexOf("=");return [l.slice(0,at),l.slice(at+1).replace(/^"(.*)"$/,"$1")];}));
const api=settings.API_URL??settings.SUPABASE_URL,db=settings.DB_URL,key=settings.SERVICE_ROLE_KEY??settings.SECRET_KEY;
const local=url=>{const u=new URL(url);return ["127.0.0.1","localhost","::1","[::1]"].includes(u.hostname);};
assert.ok(api&&db&&key&&local(api)&&local(db),"Refuse all non-loopback URLs");
const dir=new URL("./",import.meta.url);
for(const file of ["real-storage-fixture.sql","catalog.sql","registry.sql","storage-review.sql"]){
 execFileSync("psql",[db,"-v","ON_ERROR_STOP=1","-f",new URL(file,dir).pathname],{stdio:"inherit"});
}
const sql=query=>execFileSync("psql",[db,"-v","ON_ERROR_STOP=1","-c",query],{stdio:"inherit"});
sql("INSERT INTO private.ptg_catalog_import_batches(id,dataset,source_file,effective_date,actor_id,imported_at,row_count) SELECT ('00000000-0000-0000-0000-00000000020'||i)::uuid,'master','fixture-'||i||'.xlsx',(now()-make_interval(days=>120-i*10))::date,'00000000-0000-0000-0000-000000000001'::uuid,now()-make_interval(days=>120-i*10),1 FROM generate_series(1,3) i;");
const admin=createClient(api,key,{auth:{autoRefreshToken:false,persistSession:false}});
const bucketName="branchline-retained-imports",actor="00000000-0000-0000-0000-000000000001",other="00000000-0000-0000-0000-000000000002";
function ok(result,label){if(result.error)throw Error(label+": "+result.error.message);return result.data;}
ok(await admin.storage.createBucket(bucketName,{public:false}),"Create synthetic bucket");
const bucket=admin.storage.from(bucketName),paths=[];
for(let i=1;i<=3;i++){
 const bytes=new TextEncoder().encode("synthetic source "+i),hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),n=>n.toString(16).padStart(2,"0")).join("");
 const id="00000000-0000-0000-0000-00000000010"+i,batch="00000000-0000-0000-0000-00000000020"+i,path="originals/"+hash+"/"+id+".xlsx";
 ok(await bucket.upload(path,bytes,{contentType:"application/octet-stream",upsert:false}),"Upload synthetic original");
 ok(await admin.rpc("ptg_retention_register_catalog",{p_actor_id:actor,p_batch_id:batch,p_id:id,p_sha:hash,p_path:path,p_bytes:bytes.length}),"Register verified synthetic source");
 paths.push({path,bytes:bytes.length});
}
const before=ok(await admin.rpc("ptg_storage_review",{p_actor_id:actor}),"Storage overview");
assert.equal(before.eligible,1);assert.equal(before.total,3);assert.equal(before.policy.enabled,false);
assert.ok((await admin.rpc("ptg_storage_review",{p_actor_id:other})).error,"Non-admin was allowed");
assert.equal((await runCleanup({admin,actorId:actor,dryRun:true})).candidates,1);
assert.equal((await runCleanup({admin,actorId:actor,dryRun:false})).deleted,0);
assert.equal(ok(await bucket.exists(paths[0].path),"Before activation"),true);
sql("UPDATE private.ptg_retention_policy SET release_authorized=true WHERE singleton;");
ok(await admin.rpc("ptg_retention_configure",{p_actor_id:actor,p_days:60,p_enabled:true}),"Enable synthetic cleanup only");
const report=await runCleanup({admin,actorId:actor,dryRun:false});
assert.equal(report.deleted,1,JSON.stringify(report));assert.equal(report.review,0,JSON.stringify(report));
const old=paths[0].path,split=old.lastIndexOf("/"),leaf=old.slice(split+1);
const gone=ok(await bucket.list(old.slice(0,split),{search:leaf,limit:100,offset:0}),"Verify expired original absent");
assert.ok(Array.isArray(gone)&&gone.length<100&&!gone.some(o=>o.name===leaf),"Expired original still present");
for(const p of paths.slice(1))assert.equal(ok(await bucket.exists(p.path),"Verify protected version"),true);
const final=ok(await admin.rpc("ptg_storage_review",{p_actor_id:actor}),"Final overview");
assert.equal(final.eligible,0);assert.equal(final.reclaimedBytes,paths[0].bytes);
const record=ok(await admin.from("product_master").select("barcode").eq("barcode","00000528").single(),"Permanent business record");
assert.equal(record.barcode,"00000528");
assert.equal(ok(await admin.rpc("ptg_retention_notices",{p_actor_id:actor}),"Admin notice").length,1);
console.log("PASS actual Supabase Storage upload, registry claim, SHA-256 verification, API deletion, protected versions, permanent records, and admin-only notices on disposable local stack.");
