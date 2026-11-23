// STAGING ONLY: immutable upload of SHA-256 pinned Studio private HTML releases.
// Never place private editor bundles in GitHub Pages or expose a Supabase secret in browser code.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {STAGING_URL} from "./studio-staging-synthetic-auth.mjs";

export const STAGING_BUNDLES=Object.freeze([
  Object.freeze({
    studio:"megaframe",bucket:"megaframe-editor-release",
    fileEnv:"STUDIO_STAGING_MEGAFRAME_BUNDLE_FILE",
    sha256:"d427621376f4db4cd6afaa53226aca7971ff32d1da1daa81d4e3ec6da694f7f6",
    bytes:7955494,path:"releases/d427621376f4db4c/studio.html",
    header:"<!-- PRIVATE MEGAFRAME EDITOR BUNDLE."
  }),
  Object.freeze({
    studio:"flyer",bucket:"flyer-editor-release",
    fileEnv:"STUDIO_STAGING_FLYER_BUNDLE_FILE",
    sha256:"1c82384c40685ea2a3a2c0bc3ef7b09c081ae6bc81a6bc30b3fe63a0b69b4068",
    bytes:1608722,path:"releases/1c82384c40685ea2/studio.html",
    header:"<!-- PRIVATE EDITOR BUNDLE."
  })
]);
const sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
export function requirePrivateUploadConfig(env){
  if(env.STUDIO_HOSTED_STAGING_APPROVED!=="1"||
     env.STUDIO_STAGING_SUPABASE_URL!==STAGING_URL)
    throw Error("Refused: only explicitly approved isolated staging project may receive bundles");
  const adminKey=env.STUDIO_STAGING_ADMIN_SECRET_KEY;
  if(typeof adminKey!=="string"||adminKey.length<32||adminKey.startsWith("sb_publishable_"))
    throw Error("Protected staging-only admin secret required");
  for(const b of STAGING_BUNDLES){
    if(typeof env[b.fileEnv]!=="string"||!env[b.fileEnv].trim())
      throw Error("Missing private bundle path: "+b.fileEnv);
  }
  return {adminKey,url:STAGING_URL};
}
export function verifyBundle(b,bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length!==b.bytes||sha256(bytes)!==b.sha256)
    throw Error("Staging private bundle does not match pinned source hash: "+b.studio);
  if(!bytes.toString("utf8",0,128).startsWith(b.header))
    throw Error("Invalid private Studio bundle header");
}
export async function uploadPrivateBundles(env,createClient) {
  const {adminKey,url}=requirePrivateUploadConfig(env);
  const admin=createClient(url,adminKey,{auth:{
    persistSession:false,autoRefreshToken:false,detectSessionInUrl:false
  }});
  for(const b of STAGING_BUNDLES){
    const body=readFileSync(env[b.fileEnv]);
    verifyBundle(b,body); // fail BEFORE touching Storage if app source drifted
    const bucket=admin.storage.from(b.bucket);
    const {error:uploadError}=await bucket.upload(b.path,body,{
      contentType:"text/html",cacheControl:"0",upsert:false
    });
    if(uploadError && !/already exists|duplicate|conflict/i.test(
        String(uploadError.message??"")))
      throw Error("Staging "+b.studio+" upload failed: "+(uploadError.statusCode??"unknown"));
    const {data:stored,error:readError}=await bucket.download(b.path);
    if(readError||!stored)throw Error("Cannot verify privately stored "+b.studio+" release");
    const actual=Buffer.from(await stored.arrayBuffer());
    verifyBundle(b,actual);
    assert.equal(sha256(actual),b.sha256);
    console.log("PASS: "+b.studio+" immutable private object SHA-256 verified ("+actual.length+" bytes)");
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {createClient}=await import("@supabase/supabase-js");
  await uploadPrivateBundles(process.env,createClient);
}
