"use client";

import { useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  Zap, GitBranch, Layers, MessageSquare, Code2, Shield,
  ArrowRight, Github, Search, RefreshCw,
} from "lucide-react";

// ─── Animation variants ───────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.75, delay, ease: [0.16, 1, 0.3, 1] },
  }),
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

// ─── Stat pill ────────────────────────────────────────────────────────────────

function StatPill({ value, label, delay }: { value: string; label: string; delay: number }) {
  return (
    <motion.div
      variants={fadeUp}
      custom={delay}
      className="flex flex-col items-center px-8 py-4 rounded-2xl"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <span className="text-2xl font-bold tracking-tight text-white">{value}</span>
      <span className="text-[11px] text-neutral-500 mt-0.5 tracking-widest uppercase">{label}</span>
    </motion.div>
  );
}

// ─── Feature card ─────────────────────────────────────────────────────────────

function FeatureCard({
  icon: Icon,
  title,
  description,
  color,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
}) {
  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      className="relative flex flex-col gap-4 p-5 rounded-2xl overflow-hidden group cursor-default"
      style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      {/* Glow on hover */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ background: `radial-gradient(ellipse at 20% 20%, ${color}08 0%, transparent 70%)` }}
      />
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${color}14`, border: `1px solid ${color}28` }}
      >
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-white mb-1.5">{title}</h3>
        <p className="text-xs leading-relaxed" style={{ color: "#6b6b7a" }}>{description}</p>
      </div>
    </motion.div>
  );
}

// ─── CTA Button ───────────────────────────────────────────────────────────────

function CTAButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      disabled={loading}
      className="relative flex items-center gap-3 px-7 py-3.5 rounded-2xl overflow-hidden
                 text-white text-sm font-semibold transition-all group disabled:opacity-60"
      style={{
        background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)",
        boxShadow: "0 8px 32px rgba(124,58,237,0.35), 0 0 0 1px rgba(139,92,246,0.3)",
      }}
    >
      {/* Shimmer */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
           style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 60%)" }} />

      {loading ? (
        <RefreshCw className="w-4 h-4 animate-spin" />
      ) : (
        <Github className="w-4 h-4" />
      )}
      <span>{loading ? "Redirecting…" : "Continue with GitHub"}</span>
      {!loading && <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />}
    </motion.button>
  );
}

// ─── Chip ─────────────────────────────────────────────────────────────────────

function Chip({ icon: Icon, text, color }: { icon: React.ElementType; text: string; color: string }) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium"
      style={{ background: `${color}10`, border: `1px solid ${color}22`, color }}
    >
      <Icon className="w-3 h-3" />
      {text}
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

export default function LandingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({ target: heroRef });
  const heroY = useTransform(scrollYProgress, [0, 1], ["0%", "20%"]);

  const handleLogin = () => {
    setLoading(true);
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
    window.location.href = `${apiUrl}/auth/github`;
  };

  const features = [
    {
      icon: Search,
      title: "Semantic code search",
      description: "AST-powered hybrid RAG retrieval finds the exact context across thousands of files — not just keyword matching.",
      color: "#a78bfa",
    },
    {
      icon: Layers,
      title: "3D dependency graph",
      description: "Visualise every module relationship as an interactive 3D force-directed graph. Click a node to highlight its impact chain.",
      color: "#60a5fa",
    },
    {
      icon: MessageSquare,
      title: "Repository chat",
      description: "Stream answers about your codebase using Groq-powered inference with real-time graph highlighting as the AI references symbols.",
      color: "#34d399",
    },
    {
      icon: Code2,
      title: "Refactor diffs",
      description: "Describe an improvement in plain English and receive an instant before/after diff ready to review and apply.",
      color: "#f97316",
    },
    {
      icon: GitBranch,
      title: "One-click import",
      description: "Connect GitHub, browse your repositories, and import with a single click. Automatic incremental re-indexing on push.",
      color: "#fb7185",
    },
    {
      icon: Shield,
      title: "Secure by design",
      description: "API keys encrypted at rest with AES-256-GCM. OAuth tokens stored as encrypted blobs. Nothing in plaintext.",
      color: "#fbbf24",
    },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: "#06060c", color: "#f1f1f5" }}>

      {/* ── Nav ── */}
      <nav
        className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 py-4"
        style={{ background: "rgba(6,6,12,0.8)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(139,92,246,0.3)" }}
          >
            <Zap className="w-3.5 h-3.5 text-purple-300" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Nexus</span>
        </div>
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={handleLogin}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium text-white transition-all"
          style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(139,92,246,0.3)" }}
        >
          <Github className="w-3.5 h-3.5" />
          Sign in
        </motion.button>
      </nav>

      {/* ── Hero ── */}
      <section
        ref={heroRef}
        className="relative flex flex-col items-center justify-center min-h-screen px-4 pt-20 text-center"
      >
        {/* Orb background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(124,58,237,0.12) 0%, transparent 70%)",
          }}
        />
        {/* Grid lines */}
        <div
          className="absolute inset-0 pointer-events-none opacity-30"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        <motion.style initial="hidden" animate="visible" variants={stagger}>
          {/* Pre-heading pill */}
          <motion.div variants={fadeUp} custom={0} className="mb-6">
            <div
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium"
              style={{
                background: "rgba(124,58,237,0.1)",
                border: "1px solid rgba(139,92,246,0.3)",
                color: "#c4b5fd",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              AI-powered repository intelligence
            </div>
          </motion.div>

          {/* Headline */}
          <motion.h1
            variants={fadeUp}
            custom={0.1}
            className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-6 max-w-4xl"
          >
            <span style={{ background: "linear-gradient(180deg,#fff 40%,#888899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              Understand any
            </span>
            <br />
            <span style={{ background: "linear-gradient(135deg,#a78bfa 0%,#60a5fa 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              codebase instantly
            </span>
          </motion.h1>

          {/* Sub */}
          <motion.p
            variants={fadeUp}
            custom={0.2}
            className="text-base sm:text-lg leading-relaxed mb-10 max-w-2xl"
            style={{ color: "#6b6b7a" }}
          >
            AST-powered semantic search, hybrid RAG retrieval, and an interactive 3D dependency graph —
            all in one AI assistant that streams answers directly from your code.
          </motion.p>

          {/* Chips row */}
          <motion.div variants={fadeUp} custom={0.3} className="flex flex-wrap justify-center gap-2 mb-10">
            <Chip icon={GitBranch} text="GitHub OAuth" color="#a78bfa" />
            <Chip icon={Search} text="Hybrid RAG" color="#60a5fa" />
            <Chip icon={Layers} text="3D graph" color="#34d399" />
            <Chip icon={Zap} text="Groq streaming" color="#fbbf24" />
            <Chip icon={Shield} text="AES-256-GCM" color="#fb7185" />
          </motion.div>

          {/* CTA */}
          <motion.div variants={fadeUp} custom={0.4}>
            <CTAButton onClick={handleLogin} loading={loading} />
          </motion.div>
        </motion.style>

        {/* Stats */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
          className="flex flex-wrap justify-center gap-4 mt-20"
        >
          {[
            { value: "< 2s", label: "First answer" },
            { value: "100%", label: "Open source" },
            { value: "AES-256", label: "Encryption" },
            { value: "∞", label: "Repo size" },
          ].map((s, i) => (
            <StatPill key={s.label} value={s.value} label={s.label} delay={i * 0.08} />
          ))}
        </motion.div>
      </section>

      {/* ── Features ── */}
      <section className="max-w-6xl mx-auto px-4 py-24">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={stagger}
          className="text-center mb-14"
        >
          <motion.div variants={fadeUp} custom={0} className="mb-4">
            <span
              className="text-xs font-semibold tracking-widest uppercase"
              style={{ color: "#7c3aed" }}
            >
              Everything you need
            </span>
          </motion.div>
          <motion.h2 variants={fadeUp} custom={0.1} className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            <span style={{ background: "linear-gradient(180deg,#fff 40%,#888899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              Built for engineers, not analysts
            </span>
          </motion.h2>
          <motion.p variants={fadeUp} custom={0.2} className="text-sm leading-relaxed max-w-lg mx-auto" style={{ color: "#6b6b7a" }}>
            Nexus combines static analysis, embeddings, and LLM inference into one seamless workflow
            so you can spend time building, not spelunking.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={stagger}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {features.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </motion.div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative py-24 px-4 text-center">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 60% 60% at 50% 50%, rgba(124,58,237,0.07) 0%, transparent 70%)" }}
        />
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
          className="relative max-w-2xl mx-auto"
        >
          <motion.h2
            variants={fadeUp}
            custom={0}
            className="text-3xl sm:text-4xl font-bold tracking-tight mb-4"
          >
            <span style={{ background: "linear-gradient(180deg,#fff 40%,#888899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              Ready to understand your codebase?
            </span>
          </motion.h2>
          <motion.p variants={fadeUp} custom={0.1} className="text-sm mb-8" style={{ color: "#6b6b7a" }}>
            Free to use. Connect GitHub, import a repo, and start asking questions in seconds.
          </motion.p>
          <motion.div variants={fadeUp} custom={0.2} className="flex justify-center">
            <CTAButton onClick={handleLogin} loading={loading} />
          </motion.div>
        </motion.div>
      </section>

      {/* ── Footer ── */}
      <footer
        className="flex items-center justify-between px-6 py-5 text-[11px]"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)", color: "#4a4a5a" }}
      >
        <div className="flex items-center gap-2">
          <Zap className="w-3 h-3 text-purple-700" />
          <span>Nexus — AI Repository Intelligence</span>
        </div>
        <span>Built with Next.js · FastAPI · Groq</span>
      </footer>
    </div>
  );
}
