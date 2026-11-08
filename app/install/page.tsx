import InstallApp from "@/components/install-app";
import { withBasePath } from "@/lib/base-path";

export const metadata = {
  title: "Install Branchline PTG",
  description: "Installation instructions for Branchline Price Tag Generator.",
};

export default function InstallPage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">BRANCHLINE · APP INSTALLATION</p>
        <h1>Install PTG</h1>
        <p className="intro">Add Branchline Price Tag Generator to your device for quick access. Installation does not create a separate account; sign in using your assigned PTG credentials.</p>
      </section>
      <section className="panel install-panel">
        <h2>Install on this device</h2>
        <InstallApp />
      </section>
      <section className="panel install-panel">
        <h2>Ubuntu / Windows desktop</h2>
        <ol>
          <li>Open the PTG website in Google Chrome or Microsoft Edge.</li>
          <li>Select the install icon in the address bar, or open the browser menu.</li>
          <li>Choose <strong>Install app</strong> and confirm.</li>
          <li>Launch Branchline PTG from your desktop or application launcher.</li>
        </ol>
      </section>
      <section className="panel install-panel">
        <h2>Android</h2>
        <ol>
          <li>Open the PTG website in Google Chrome.</li>
          <li>Tap the browser menu, then choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
          <li>Confirm and open PTG from your home screen.</li>
        </ol>
      </section>
      <section className="panel install-panel">
        <h2>iPhone / iPad</h2>
        <ol>
          <li>Open the PTG website in Safari.</li>
          <li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong>, then launch PTG from your home screen.</li>
        </ol>
      </section>
      <section className="panel install-panel">
        <h2>Important reminders</h2>
        <ul className="install-reminders">
          <li>An internet connection is required to sign in and use secure PTG functions.</li>
          <li>Installing PTG does not bypass account permissions or branch restrictions.</li>
          <li>Updates are delivered through the website; you do not need to reinstall for every release.</li>
          <li>For shared branch computers, sign out after use and do not save your password in the browser.</li>
        </ul>
        <p><a className="admin-link" href={withBasePath("/login")}>Continue to PTG sign in →</a></p>
      </section>
    </main>
  );
}
