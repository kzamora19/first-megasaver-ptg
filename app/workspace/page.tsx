import { withBasePath } from "@/lib/base-path";

export const metadata = {
  title: "Get Branchline Workspace",
  description: "Open Branchline Workspace in your browser on Ubuntu, Windows, Android or iPhone.",
};

export default function WorkspaceDownloadPage() {
  return (
    <main className="shell">
      <section className="hero">
        <h1>Branchline Workspace</h1>
        <p className="intro">Open Sales Tracker and Price Tag Generator in one window using the account details for each app.</p>
      </section>
      <section className="panel install-panel">
        <h2>Ubuntu and other computers</h2>
        <p><a className="admin-button" href={withBasePath("/workspace/mobile/")}>Open Branchline Workspace in your browser</a></p>
        <p>Choose an app and sign in with your existing account. On Ubuntu, you can use Workspace in the browser with no download.</p>
        <p>To add an app icon in Chrome, open Workspace and choose <strong>⋮ → Cast, save, and share → Install page as app</strong>.</p>
        <p>Open an app directly</p>
        <p><a className="admin-link" href="https://kzamora19.github.io/branchline/">Sales Tracker</a>
          {" · "}<a className="admin-link" href={withBasePath("/login/")}>Price Tag Generator</a></p>
      </section>
      <section className="panel install-panel">
        <h2>Android and iPhone</h2>
        <p><a className="admin-link" href={withBasePath("/workspace/mobile/")}>Open Branchline Workspace on your phone →</a></p>
        <ol>
          <li>On Android, open the mobile workspace in Chrome and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
          <li>On iPhone, open it in Safari, then choose <strong>Share → Add to Home Screen</strong>.</li>
        </ol>
      </section>
      <section className="panel install-panel">
        <h2>Windows installer</h2>
        <p><a className="admin-link" href={withBasePath("/branchline-workspace-setup.exe")} download="Branchline Workspace Setup.exe">
          Download Branchline Workspace Setup.exe
        </a></p>
        <ol>
          <li>Run <strong>Branchline Workspace Setup.exe</strong>.</li>
          <li>Open <strong>Branchline Workspace</strong> from the Start menu.</li>
          <li>Choose <strong>Sales Tracker</strong> or <strong>Price Tag Generator</strong> and sign in with the details for that app.</li>
        </ol>
        <p className="admin-muted">This installer requires x64 Windows, an internet connection, and the Microsoft Edge WebView2 Runtime. Setup links to Microsoft’s download if the runtime is missing.</p>
      </section>
    </main>
  );
}
