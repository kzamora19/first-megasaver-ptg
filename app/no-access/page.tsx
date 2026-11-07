import Link from "next/link";

export default function NoAccessPage() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">FIRST MEGASAVER · ACCESS CONTROL</p>
        <h1>Access not available</h1>
        <p className="intro">Your account does not have permission to access the Price Tag Generator. Please contact your Branch Admin or System Admin if you believe this is incorrect.</p>
        <Link className="admin-link" href="/login">Return to login →</Link>
      </section>
    </main>
  );
}
