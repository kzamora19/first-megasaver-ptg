import {signRetention} from "./retention-envelope.mjs";
export const REMOTE_RETENTION_PROJECTS={
 sales:{label:"Sales Tracker",ref:"psoopubvdpwztzkdyifa",secret:"RETENTION_RELAY_SALES_SECRET"},
 megaframe:{label:"MegaFrame Studio",ref:"vmyoxoiygfcecgkbavgg",secret:"RETENTION_RELAY_MEGAFRAME_SECRET"},
 flyer:{label:"MegaFlyer Studio",ref:"tzklsscoiwnmeantcefw",secret:"RETENTION_RELAY_FLYER_SECRET"}
} as const;
type RemoteProject=keyof typeof REMOTE_RETENTION_PROJECTS;
type Actor={userId:string;role:string;mustChangePassword:boolean};
type RemoteResult={ok:boolean;data?:unknown;cleanup?:unknown};
export function isRemoteRetentionProject(value:unknown):value is RemoteProject{
 return typeof value==="string"&&Object.prototype.hasOwnProperty.call(REMOTE_RETENTION_PROJECTS,value);
}
// Caller must be an already verified active PTG application session.
// No remote service key, arbitrary URL, or secret enters the browser.
export async function remoteRetentionRequest(session:Actor,project:unknown,action:"overview"|"configure"|"hold"|"cleanup"|"notices",params:Record<string,unknown>={}):Promise<RemoteResult>{
 if(session.role!=="SYSTEM_ADMIN"||session.mustChangePassword||!isRemoteRetentionProject(project))throw Error("Forbidden");
 const config=REMOTE_RETENTION_PROJECTS[project],secret=Deno.env.get(config.secret)??"";
 if(secret.length<32)throw Error("Remote storage relay not configured");
 const time=String(Date.now()),body=JSON.stringify({...params,actorId:session.userId,action,requestId:crypto.randomUUID()});
 const signature=await signRetention(secret,config.ref,time,body);
 const response=await fetch("https://"+config.ref+".supabase.co/functions/v1/branchline-retention",{method:"POST",headers:{"Content-Type":"application/json","x-branchline-retention-time":time,"x-branchline-retention-signature":signature},body,redirect:"error",signal:AbortSignal.timeout(action==="cleanup"?120000:5000)});
 const result=await response.json();
 if(!response.ok||result?.ok!==true)throw Error("Remote retention request not confirmed");
 return result as RemoteResult;
}
