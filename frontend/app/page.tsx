"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Lightning, Graph, ChatText, Code, ShieldCheck,
  ArrowRight, GithubLogo, MagnifyingGlass, ArrowsClockwise,
} from "@phosphor-icons/react";

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

// ── Feature data ──────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: MagnifyingGlass,
    title: "Semantic context engine",
    body: "AST-powered hybrid RAG finds the exact context across thousands of files. No keyword matching.",
    span: 2,
  },
  {
    icon: Graph,
    title: "Force-directed topology",
    body: "Every module relationship mapped as an interactive 3D node graph. Trace execution paths visually.",
    span: 1,
  },
  {
    icon: Code,
    title: "Refactor architecture",
    body: "Describe an improvement and receive a structural before/after diff ready for review.",
    span: 1,
  },
  {
    icon: ChatText,
    title: "Inference stream",
    body: "Sub-second answers about your codebase with real-time node highlighting as the AI references symbols.",
    span: 2,
  },
  {
    icon: ShieldCheck,
    title: "AES-256 encrypted at rest",
    body: "OAuth tokens stored as encrypted blobs. Decrypted only in-memory during inference.",
    span: 3,
  },
] as const;

// ── CTA Button ────────────────────────────────────────────────────────────────
function CTAButton({ onClick, loading, variant = "primary" }: { onClick: () => void; loading: boolean; variant?: "primary" | "secondary" }) {
  const rm = useReducedMotion();
  
  if (variant === "primary") {
    return (
      <motion.button
        onClick={onClick}
        disabled={loading}
        whileHover={rm ? {} : { scale: 0.98 }}
        whileTap={rm ? {} : { scale: 0.96 }}
        transition={{ duration: 0.12, ease: EASE_OUT }}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "10px 20px", borderRadius: "var(--r1)",
          background: "#fff", border: "1px solid #fff",
          color: "#000", fontSize: 13, fontWeight: 500,
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.8 : 1,
          fontFamily: "var(--font-geist-sans)",
        }}
      >
        {loading
          ? <ArrowsClockwise size={14} weight="bold" className="animate-spin" />
          : <GithubLogo size={14} weight="fill" />}
        <span>{loading ? "Redirecting" : "Continue with GitHub"}</span>
        {!loading && <ArrowRight size={13} weight="bold" />}
      </motion.button>
    );
  }

  // Secondary
  return (
    <motion.button
      onClick={onClick}
      disabled={loading}
      whileHover={rm ? {} : { scale: 0.98, backgroundColor: "rgba(255,255,255,0.06)" }}
      whileTap={rm ? {} : { scale: 0.96 }}
      transition={{ duration: 0.12, ease: EASE_OUT }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "10px 20px", borderRadius: "var(--r1)",
        background: "var(--bg-1)", border: "1px solid var(--border-1)",
        color: "var(--text-0)", fontSize: 13, fontWeight: 500,
        cursor: loading ? "not-allowed" : "pointer",
        opacity: loading ? 0.6 : 1,
        fontFamily: "var(--font-geist-sans)",
      }}
    >
      Continue with GitHub
    </motion.button>
  );
}

// ── Feature card ──────────────────────────────────────────────────────────────
function FeatureCard({
  icon: Icon, title, body, span,
}: {
  icon: React.ElementType; title: string; body: string; span: number;
}) {
  const rm = useReducedMotion();
  return (
    <motion.div
      whileHover={rm ? {} : { backgroundColor: "rgba(255,255,255,0.03)" }}
      transition={{ duration: 0.15, ease: EASE_OUT }}
      className="bezel"
      style={{ 
        gridColumn: `span ${span} / span ${span}`,
        padding: "24px", display: "flex", flexDirection: "column", gap: 14,
        borderRadius: 0, boxShadow: "none", borderTop: "none", borderLeft: "none",
        borderRight: "1px solid var(--border-0)", borderBottom: "1px solid var(--border-0)",
        background: "transparent",
      }}
    >
      <Icon size={18} weight="regular" style={{ color: "var(--text-1)" }} />
      <div>
        <h3 style={{ fontSize: 13, fontWeight: 500, color: "var(--text-0)", marginBottom: 6 }}>{title}</h3>
        <p style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-2)" }}>{body}</p>
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
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, delay, ease: EASE_OUT } };

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
          <Lightning size={14} weight="fill" style={{ color: "var(--text-0)" }} />
          <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: "-0.2px" }}>Nexus</span>
        </div>

        <button
          onClick={handleLogin}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "6px 12px", borderRadius: "var(--r1)",
            background: "transparent", border: "1px solid transparent",
            color: "var(--text-1)", fontSize: 12, cursor: "pointer", fontWeight: 500,
            transition: "color 120ms cubic-bezier(0.23,1,0.32,1)",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "var(--text-0)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--text-1)"; }}
        >
          Sign in <ArrowRight size={12} weight="bold" />
        </button>
      </nav>

      {/* Hero */}
      <section style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        minHeight: "85vh", padding: "120px 24px 60px", textAlign: "center",
      }}>
        <motion.h1 {...fadeIn(0)} style={{ 
          fontSize: "clamp(32px, 6vw, 64px)", 
          fontWeight: 500, 
          letterSpacing: "-0.03em", 
          lineHeight: 1.05, 
          marginBottom: 20, 
          maxWidth: 720,
          color: "var(--text-0)"
        }}>
          Repository intelligence for engineers.
        </motion.h1>

        <motion.p {...fadeIn(0.08)} style={{ 
          fontSize: 15, 
          lineHeight: 1.6, 
          color: "var(--text-2)", 
          maxWidth: 520, 
          marginBottom: 40,
          fontWeight: 400
        }}>
          Semantic search, hybrid RAG retrieval, and interactive 3D dependency graphs. Stream answers directly from your source code.
        </motion.p>

        <motion.div {...fadeIn(0.14)}>
          <CTAButton onClick={handleLogin} loading={loading} variant="primary" />
        </motion.div>

        {/* Structural Stat Grid */}
        <motion.div
          {...fadeIn(0.22)}
          style={{ 
            display: "flex", 
            border: "1px solid var(--border-0)", 
            borderRadius: "var(--r1)",
            marginTop: 64,
            background: "var(--bg-1)",
            overflow: "hidden"
          }}
        >
          {[
            { v: "< 2s", l: "latency" },
            { v: "AES-GCM", l: "encryption" },
            { v: "100%", l: "open source" },
          ].map((s, i) => (
            <div
              key={s.l}
              style={{ 
                padding: "12px 24px", 
                display: "flex", 
                alignItems: "baseline", 
                gap: 8,
                borderLeft: i > 0 ? "1px solid var(--border-0)" : "none"
              }}
            >
              <span data-mono style={{ fontSize: 13, fontWeight: 500, color: "var(--text-0)" }}>
                {s.v}
              </span>
              <span style={{ fontSize: 10, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {s.l}
              </span>
            </div>
          ))}
        </motion.div>
      </section>

      {/* Features — strict structural grid */}
      <section style={{ maxWidth: 1024, margin: "0 auto", padding: "0 24px 100px" }}>
        <div style={{
          borderTop: "1px solid var(--border-0)",
          borderLeft: "1px solid var(--border-0)",
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          background: "var(--bg-1)",
          position: "relative"
        }}>
          {FEATURES.map((f, i) => (
            <FeatureCard key={f.title} icon={f.icon} title={f.title} body={f.body} span={f.span} />
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section style={{ 
        textAlign: "center", 
        padding: "80px 24px", 
        borderTop: "1px solid var(--border-0)",
        background: "var(--bg-1)"
      }}>
        <motion.div
          initial={rm ? {} : { opacity: 0 }}
          whileInView={rm ? {} : { opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-0.02em", marginBottom: 16 }}>
            Start querying your codebase.
          </h2>
          <CTAButton onClick={handleLogin} loading={loading} variant="secondary" />
        </motion.div>
      </section>

      {/* Footer */}
      <footer style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "20px 24px", borderTop: "1px solid var(--border-0)",
        fontSize: 11, color: "var(--text-2)", background: "var(--bg-0)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Lightning size={12} weight="fill" style={{ color: "var(--text-2)" }} />
          Nexus
        </div>
        <span data-mono>FastAPI · Next.js · Groq</span>
      </footer>
    </div>
  );
}
