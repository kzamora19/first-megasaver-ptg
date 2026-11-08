"use client";

import { FormEvent, useEffect, useState } from "react";
import AppDialog from "@/components/app-dialog";
import { requestPtgAccounts } from "@/lib/ptg/accounts-client";
import { useRouter } from "next/navigation";
import { establishPtgAuthSession, invokePtgAuth, usesEdgeAuth } from "@/lib/ptg/auth-client";
import { withBasePath } from "@/lib/base-path";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryDone, setRecoveryDone] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("reset");
    if (token) {
      setResetToken(token);
      setRecovery(true);
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, []);

  function closeRecovery() {
    setRecovery(false);
    setResetToken("");
    setRecoveryMessage("");
    setRecoveryDone(false);
  }

  async function submitRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (recoveryBusy || recoveryDone) return;
    const form = new FormData(event.currentTarget);
    setRecoveryBusy(true);
    setRecoveryMessage("");
    try {
      const response = await requestPtgAccounts("POST", resetToken
        ? { action: "finishPasswordRecovery", token: resetToken, password: form.get("password"), confirmPassword: form.get("confirmPassword") }
        : { action: "forgotPassword", username: form.get("username"), branchCode: form.get("branchCode") });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "Password recovery is temporarily unavailable.");
      if (resetToken) {
        setNotice("Password updated. Sign in with your new password.");
        setPassword("");
        closeRecovery();
      } else {
        setRecoveryMessage("If the account is eligible, PTG will email recovery instructions to the registered address or notify the branch administrators.");
        setRecoveryDone(true);
      }
    } catch (error) {
      setRecoveryMessage(error instanceof Error ? error.message : "Unable to reach PTG. Please try again.");
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");

    try {
      let destination = "/dashboard";
      if (usesEdgeAuth) {
        const result = await invokePtgAuth("login", { username, password, branchCode });
        await establishPtgAuthSession(result);
        destination = result.account?.mustChangePassword ? "/change-password" : result.account?.role === "SYSTEM_ADMIN" ? "/dashboard" : "/products";
      } else {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ username, password, branchCode }),
        });
        const result = await response.json();
        if (!response.ok || result.ok !== true) {
          setMessage(result.message ?? "Unable to sign in.");
          return;
        }
      }
      setPassword("");
      router.replace(destination);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to connect to the authentication service. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell legacy-login-shell">
      <section className="auth-card legacy-login-card">
        <div className="legacy-login-header">
          <img src={withBasePath("/legacy-ptg/login-logo.png")} alt="1st Megasaver · Appliance · Gadgets · Furniture" />
        </div>
        <div className="legacy-login-body">
          <form onSubmit={submit} className="legacy-login-form">
            <label htmlFor="username">USERNAME</label>
            <input id="username" autoComplete="username" value={username}
              onChange={(event) => setUsername(event.target.value)} required maxLength={120} />
            <label htmlFor="password">PASSWORD</label>
            <input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password}
              onChange={(event) => setPassword(event.target.value)} required maxLength={1024} />
            <label className="legacy-show-password">
              <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
              <span>Show password</span>
            </label>
            <details className="legacy-branch-option">
              <summary>Branch code (optional)</summary>
              <input id="branchCode" autoComplete="organization" value={branchCode}
                onChange={(event) => setBranchCode(event.target.value.toUpperCase())}
                placeholder="e.g. STG01" maxLength={30} aria-label="Branch code" />
            </details>
            <button type="submit" disabled={busy}>{busy ? "AUTHENTICATING…" : "🔒 SIGN IN"}</button>
          </form>
          <p className="legacy-login-message" role="status">{message}</p>
          <div className="legacy-login-security">
            <button className="legacy-forgot-button" type="button" onClick={() => setRecovery(true)}>Forgot password?</button>
            <div><span className="legacy-security-dot" />Protected by System Security</div>
          </div>
          {notice && <p className="legacy-recovery-notice" role="status">{notice}</p>}
        </div>
      </section>
      {recovery && <AppDialog title={resetToken ? "Choose a new password" : "Forgot password"} busy={recoveryBusy} closeIcon onClose={closeRecovery}>
        {!recoveryDone && <form className="auth-form" onSubmit={submitRecovery}>
          {resetToken ? <>
            <label htmlFor="recovery-password">New password</label>
            <input id="recovery-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required />
            <label htmlFor="recovery-confirm">Confirm password</label>
            <input id="recovery-confirm" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required />
          </> : <>
            <p>Enter your username. Add your branch code if the username is shared across branches.</p>
            <label htmlFor="recovery-username">Username</label>
            <input id="recovery-username" name="username" autoComplete="username" defaultValue={username} maxLength={120} required />
            <label htmlFor="recovery-branch">Branch code (optional)</label>
            <input id="recovery-branch" name="branchCode" defaultValue={branchCode} maxLength={30} />
          </>}
          <button type="submit" disabled={recoveryBusy}>{recoveryBusy ? "Please wait…" : resetToken ? "Update password" : "Request password recovery"}</button>
        </form>}
        {recoveryMessage && <p role="status">{recoveryMessage}</p>}
      </AppDialog>}
      <style jsx global>{`
        .legacy-login-shell{background:radial-gradient(ellipse at 50% 0,#f7fbff 0,#eaf2fb 70%,#e5edf7 100%)!important}
        .legacy-login-card{width:min(510px,100%)!important;padding:0!important;overflow:hidden;border-radius:20px!important;box-shadow:0 22px 54px rgba(27,61,103,.16)!important}
        .legacy-login-header{position:relative;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#075fc6 0%,#075fc6 35%,#123b7a 100%);overflow:hidden}
        .legacy-login-header img{position:relative;z-index:1;display:block;width:100%;height:auto;object-fit:contain}
        .legacy-login-body{padding:29px 32px 27px;background:#fff}
        .legacy-login-form{display:grid;gap:8px}
        .legacy-login-form>label:not(.legacy-show-password){margin-top:2px;color:#123b72;font-size:11px;font-weight:900;letter-spacing:.03em}
        .legacy-login-form>input{width:100%;height:46px;padding:0 13px;border:1px solid #cfdaea;border-radius:9px;background:#e8f0fc;color:#172033;font:inherit;font-size:14px;outline:none}
        .legacy-login-form>input:focus{border-color:#3078d6;background:#fff;box-shadow:0 0 0 3px rgba(48,120,214,.14)}
        .legacy-show-password{display:flex;align-items:center;gap:7px;color:#65728a;font-size:12px;font-weight:600}
        .legacy-show-password input{width:14px;height:14px;margin:0;accent-color:#1263c7}
        .legacy-branch-option{display:grid;gap:7px;color:#758398;font-size:11px}
        .legacy-branch-option summary{cursor:pointer}
        .legacy-branch-option input{width:100%;height:40px;padding:0 12px;border:1px solid #cfdaea;border-radius:8px;font:inherit}
        .legacy-login-form button{height:48px;margin-top:10px;border:0;border-radius:10px;background:linear-gradient(100deg,#0866d4,#153d7d);color:#fff;font-size:16px;font-weight:900;letter-spacing:.02em;box-shadow:0 7px 14px rgba(18,66,132,.18);cursor:pointer}
        .legacy-login-form button:disabled{opacity:.65;cursor:wait}
        .legacy-login-message{min-height:20px;margin:10px 0 0;color:#b3261e;font-size:12px;line-height:1.4;text-align:center}
        .legacy-login-security{display:grid;justify-items:center;gap:13px;margin:22px 0 0}
        .legacy-forgot-button{border:0;background:transparent;color:#123b72;font:inherit;font-size:12px;font-weight:800;text-decoration:underline;cursor:pointer}
        .legacy-login-security>div{display:flex;align-items:center;gap:9px;color:#123b72;font-size:11px;font-weight:700}
        .legacy-security-dot{width:9px;height:9px;border-radius:50%;background:#00c96b;box-shadow:0 0 9px rgba(0,201,107,.5)}
        .legacy-recovery-notice{margin:14px 0 0;color:#17643c;font-size:12px;text-align:center}
        @media(max-width:520px){.legacy-login-card{border-radius:15px!important}.legacy-login-body{padding:23px 20px 25px}}
      `}</style>
    </main>
  );
}
