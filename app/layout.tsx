import type { Metadata } from "next";

const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
import PwaRegister from "@/components/pwa-register";
import WorkspaceLayout from "@/components/workspace-layout";
import "./globals.css";

export const metadata: Metadata = {
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
        <PwaRegister />
        <WorkspaceLayout>{children}</WorkspaceLayout>
      </body>
    </html>
  );
}
