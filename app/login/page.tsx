"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand">FIRST MEGASAVER</div>
        <p className="auth-eyebrow">SECURE ACCESS</p>
        <h1>Price Tag Generator</h1>
        <p className="auth-intro">Sign in using your existing username and your assigned password.</p>
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="username">USERNAME</label>
          <input id="username" autoComplete="username" value={username}
            onChange={(event) => setUsername(event.target.value)} required maxLength={120} />
          <label htmlFor="password">PASSWORD</label>
          <input id="password" type="password" autoComplete="current-password" value={password}
            onChange={(event) => setPassword(event.target.value)} required maxLength={1024} />
          <label htmlFor="branchCode">BRANCH CODE <span>(optional)</span></label>
          <input id="branchCode" autoComplete="organization" value={branchCode}
            onChange={(event) => setBranchCode(event.target.value.toUpperCase())}
            placeholder="e.g. STG01" maxLength={30} />
          <button type="submit" disabled={busy}>{busy ? "AUTHENTICATING…" : "SIGN IN"}</button>
        </form>
        <p className="auth-message" role="status">{message}</p>
        <p className="auth-footnote">Development environment · No production records connected</p>
      </section>
    </main>
  );
}
