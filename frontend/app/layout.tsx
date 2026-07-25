import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Nexus — Repository Context Engine",
    template: "%s | Nexus",
  },
  description:
    "AST-powered semantic search, hybrid RAG retrieval, and 3D dependency visualisation for any codebase.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "Nexus — Repository Context Engine",
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
    <html lang="en" className={`${inter.variable} dark`}>
      <body className="bg-black text-white antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
