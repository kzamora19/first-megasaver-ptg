// One-time read-only preflight; no secrets or Google file metadata are logged.
const audience="branchline-ptg-drive-preflight:agknxlowackphvwyvxge";
if(process.env.GITHUB_ACTIONS!=="true"||process.env.GITHUB_EVENT_NAME!=="push"||
   !process.env.ACTIONS_ID_TOKEN_REQUEST_URL||!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
 throw Error("Preflight must run under the protected development workflow.");
const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
url.searchParams.set("audience",audience);
const r=await fetch(url,{headers:{
 Authorization:"Bearer "+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
},signal:AbortSignal.timeout(15000)});
if(!r.ok)throw Error("GitHub attestation unavailable");
const token=(await r.json()).value;
if(typeof token!=="string")throw Error("Missing GitHub identity attestation");
const response=await fetch(
 "https://agknxlowackphvwyvxge.supabase.co/functions/v1/studio-drive-owner-preflight",
 {method:"POST",redirect:"error",headers:{Authorization:"Bearer "+token},
  signal:AbortSignal.timeout(50000)}
);
const report=await response.json().catch(()=>({status:"unparseable"}));
const allowed=new Set(["google_oauth_secrets_missing","google_refresh_invalid_grant",
 "google_refresh_invalid_client","google_refresh_unauthorized_client",
 "google_refresh_invalid_request","google_refresh_access_denied","google_refresh_other",
 "google_access_token_missing","google_drive_about_denied",
 "google_drive_owner_not_approved","google_drive_api_or_scope_denied",
 "google_owner_authorized_and_drive_api_ready","connection_unavailable"]);
const label=allowed.has(report?.status)||(
 typeof report?.status==="string"&&/^google_drive_about_(401|403|404|429)_(accessNotConfigured|insufficientPermissions|forbidden|dailyLimitExceeded|rateLimitExceeded|SERVICE_DISABLED|ACCESS_TOKEN_SCOPE_INSUFFICIENT|PERMISSION_DENIED|other)$/.test(report.status)
 )?report.status:"unexpected_response";
console.log("Central Google Drive owner verification:",label,"HTTP",response.status);
if(response.status!==200||label!=="google_owner_authorized_and_drive_api_ready")
 throw Error("Owner Google Drive connection is not yet ready: "+label);
