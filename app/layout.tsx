import type { Metadata } from "next";
import PwaRegister from "@/components/pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "Branchline · Price Tag Generator",
  description: "Branchline Price Tag Generator",
  applicationName: "Branchline · Price Tag Generator",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Branchline PTG",
  },
  icons: {
    icon: [{ url: "/icons/ptg-icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/ptg-icon.svg", type: "image/svg+xml" }],
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
        {children}
      </body>
    </html>
  );
}
