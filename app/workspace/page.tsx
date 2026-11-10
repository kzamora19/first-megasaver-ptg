import { withBasePath } from "@/lib/base-path";

export const metadata = {
  title: "Get Branchline Workspace",
  description: "Open Sales Tracker and Price Tag Generator in Branchline Workspace on Windows, Android or iPhone.",
};

export default function WorkspaceDownloadPage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">BRANCHLINE · INSTALLATION</p>
        <h1>Branchline Workspace</h1>
        <p className="intro">Open Sales Tracker and Price Tag Generator in one window using the account details for each app.</p>
      </section>
      <section className="panel install-panel">
        <h2>Android and iPhone</h2>
        <p>Open the mobile workspace to use Sales Tracker and Price Tag Generator from one home-screen icon.</p>
        <p><a className="admin-link" href={withBasePath("/workspace/mobile/")}>Open Branchline Workspace on mobile →</a></p>
        <ol>
          <li>On Android, open the mobile workspace in Chrome and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
          <li>On iPhone, open it in Safari, then choose <strong>Share → Add to Home Screen</strong>.</li>
        </ol>
      </section>
      <section className="panel install-panel">
        <h2>Install on Windows</h2>
        <p><a className="admin-link" href={withBasePath("/branchline-workspace-setup.exe")} download="Branchline Workspace Setup.exe">
          Download Branchline Workspace Setup.exe
        </a></p>
        <ol>
          <li>Run <strong>Branchline Workspace Setup.exe</strong>.</li>
          <li>Open <strong>Branchline Workspace</strong> from the Start menu.</li>
          <li>Choose <strong>Sales Tracker</strong> or <strong>Price Tag Generator</strong> and sign in with the details for that app.</li>
        </ol>
        <p className="admin-muted">Requires x64 Windows, an internet connection, and the Microsoft Edge WebView2 Runtime. Setup links to Microsoft’s download if the runtime is missing.</p>
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
