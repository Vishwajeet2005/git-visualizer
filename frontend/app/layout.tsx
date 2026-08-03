import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Nexus — AI Repository Intelligence",
    template: "%s | Nexus",
  },
  description:
    "AST-powered semantic search, hybrid RAG retrieval, and 3D dependency visualisation for any codebase.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "Nexus — AI Repository Intelligence",
    description: "Chat with your codebase. Understand dependencies instantly.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="antialiased" style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
