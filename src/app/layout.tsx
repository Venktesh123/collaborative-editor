// WRONG — remove this if present
import { Html, Head, Main, NextScript } from "next/document";

// CORRECT — layout.tsx should look like this
import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Collabdoc",
  description: "Collaborative Document Editor",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}