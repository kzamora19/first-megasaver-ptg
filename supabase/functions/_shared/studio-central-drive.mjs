// DEVELOPMENT ONLY: server-side Google Drive storage for PTG-authorized,
// client-side AES-GCM ciphertext. Never send owner's OAuth tokens to a browser.
// Call ONLY after the PTG gateway atomically verifies a one-use P-256 proof.
import {cloudKeyAllowed,validateCloudMutation} from "./studio-cloud-policy.mjs";

const DRIVE="https://www.googleapis.com/drive/v3/files";
const UPLOAD="https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name";
const FOLDER_NAME="Branchline Central Studio Backups";
const FORMAT="BranchlineCentralEncryptedBackupV1";
const EMAIL="kennethalvinzamora19@gmail.com";
const ID=/^[A-Za-z0-9_-]{8,}$/;
const MAX_BYTES=1_500_000;
const noRedirect={redirect:"error",cache:"no-store",credentials:"omit"};
const q=x=>String(x).replaceAll("\\","\\\\").replaceAll("'","\\'");
export function centralDriveConfigured(env){
  return !!(env.clientId&&env.clientSecret&&env.refreshToken);
}
async function toHash(scope){
  const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(scope));
  return Array.from(new Uint8Array(d),x=>x.toString(16).padStart(2,"0")).join("");
}
async function authToken(env,request){
  const data=new URLSearchParams({client_id:env.clientId,client_secret:env.clientSecret,
    refresh_token:env.refreshToken,grant_type:"refresh_token"});
  const r=await request("https://oauth2.googleapis.com/token",{...noRedirect,method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},body:data});
  if(!r.ok)throw Error("Google owner authorization unavailable");
  const result=await r.json();
  if(!result?.access_token||typeof result.access_token!=="string")
    throw Error("Google owner token unavailable");
  return result.access_token;
}
async function getDrive(token,path,init,request){
  const url=new URL(path,DRIVE);
  if(url.origin!=="https://www.googleapis.com"||
     !(/^(\/drive\/v3\/files(?:\/|$)|\/drive\/v3\/about$|\/upload\/drive\/v3\/files$)/.test(url.pathname)))
    throw Error("Untrusted Drive API endpoint");
  const r=await request(url.toString(),{...noRedirect,...init,
    headers:{Authorization:"Bearer "+token,...init?.headers}});
  if(!r.ok)throw Error("Google Drive unavailable ("+r.status+")");
  return r;
}
async function ownerCheck(token,request){
  const r=await getDrive(token,"https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
    {},request);
  const detail=await r.json();
  if(detail?.user?.emailAddress?.toLowerCase()!==EMAIL)
    throw Error("Central Drive is not authorized for the approved owner account");
}
async function folder(token,create,request){
  const query=new URLSearchParams({q:"name = '"+q(FOLDER_NAME)+
    "' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false",
    fields:"nextPageToken,files(id,name)",pageSize:"100"});
  const result=await(await getDrive(token,DRIVE+"?"+query,{},request)).json();
  const found=(result.files||[]).find(f=>ID.test(f.id||"")&&f.name===FOLDER_NAME);
  if(found)return found.id;
  if(!create)return null;
  const created=await(await getDrive(token,DRIVE+"?fields=id",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({name:FOLDER_NAME,mimeType:"application/vnd.google-apps.folder",
      parents:["root"]})},request)).json();
  if(!ID.test(created.id||""))throw Error("Drive backup folder was not created");
  return created.id;
}
export async function centralDriveOperation({env,studio,ownerId,operation,
  recordKey,fileId,iv,encrypted}, request=fetch){
  if(!["megaframe","flyer"].includes(studio)||typeof ownerId!=="string"||
     !/^[0-9a-f-]{36}$/i.test(ownerId)||!["list","read","write"].includes(operation))
    return {status:"denied"};
  if(operation==="write"&&!validateCloudMutation(studio,{
    recordKey,iv,encrypted,expectedVersion:0}))return {status:"denied"};
  if(operation==="read"&&(!ID.test(fileId||"")||!cloudKeyAllowed(studio,recordKey)))
    return {status:"denied"};
  if(!centralDriveConfigured(env))return {status:"not_configured"};
  try{
    const token=await authToken(env,request);
    // Fail closed against accidental connection to an unrelated Google account.
    await ownerCheck(token,request);
    const ownerScope=await toHash("ptg-central-v1|"+studio+"|"+ownerId);
    const parent=await folder(token,operation==="write",request);
    if(!parent)return {status:"ok",items:[]};
    if(operation==="list"){
      const query=new URLSearchParams({q:"'"+q(parent)+"' in parents and trashed = false"+
        " and mimeType = 'application/json'"+
        " and appProperties has {key='branchline' and value='central-studio-v1'}"+
        " and appProperties has {key='ownerScope' and value='"+ownerScope+"'}"+
        " and appProperties has {key='studio' and value='"+studio+"'}",
        fields:"nextPageToken,files(id,name,size,modifiedTime,appProperties)",
        orderBy:"modifiedTime desc",pageSize:"100"});
      const page=await(await getDrive(token,DRIVE+"?"+query,{},request)).json();
      const items=(page.files||[]).filter(f=>ID.test(f.id||"")&&
        f.appProperties?.ownerScope===ownerScope&&
        f.appProperties?.studio===studio&&
        f.appProperties?.branchline==="central-studio-v1")
        .map(f=>({fileId:f.id,recordKey:f.appProperties.recordKey,
          modifiedTime:f.modifiedTime,size:f.size}));
      return {status:"ok",items,hasMore:!!page.nextPageToken};
    }
    if(operation==="read"){
      const detail=await(await getDrive(token,DRIVE+"/"+encodeURIComponent(fileId)+
        "?fields=id,trashed,mimeType,size,parents,appProperties",{},request)).json();
      if(detail.trashed||detail.mimeType!=="application/json"||
         !Array.isArray(detail.parents)||!detail.parents.includes(parent)||
         detail.appProperties?.branchline!=="central-studio-v1"||
         detail.appProperties?.ownerScope!==ownerScope||
         detail.appProperties?.studio!==studio||
         detail.appProperties?.recordKey!==recordKey||
         Number(detail.size)>MAX_BYTES)return {status:"denied"};
      const response=await getDrive(token,DRIVE+"/"+encodeURIComponent(fileId)+
        "?alt=media",{},request);
      if(Number(response.headers.get("content-length")||0)>MAX_BYTES)return {status:"denied"};
      const content=await response.text();
      if(content.length>MAX_BYTES)return {status:"denied"};
      const data=JSON.parse(content);
      if(data.format!==FORMAT||data.ownerScope!==ownerScope||
         data.studio!==studio||data.recordKey!==recordKey||
         !validateCloudMutation(studio,{recordKey,iv:data.iv,
           encrypted:data.encrypted,expectedVersion:0}))return {status:"denied"};
      return {status:"ok",record:{iv:data.iv,encrypted:data.encrypted}};
    }
    // Every owner-confirmed backup creates a NEW encrypted version; never delete
    // or overwrite any existing file. The photo content never reaches this API
    // in plaintext.
    const content=JSON.stringify({format:FORMAT,studio,ownerScope,recordKey,iv,encrypted});
    if(content.length>MAX_BYTES)return {status:"denied"};
    const boundary="branchline_"+crypto.randomUUID().replaceAll("-","");
    const metadata={name:"Branchline-"+studio+"-"+new Date().toISOString()+".json",
      mimeType:"application/json",parents:[parent],
      appProperties:{branchline:"central-studio-v1",studio,ownerScope,recordKey}};
    const body="--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+
      JSON.stringify(metadata)+"\r\n--"+boundary+
      "\r\nContent-Type: application/json\r\n\r\n"+content+
      "\r\n--"+boundary+"--";
    const uploaded=await(await getDrive(token,UPLOAD,{
      method:"POST",headers:{"Content-Type":"multipart/related; boundary="+boundary},
      body},request)).json();
    if(!ID.test(uploaded.id||""))throw Error("Drive did not confirm backup creation");
    return {status:"ok",fileId:uploaded.id};
  }catch{
    // Never return OAuth credentials, account information or provider errors.
    return {status:"unavailable"};
  }
}
