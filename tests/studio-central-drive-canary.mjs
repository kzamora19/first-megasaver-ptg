// Zero-credential authenticated synthetic Drive E2E invoked by GitHub Actions.
const aud="branchline-drive-canary:agknxlowackphvwyvxge";
if(process.env.GITHUB_ACTIONS!=="true"||process.env.GITHUB_EVENT_NAME!=="push"||
   !process.env.ACTIONS_ID_TOKEN_REQUEST_URL||!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
  throw Error("Only a signed GitHub Actions run can invoke the Drive canary.");
const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
url.searchParams.set("audience",aud);
const tokenResult=await fetch(url,{headers:{
 Authorization:"Bearer "+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
},signal:AbortSignal.timeout(15000)});
if(!tokenResult.ok)throw Error("GitHub Actions identity token is unavailable.");
const token=(await tokenResult.json())?.value;
if(typeof token!=="string")throw Error("No GitHub identity token");
const response=await fetch("https://agknxlowackphvwyvxge.supabase.co/functions/v1/studio-central-drive-canary",{
 method:"POST",redirect:"error",cache:"no-store",
 headers:{Authorization:"Bearer "+token},
 signal:AbortSignal.timeout(120000)
});
const data=await response.json().catch(()=>({}));
const label=typeof data.status==="string"&&/^(megaframe|flyer):[a-z_]+(?:,(megaframe|flyer):[a-z_]+)*$/.test(data.status)?
 data.status:"unknown";
console.log("Google Drive actual synthetic encrypted backup:",label,"HTTP",response.status);
if(response.status!==200||data.ok!==true||label!=="megaframe:ok,flyer:ok")
 throw Error("Live synthetic encrypted Drive roundtrip is not yet verified: "+label);
