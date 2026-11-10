import type { Metadata } from "next";
import { withBasePath } from "@/lib/base-path";
import MobileWorkspace from "./workspace";

export const metadata: Metadata = {
  title: "Branchline Workspace",
  applicationName: "Branchline Workspace",
  manifest: withBasePath("/workspace-mobile.webmanifest"),
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Branchline Workspace" },
  icons: {
    icon: { url: "/branchline/icons/icon-192.png", type: "image/png" },
    apple: { url: "/branchline/icons/icon-192.png", type: "image/png" },
  },
};

export default function WorkspaceMobilePage() {
  return <MobileWorkspace />;
}
