import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "First Megasaver PTG",
  description: "First Megasaver Price Tag Generator",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
