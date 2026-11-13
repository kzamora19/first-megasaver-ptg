"use client";
import {useCallback,useEffect,useState} from "react";
import { useRouter } from "next/navigation";
import AppDialog from "@/components/app-dialog";
import { useAppConfirm } from "@/components/app-confirm";
import { requestPtgAccounts, usesEdgeAccounts } from "@/lib/ptg/accounts-client";
type Account={id:string;display_name:string;role_key:string;legacy_role:string;branch_id:string|null;email:string|null;invitation_status:string;invited_at:string|null;invitation_expires_at:string|null;invitation_accepted_at:string|null;activated_at:string|null;is_active:boolean;failed_login_attempts:number;locked_until:string|null;must_change_password:boolean;created_at:string};
type Branch={id:string;branch_code:string;branch_name:string;status:string;operational_status:string};
export default function AccountAdministration({role, scope = "all"}:{role:string;scope?:"all"|"system"|"branch"}){
 const confirm=useAppConfirm();
 const router=useRouter();
 const [viewerId,setViewerId]=useState<string|null>(null);
 const [createOpen,setCreateOpen]=useState(false);
 const [accounts,setAccounts]=useState<Account[]>([]),[branches,setBranches]=useState<Branch[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(""),[notice,setNotice]=useState(""),[error,setError]=useState(""),[search,setSearch]=useState("");
 const [username,setUsername]=useState(""),[displayName,setDisplayName]=useState(""),[email,setEmail]=useState(""),[newRole,setNewRole]=useState(scope === "system" ? "SYSTEM_ADMIN" : "BRANCH_USER"),[legacyRole,setLegacyRole]=useState("BRANCH USER"),[branchId,setBranchId]=useState("");
 const load=useCallback(async()=>{setLoading(true);setError("");try{const r=usesEdgeAccounts?await requestPtgAccounts("GET"):await fetch("/api/admin/accounts",{cache:"no-store"}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.message||"Unable to load accounts.");setAccounts(d.accounts||[]);setViewerId(d.viewerId??null);setBranches(d.branches||[]);const activeBranches=(d.branches||[]).filter((branch:Branch)=>branch.status==="ACTIVE"&&branch.operational_status==="ON");if(!activeBranches.some((branch:Branch)=>branch.id===branchId))setBranchId(activeBranches[0]?.id||"");}catch(e){setError(e instanceof Error?e.message:"Unable to load accounts.");}finally{setLoading(false);}},[branchId]);
 // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch is the page bootstrap.
 useEffect(()=>{void load();},[load]);
 const scoped = accounts.filter(a => scope === "all" || (scope === "system" ? !a.branch_id : !!a.branch_id));
 const q = search.toLowerCase().trim();
 const filtered = q ? scoped.filter(a=>[a.display_name,a.legacy_role,a.role_key].some(x=>(x||"").toLowerCase().includes(q))) : scoped;
 async function create(e:React.FormEvent){e.preventDefault();setBusy("create");setError("");setNotice("");try{const payload={username,displayName,email,role:newRole,legacyRole,branchId:newRole.startsWith("BRANCH_")?branchId:null};const r=usesEdgeAccounts?await requestPtgAccounts("POST",{...payload,action:"createAccount"}):await fetch("/api/admin/accounts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.message||"Account creation failed.");setCreateOpen(false);setNotice("Invitation sent to "+email+". The account remains inactive until the employee accepts the invitation.");setUsername("");setDisplayName("");setEmail("");await load();}catch(e){setError(e instanceof Error?e.message:"Account creation failed.");}finally{setBusy("");}}
 async function resend(a:Account){if(!await confirm({title:"Resend invitation?",message:"Send a new invitation and temporary password to "+a.email+". This invalidates the previous invitation and signs out active sessions.",label:"Resend invitation"}))return;setBusy(a.id);setError("");setNotice("");try{const r=usesEdgeAccounts?await requestPtgAccounts("POST",{action:"resendInvitation",userId:a.id}):await fetch("/api/admin/accounts/"+encodeURIComponent(a.id)+"/invitation",{method:"POST"}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.message||"Unable to resend invitation.");setNotice("A new invitation was sent to "+a.email+".");await load();}catch(e){setError(e instanceof Error?e.message:"Unable to resend invitation.");}finally{setBusy("");}}
 async function act(a:Account,action:"RESET_PASSWORD"|"SET_STATUS"|"FORCE_LOGOUT"|"DELETE_USER",enabled?:boolean){const what=action==="DELETE_USER"?"permanently delete "+a.display_name:action==="RESET_PASSWORD"?"reset this password":action==="FORCE_LOGOUT"?"force logout all sessions":enabled?"enable this account":"disable this account";if(!await confirm({title:"Confirm account action",message:"Do you want to "+what+"?",label:action==="DELETE_USER"?"Delete user":"Confirm",danger:action==="DELETE_USER"||action==="FORCE_LOGOUT"||(action==="SET_STATUS"&&!enabled)}))return;setBusy(a.id);setError("");setNotice("");try{const payload={action,...(action==="SET_STATUS"?{enabled}:{})};const r=usesEdgeAccounts?await requestPtgAccounts("PATCH",payload,{userId:a.id}):await fetch("/api/admin/accounts/"+encodeURIComponent(a.id),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.message||"Account action failed.");setNotice(action==="DELETE_USER"?"User deleted.":action==="RESET_PASSWORD"?(a.role_key==="BRANCH_USER"?"New password emailed.":"Temporary password emailed. The user must change it at next sign-in."):action==="FORCE_LOGOUT"?"All active sessions revoked.":enabled?"Account enabled.":"Account disabled; active sessions revoked.");await load();}catch(e){setError(e instanceof Error?e.message:"Account action failed.");}finally{setBusy("");}}
 const systemAdmin=role==="SYSTEM_ADMIN";
 const canCreate=systemAdmin||role==="BRANCH_ADMIN";
 return <div className="admin-layout">
 <section className="admin-toolbar"><div><p className="admin-kicker">SYSTEM SECURITY</p><h2>Account administration</h2><p className="admin-muted">Provision accounts, manage access, and revoke sessions. Permissions are enforced on the server and actions are audited.</p></div><button className="admin-button secondary" onClick={()=>void load()} disabled={loading}>Refresh</button></section>
 {notice&&<p className="admin-alert success" role="status">{notice}</p>}{error&&!createOpen&&<p className="admin-alert error" role="alert">{error}</p>}
 {canCreate&&<div><button className="admin-button" type="button" disabled={loading} onClick={()=>{setError("");setCreateOpen(true);}}>Create user</button></div>}
 {canCreate&&createOpen&&<AppDialog title="Create user" busy={busy==="create"} onClose={()=>{setError("");setCreateOpen(false);}}>
 {error&&<p className="admin-alert error" role="alert">{error}</p>}<form className="admin-form" onSubmit={create}>
 <label>Username<input value={username} onChange={e=>setUsername(e.target.value.toUpperCase())} minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" required autoComplete="off"/></label>
 <label>Full name<input value={displayName} onChange={e=>setDisplayName(e.target.value)} maxLength={120} required/></label>
 <label>Account email<input type="email" value={email} onChange={e=>setEmail(e.target.value.trim())} maxLength={254} required autoComplete="email"/></label>
 <label>Role<select value={newRole} onChange={e=>{const v=e.target.value;setNewRole(v);setLegacyRole(v==="BRANCH_ADMIN"?"BRANCH ADMIN":v==="BRANCH_USER"?"BRANCH USER":"");}}>{scope !== "system" && <option value="BRANCH_USER">Branch User</option>}{role === "SYSTEM_ADMIN" && scope !== "system" && <option value="BRANCH_ADMIN">Branch Admin / Manager</option>}{role === "SYSTEM_ADMIN" && scope !== "branch" && <option value="SYSTEM_ADMIN">System Admin</option>}</select></label>
 {newRole.startsWith("BRANCH_")&&<label>Employee title<select value={legacyRole} onChange={e=>setLegacyRole(e.target.value)}>{newRole==="BRANCH_ADMIN"?<><option value="BRANCH ADMIN">Branch Admin</option><option value="BRANCH MANAGER">Branch Manager</option></>:<><option value="BRANCH USER">Branch User</option><option value="TEAM LEADER">Team Leader</option></>}</select></label>}
 {newRole.startsWith("BRANCH_")&&<label>Branch<select value={branchId} onChange={e=>setBranchId(e.target.value)} required>{branches.filter(b=>b.status==="ACTIVE"&&b.operational_status==="ON").map(b=><option key={b.id} value={b.id}>{b.branch_code} — {b.branch_name}</option>)}</select></label>}
 
 <button className="admin-button" type="submit" disabled={busy==="create"||(newRole.startsWith("BRANCH_")&&!branchId)}>{busy==="create"?"Creating…":"Create account"}</button></form></AppDialog>}
 <section className="admin-card"><div className="admin-list-heading"><div><h3>Existing accounts</h3><p className="admin-muted">{scoped.length} account(s) in your authorized scope</p></div><input aria-label="Search accounts" placeholder="Search accounts…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
 {loading?<p className="admin-muted">Loading accounts…</p>:filtered.length===0?<p className="admin-muted">No accounts found in this scope.</p>:<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Account</th><th>Role</th><th>Email / Invitation</th><th>Status</th><th>Security</th><th>Actions</th></tr></thead><tbody>{filtered.map(a=><tr key={a.id}><td><strong>{a.display_name||"Unnamed"}</strong><small>{a.legacy_role||a.role_key}</small></td><td>{a.role_key.replaceAll("_"," ")}{a.branch_id&&<small>{branches.find(b=>b.id===a.branch_id)?.branch_code||"Assigned branch"}</small>}</td><td>{a.email||"—"}<small>{(a.invitation_status||"ACTIVATED").replaceAll("_"," ")}</small></td><td><span className={a.is_active?"admin-status active":"admin-status inactive"}>{a.is_active?"ACTIVE":"DISABLED"}</span></td><td>{a.must_change_password?<span className="admin-status warning">Change password required</span>:<span className="admin-muted">Normal</span>}{a.locked_until&&<small>Lock timestamp: {new Date(a.locked_until).toLocaleString()}</small>}</td><td>{(systemAdmin||a.role_key==="BRANCH_USER"||a.id===viewerId)?<select aria-label={"Actions for " + a.display_name} value="" disabled={!!busy}
 onChange={event=>{
   switch(event.currentTarget.value){
     case "self": router.push("/change-password/"); break;
     case "reset": void act(a,"RESET_PASSWORD"); break;
     case "resend": void resend(a); break;
     case "logout": void act(a,"FORCE_LOGOUT"); break;
     case "status": void act(a,"SET_STATUS",!a.is_active); break;
     case "delete": void act(a,"DELETE_USER"); break;
   }
 }}>
 <option value="">Actions…</option>
 {!systemAdmin&&a.id===viewerId&&<option value="self">Change my password</option>}
 {(systemAdmin||a.role_key==="BRANCH_USER")&&<option value="reset" disabled={!a.email||a.role_key==="SYSTEM_ADMIN"}>Email password reset</option>}
 {systemAdmin&&a.role_key!=="SYSTEM_ADMIN"&&["PENDING","SENT","EXPIRED"].includes(a.invitation_status)&&<option value="resend" disabled={!a.email}>Resend invitation</option>}
 {systemAdmin&&<option value="logout">Force logout</option>}
 {systemAdmin&&<option value="status" disabled={!a.is_active&&["PENDING","SENT"].includes(a.invitation_status)}>{a.is_active?"Disable":"Enable"}</option>}
 {usesEdgeAccounts&&role==="SYSTEM_ADMIN"&&a.branch_id&&a.role_key!=="SYSTEM_ADMIN"&&<option value="delete">Delete user</option>}
 </select>:<span className="admin-muted">View only</span>}</td></tr>)}</tbody></table></div>}</section>
 <p className="admin-footnote">{role.startsWith("SYSTEM_")?"System-wide account visibility is controlled by your role.":"Branch Admin access is restricted to accounts in your branch."} Passwords are generated automatically and sent only to the registered employee email.</p>
 </div>;
}
