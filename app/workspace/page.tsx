import { withBasePath } from "@/lib/base-path";

export const metadata = {
  title: "Branchline Workspace for Windows",
  description: "Download one portable workspace for Sales Tracker and Price Tag Generator.",
};

export default function WorkspaceDownloadPage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">BRANCHLINE · WINDOWS WORKSPACE</p>
        <h1>Branchline Workspace</h1>
        <p className="intro">Open Sales Tracker and Price Tag Generator in one window using the account details for each app.</p>
      </section>
      <section className="panel install-panel">
        <h2>Get the portable workspace</h2>
        <p><a className="admin-link" href={withBasePath("/branchline-workspace-windows.zip")} download>
          Download Branchline Workspace for Windows
        </a></p>
        <ol>
          <li>Extract all files from the ZIP into one folder.</li>
          <li>Open <strong>Branchline Workspace.exe</strong>. If you already have it, open your existing copy.</li>
          <li>Choose <strong>Sales Tracker</strong> or <strong>Price Tag Generator</strong> and sign in with the details for that app.</li>
        </ol>
        <p className="admin-muted">Requires Windows, an internet connection, and the Microsoft Edge WebView2 Runtime.</p>
      </section>
      <section className="panel">
        <h2>Signing in on another device?</h2>
        <p>Use your account to sign in through your browser.</p>
        <p><a className="admin-link" href="https://kzamora19.github.io/branchline/">Sales Tracker</a>
          {" · "}<a className="admin-link" href={withBasePath("/login/")}>Price Tag Generator</a></p>
      </section>
    </main>
  );
}
