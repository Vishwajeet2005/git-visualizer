import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

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
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
