import type { Metadata } from "next";

const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
import PwaRegister from "@/components/pwa-register";
import release from "@/public/updates/release.json";
import AppConfirmProvider from "@/components/app-confirm";
import WorkspaceLayout from "@/components/workspace-layout";
import "./globals.css";
import "./official-navigation.css";

export const metadata: Metadata = {
  other: { "branchline-web-release": String(release.sequence) },
  title: "Branchline · Price Tag Generator",
  description: "Branchline Price Tag Generator",
  applicationName: "Branchline · Price Tag Generator",
  manifest: `${publicBasePath}/manifest.webmanifest`,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Branchline PTG",
  },
  icons: {
    icon: [{ url: `${publicBasePath}/icons/ptg-icon.svg`, type: "image/svg+xml" }],
    apple: [{ url: `${publicBasePath}/icons/ptg-icon.svg`, type: "image/svg+xml" }],
  },
};

export const viewport = {
  themeColor: "#123b6b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="bl-startup-host">
        <nav className="bl-startup-header" aria-label="Branchline applications">
        <a className="bl-startup-icon" href="/branchline/apps/" aria-label="Branchline Workspace Home">
        <img src={publicBasePath + "/icons/r6/Approved.branchline.png"} alt="" />
        </a>
        <a className="bl-startup-home" href="/branchline/apps/" aria-label="Branchline Workspace Home">
        <img src={publicBasePath + "/icons/r6/BranchlineWordartFull.png"} alt="Branchline" />
        </a>
        <div className="bl-startup-megasaver">
        <img src={publicBasePath + "/icons/r6/FirstMegasaverHeader.png"} alt="1st Megasaver" />
        </div>
        <a className="bl-startup-icon" href="/first-megasaver-ptg/" aria-label="Open Price Tag Generator">
        <img src={publicBasePath + "/icons/r6/Approved.ptg.png"} alt="" />
        </a>
        <a className="bl-startup-icon" href="/branchline/" aria-label="Open Sales Tracker">
        <img src={publicBasePath + "/icons/r6/Approved.sales.png"} alt="" />
        </a>
        <a className="bl-startup-icon" href="/first-megasaver-ptg/studios/?studio=megaframe" aria-label="Open MegaFrame Studio">
        <img src={publicBasePath + "/icons/r6/Approved.megaframe.png"} alt="" />
        </a>
        <a className="bl-startup-icon" href="/first-megasaver-ptg/studios/?studio=flyer" aria-label="Open MegaFlyer Studio">
        <img src={publicBasePath + "/icons/r6/Approved.megaflyer.png"} alt="" />
        </a>
        <span className="bl-startup-spacer" aria-hidden="true">
        </span>
        </nav>
        </div>
        <PwaRegister />
        <AppConfirmProvider><WorkspaceLayout>{children}</WorkspaceLayout></AppConfirmProvider>
      </body>
    </html>
  );
}
