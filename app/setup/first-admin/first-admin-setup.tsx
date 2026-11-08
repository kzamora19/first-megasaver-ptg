"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { requestPtgAccounts, usesEdgeAccounts } from "@/lib/ptg/accounts-client";

export default function FirstAdminSetup() {
  const router = useRouter();
  const [setupSecret, setSetupSecret] = useState("");
  const [bootstrapCode, setBootstrapCode] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function openWindow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = usesEdgeAccounts ? await requestPtgAccounts("POST", { action: "bootstrapStart", setupSecret }) : await fetch("/api/setup/first-admin/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ setupSecret }),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        setMessage(result.message ?? "Unable to open the initialization window.");
        return;
      }
      setBootstrapCode(result.bootstrapCode);
      setSetupSecret("");
      setMessage("Initialization window opened. The one-time code expires in 15 minutes.");
    } catch {
      setMessage("Unable to connect to the setup service.");
    } finally {
      setBusy(false);
    }
  }

  async function createFirstAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (password.length < 12) {
      setMessage("Use an initial password of at least 12 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = usesEdgeAccounts ? await requestPtgAccounts("POST", { action: "bootstrapFinish", bootstrapCode, username, displayName, password }) : await fetch("/api/setup/first-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ bootstrapCode, username, displayName, password }),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        setMessage(result.message ?? "Unable to initialize the first System Admin.");
        return;
      }
      setPassword("");
      setConfirmPassword("");
      setBootstrapCode("");
      setMessage("First System Admin created. Sign in with the new account; a password change is required.");
      router.replace("/login");
    } catch {
      setMessage("Unable to connect to the setup service.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-card setup-card">
      <div className="auth-brand">FIRST MEGASAVER</div>
      <p className="auth-eyebrow">L1 · SYSTEM INITIALIZATION</p>
      <h1>First System Admin</h1>
      <p className="auth-intro">
        One-time initialization is available only while no System Admin account exists.
        The bootstrap code expires after 15 minutes and is invalidated after successful creation.
      </p>
      {!bootstrapCode ? (
        <form onSubmit={openWindow} className="auth-form">
          <label htmlFor="setupSecret">SETUP AUTHORIZATION SECRET</label>
          <input id="setupSecret" type="password" autoComplete="off" value={setupSecret}
            onChange={(event) => setSetupSecret(event.target.value)} required maxLength={512} />
          <button type="submit" disabled={busy}>{busy ? "OPENING…" : "OPEN ONE-TIME SETUP WINDOW"}</button>
        </form>
      ) : (
        <>
          <div className="setup-code">
            <label htmlFor="bootstrapCode">ONE-TIME BOOTSTRAP CODE</label>
            <input id="bootstrapCode" value={bootstrapCode} readOnly />
            <small>Keep this code private. It is valid for 15 minutes.</small>
          </div>
          <form onSubmit={createFirstAdmin} className="auth-form">
            <label htmlFor="username">USERNAME</label>
            <input id="username" value={username} onChange={(event) => setUsername(event.target.value.toUpperCase())}
              required minLength={3} maxLength={32} autoComplete="off" />
            <label htmlFor="displayName">DISPLAY NAME</label>
            <input id="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)}
              required maxLength={80} />
            <label htmlFor="password">INITIAL PASSWORD <span>(minimum 12 characters)</span></label>
            <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)}
              required minLength={12} maxLength={1024} autoComplete="new-password" />
            <label htmlFor="confirmPassword">CONFIRM PASSWORD</label>
            <input id="confirmPassword" type="password" value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)} required maxLength={1024}
              autoComplete="new-password" />
            <button type="submit" disabled={busy}>{busy ? "CREATING…" : "CREATE FIRST SYSTEM ADMIN"}</button>
          </form>
        </>
      )}
      <p className="auth-message" role="status">{message}</p>
      <p className="auth-footnote">The password is handled by Supabase Auth. It is never written to application logs or audit records.</p>
    </section>
  );
}
