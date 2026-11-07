"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [appHeaderLogo, setAppHeaderLogo] = useState("/legacy-ptg/app-header.png");

  useEffect(() => {
    fetch("/api/logos", { cache: "no-store" }).then(response => response.json()).then(result => {
      if (result.ok && result.logos?.appHeader?.url) setAppHeaderLogo(result.logos.appHeader.url);
    }).catch(() => {});
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");

    try {
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
      setPassword("");
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setMessage("Unable to connect to the authentication service. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell legacy-login-shell">
      <section className="auth-card legacy-login-card">
        <div className="legacy-login-header">
          <img src={appHeaderLogo} alt="1st Megasaver · Appliance · Gadgets · Furniture" />
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
            <a href="/admin/accounts">SYSTEM SECURITY ADMINISTRATION</a>
            <div><span className="legacy-security-dot" />Protected by System Security</div>
          </div>
          <p className="legacy-login-footnote">Development environment · No production records connected</p>
        </div>
      </section>
      <style jsx global>{`
        .legacy-login-shell{background:radial-gradient(ellipse at 50% 0,#f7fbff 0,#eaf2fb 70%,#e5edf7 100%)!important}
        .legacy-login-card{width:min(510px,100%)!important;padding:0!important;overflow:hidden;border-radius:20px!important;box-shadow:0 22px 54px rgba(27,61,103,.16)!important}
        .legacy-login-header{position:relative;display:flex;align-items:center;justify-content:center;min-height:138px;padding:18px 24px;background:linear-gradient(135deg,#075fc6 0%,#075fc6 35%,#123b7a 100%);overflow:hidden}
        .legacy-login-header:after{content:"";position:absolute;right:-80px;top:-95px;width:235px;height:235px;border-radius:50%;background:rgba(255,255,255,.06)}
        .legacy-login-header img{position:relative;z-index:1;display:block;width:min(100%,470px);max-height:105px;height:auto;object-fit:contain}
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
        .legacy-login-security>a{color:#123b72;font-size:11px;font-weight:900;text-decoration:none}
        .legacy-login-security>div{display:flex;align-items:center;gap:9px;color:#123b72;font-size:11px;font-weight:700}
        .legacy-security-dot{width:9px;height:9px;border-radius:50%;background:#00c96b;box-shadow:0 0 9px rgba(0,201,107,.5)}
        .legacy-login-footnote{margin:17px 0 0;color:#8792a2;font-size:9px;text-align:center}
        @media(max-width:520px){.legacy-login-card{border-radius:15px!important}.legacy-login-header{min-height:112px;padding:16px 18px}.legacy-login-body{padding:23px 20px 25px}}
      `}</style>
    </main>
  );
}
