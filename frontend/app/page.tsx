"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  Lightning, GitBranch, Graph, ChatText, Code, ShieldCheck,
  ArrowRight, GithubLogo, MagnifyingGlass, ArrowsClockwise,
} from "@phosphor-icons/react";

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

// ── Feature data ──────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: MagnifyingGlass,
    title: "Semantic search",
    body: "AST-powered hybrid RAG finds the exact context across thousands of files. Not keyword matching.",
    accent: "#3b82f6",
    span: "col-span-2",
  },
  {
    icon: Graph,
    title: "3D dependency graph",
    body: "Every module relationship as an interactive force graph. Click any node to see its full impact chain.",
    accent: "#3b82f6",
    span: "col-span-1",
  },
  {
    icon: ChatText,
    title: "Repository chat",
    body: "Stream answers about your codebase with real-time node highlighting as the AI references symbols.",
    accent: "#3b82f6",
    span: "col-span-1",
  },
  {
    icon: Code,
    title: "Refactor diffs",
    body: "Describe an improvement in plain English and receive a before/after diff to review and apply.",
    accent: "#3b82f6",
    span: "col-span-1",
  },
  {
    icon: ShieldCheck,
    title: "Secure by default",
    body: "API keys encrypted at rest with AES-256-GCM. OAuth tokens stored as encrypted blobs, never plaintext.",
    accent: "#3b82f6",
    span: "col-span-1",
  },
] as const;

// ── CTA Button ────────────────────────────────────────────────────────────────
function CTAButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  const rm = useReducedMotion();
  return (
    <motion.button
      onClick={onClick}
      disabled={loading}
      whileHover={rm ? {} : { scale: 1.03 }}
      whileTap={rm ? {} : { scale: 0.97 }}
      transition={{ duration: 0.12, ease: EASE_OUT }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 10,
        padding: "10px 22px", borderRadius: "var(--r2)",
        background: "var(--accent)", border: "1px solid rgba(59,130,246,0.5)",
        color: "#fff", fontSize: 13, fontWeight: 600,
        cursor: loading ? "not-allowed" : "pointer",
        opacity: loading ? 0.6 : 1,
        fontFamily: "var(--font-geist-sans)",
        transition: "background 120ms cubic-bezier(0.23,1,0.32,1), opacity 120ms cubic-bezier(0.23,1,0.32,1)",
      }}
      onMouseEnter={e => { if (!loading) e.currentTarget.style.background = "#2563eb"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "var(--accent)"; }}
    >
      {loading
        ? <ArrowsClockwise size={15} weight="regular" className="animate-spin" />
        : <GithubLogo size={15} weight="regular" />}
      <span>{loading ? "Redirecting" : "Continue with GitHub"}</span>
      {!loading && <ArrowRight size={14} weight="regular" />}
    </motion.button>
  );
}

// ── Feature card ──────────────────────────────────────────────────────────────
function FeatureCard({
  icon: Icon, title, body, span,
}: {
  icon: React.ElementType; title: string; body: string; span: string;
}) {
  const rm = useReducedMotion();
  return (
    <motion.div
      whileHover={rm ? {} : { y: -3 }}
      transition={{ duration: 0.18, ease: EASE_OUT }}
      className={`bezel ${span}`}
      style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}
    >
      {/* Double-bezel inner icon */}
      <div
        className="bezel-inner"
        style={{
          width: 34, height: 34, display: "flex", alignItems: "center",
          justifyContent: "center", borderRadius: "var(--r2)", flexShrink: 0,
        }}
      >
        <Icon size={16} weight="regular" style={{ color: "var(--accent)" }} />
      </div>
      <div>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-0)", marginBottom: 5 }}>{title}</h3>
        <p style={{ fontSize: 12, lineHeight: 1.65, color: "var(--text-2)" }}>{body}</p>
      </div>
    </motion.div>
  );
}

// ── Landing page ──────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [loading, setLoading] = useState(false);
  const rm = useReducedMotion();

  const handleLogin = () => {
    setLoading(true);
    const base = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
    window.location.href = `${base}/auth/github`;
  };

  const fadeIn = (delay: number) => rm
    ? {}
    : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.55, delay, ease: EASE_OUT } };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-0)", color: "var(--text-0)", overflowX: "hidden" }}>

      {/* Nav */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: 52,
        background: "rgba(10,10,15,0.85)", backdropFilter: "blur(12px) saturate(1.4)",
        borderBottom: "1px solid var(--border-0)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 26, height: 26, borderRadius: "var(--r2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--accent-dim)", border: "1px solid var(--accent-border)",
          }}>
            <Lightning size={13} weight="regular" style={{ color: "var(--accent)" }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.3px" }}>Nexus</span>
        </div>

        <button
          onClick={handleLogin}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "6px 14px", borderRadius: "var(--r2)",
            background: "transparent", border: "1px solid var(--border-1)",
            color: "var(--text-1)", fontSize: 12, cursor: "pointer", fontWeight: 500,
            transition: "color 120ms cubic-bezier(0.23,1,0.32,1), border-color 120ms cubic-bezier(0.23,1,0.32,1)",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "var(--text-0)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--text-1)"; e.currentTarget.style.borderColor = "var(--border-1)"; }}
        >
          <GithubLogo size={13} weight="regular" /> Sign in
        </button>
      </nav>

      {/* Hero */}
      <section style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", padding: "80px 24px 60px", textAlign: "center",
        position: "relative",
      }}>
        {/* Subtle radial */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(59,130,246,0.06) 0%, transparent 70%)",
        }} />

        <motion.div {...fadeIn(0)} style={{ marginBottom: 20 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "5px 12px", borderRadius: "var(--r1)",
            background: "var(--accent-dim)", border: "1px solid var(--accent-border)",
            fontSize: 11, fontWeight: 500, color: "var(--accent-text)",
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
            AI-powered repository intelligence
          </div>
        </motion.div>

        <motion.h1 {...fadeIn(0.08)} style={{ fontSize: "clamp(28px, 5vw, 52px)", fontWeight: 700, letterSpacing: "-1.5px", lineHeight: 1.07, marginBottom: 18, maxWidth: 680 }}>
          Understand any codebase,
          <br />
          <span style={{ color: "var(--accent)" }}>without spelunking</span>
        </motion.h1>

        <motion.p {...fadeIn(0.16)} style={{ fontSize: 15, lineHeight: 1.7, color: "var(--text-1)", maxWidth: 520, marginBottom: 32 }}>
          AST semantic search, hybrid RAG retrieval, and an interactive 3D dependency graph in one AI assistant that streams answers directly from your source.
        </motion.p>

        <motion.div {...fadeIn(0.22)}>
          <CTAButton onClick={handleLogin} loading={loading} />
        </motion.div>

        {/* Stat row */}
        <motion.div
          {...fadeIn(0.30)}
          style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, marginTop: 52 }}
        >
          {[
            { v: "< 2s", l: "first answer" },
            { v: "AES-256", l: "encryption" },
            { v: "100%", l: "open source" },
            { v: "any size", l: "repository" },
          ].map(s => (
            <div
              key={s.l}
              className="bezel"
              style={{ padding: "10px 20px", display: "flex", flexDirection: "column", alignItems: "center" }}
            >
              <span data-mono style={{ fontSize: 18, fontWeight: 700, color: "var(--text-0)", letterSpacing: "-0.5px" }}>
                {s.v}
              </span>
              <span style={{ fontSize: 10, color: "var(--text-2)", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {s.l}
              </span>
            </div>
          ))}
        </motion.div>
      </section>

      {/* Features — asymmetric bento grid */}
      <section style={{ maxWidth: 960, margin: "0 auto", padding: "24px 24px 80px" }}>
        <motion.p
          initial={rm ? {} : { opacity: 0 }}
          whileInView={rm ? {} : { opacity: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.45, ease: EASE_OUT }}
          style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 22 }}
        >
          What it does
        </motion.p>

        {/* Row 1: 2 + 1 */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginBottom: 10 }}>
          {FEATURES.slice(0, 2).map((f, i) => (
            <motion.div
              key={f.title}
              initial={rm ? {} : { opacity: 0, y: 12 }}
              whileInView={rm ? {} : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: i * 0.05, ease: EASE_OUT }}
            >
              <FeatureCard icon={f.icon} title={f.title} body={f.body} span="" />
            </motion.div>
          ))}
        </div>

        {/* Row 2: 3 equal */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {FEATURES.slice(2).map((f, i) => (
            <motion.div
              key={f.title}
              initial={rm ? {} : { opacity: 0, y: 12 }}
              whileInView={rm ? {} : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: i * 0.06, ease: EASE_OUT }}
            >
              <FeatureCard icon={f.icon} title={f.title} body={f.body} span="" />
            </motion.div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section style={{ textAlign: "center", padding: "60px 24px 80px", position: "relative" }}>
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse 50% 80% at 50% 50%, rgba(59,130,246,0.04) 0%, transparent 70%)",
        }} />
        <motion.div
          initial={rm ? {} : { opacity: 0, y: 12 }}
          whileInView={rm ? {} : { opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45, ease: EASE_OUT }}
          style={{ position: "relative" }}
        >
          <h2 style={{ fontSize: "clamp(22px, 3.5vw, 36px)", fontWeight: 700, letterSpacing: "-0.8px", marginBottom: 14 }}>
            Ready to understand your codebase?
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 28, lineHeight: 1.65 }}>
            Free to use. Connect GitHub, import a repo, start asking questions in seconds.
          </p>
          <CTAButton onClick={handleLogin} loading={loading} />
        </motion.div>
      </section>

      {/* Footer */}
      <footer style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 24px", borderTop: "1px solid var(--border-0)",
        fontSize: 11, color: "var(--text-2)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Lightning size={12} weight="regular" style={{ color: "var(--accent-text)", opacity: 0.6 }} />
          Nexus
        </div>
        <span data-mono>Next.js + FastAPI + Groq</span>
      </footer>
    </div>
  );
}
