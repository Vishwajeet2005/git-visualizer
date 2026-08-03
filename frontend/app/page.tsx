"use client";

import { useRef, useState } from "react";
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion";
import { useRouter } from "next/navigation";

// ─── Animation variants ────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  visible: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] },
  }),
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12 } },
};

// ─── Stat counter pill ────────────────────────────────────────────────────────

interface StatPillProps {
  value: string;
  label: string;
  delay: number;
}

function StatPill({ value, label, delay }: StatPillProps) {
  return (
    <motion.div
      variants={fadeUp}
      custom={delay}
      className="flex flex-col items-center px-8 py-4 rounded-2xl
                 border border-white/8 bg-white/4 backdrop-blur-sm"
    >
      <span className="text-2xl font-bold tracking-tight text-white">{value}</span>
      <span className="text-xs text-neutral-400 mt-0.5 tracking-wide uppercase">{label}</span>
    </motion.div>
  );
}

// ─── Feature badge ────────────────────────────────────────────────────────────

interface FeatureBadgeProps {
  icon: string;
  text: string;
}

function FeatureBadge({ icon, text }: FeatureBadgeProps) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-full
                 border border-white/10 bg-white/5 backdrop-blur-sm text-xs text-neutral-300"
    >
      <span>{icon}</span>
      <span>{text}</span>
    </div>
  );
}

// ─── CTA Button ───────────────────────────────────────────────────────────────

interface CTAButtonProps {
  onClick: () => void;
  loading: boolean;
}

function CTAButton({ onClick, loading }: CTAButtonProps) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      disabled={loading}
      className="group relative flex items-center gap-3 px-8 py-4 rounded-2xl
                 border border-white/10 bg-white/5 hover:bg-white/10
                 backdrop-blur-md text-white text-sm font-medium
                 transition-colors duration-300 disabled:opacity-60 disabled:cursor-wait
                 overflow-hidden"
    >
      {/* Shimmer sweep on hover */}
      <span
        className="absolute inset-0 -translate-x-full group-hover:translate-x-full
                   bg-gradient-to-r from-transparent via-white/8 to-transparent
                   transition-transform duration-700 ease-in-out pointer-events-none"
      />
      {loading ? (
        <>
          <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          <span>Connecting…</span>
        </>
      ) : (
        <>
          <svg
            className="w-4 h-4 text-neutral-300"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
                     0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
                     -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
                     .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
                     -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27
                     .68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12
                     .51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
                     0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          <span>Continue with GitHub</span>
          <svg
            className="w-3.5 h-3.5 text-neutral-400 group-hover:translate-x-0.5 transition-transform"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
          </svg>
        </>
      )}
    </motion.button>
  );
}

// ─── Ambient orb ─────────────────────────────────────────────────────────────

function AmbientOrbs() {
  return (
    <>
      {/* Top-left warm orb */}
      <div
        className="absolute top-[-10%] left-[-8%] w-[600px] h-[600px] rounded-full
                   opacity-20 pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(120,80,255,0.6) 0%, transparent 70%)",
          filter: "blur(60px)",
        }}
      />
      {/* Bottom-right cool orb */}
      <div
        className="absolute bottom-[-15%] right-[-10%] w-[700px] h-[700px] rounded-full
                   opacity-15 pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(30,140,255,0.5) 0%, transparent 70%)",
          filter: "blur(80px)",
        }}
      />
    </>
  );
}

// ─── Floating code snippet ────────────────────────────────────────────────────

function FloatingCode() {
  return (
    <motion.div
      initial={{ opacity: 0, x: 60, rotate: 2 }}
      animate={{ opacity: 1, x: 0, rotate: 1 }}
      transition={{ duration: 1.2, delay: 1.0, ease: [0.16, 1, 0.3, 1] }}
      className="hidden lg:block absolute right-[6%] top-[28%] w-80
                 rounded-2xl border border-white/8 bg-black/60 backdrop-blur-xl
                 overflow-hidden shadow-2xl"
    >
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/5">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
        <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
        <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
        <span className="ml-auto text-xs text-neutral-500">auth.service.ts</span>
      </div>
      <pre className="p-4 text-[11px] leading-relaxed text-neutral-400 font-mono overflow-hidden">
        <span className="text-purple-400">async</span>{" "}
        <span className="text-blue-400">function</span>{" "}
        <span className="text-yellow-300">validateToken</span>
        {"(\n  "}
        <span className="text-orange-300">token</span>
        <span className="text-neutral-500">: string</span>
        {"\n): "}
        <span className="text-green-400">Promise</span>
        {"<User> {\n  "}
        <span className="text-purple-400">const</span>
        {" payload = "}
        <span className="text-blue-300">await</span>
        {"\n    jwt."}
        <span className="text-yellow-300">verify</span>
        {"(token,\n      process.env."}
        <span className="text-green-300">JWT_SECRET</span>
        {");\n  "}
        <span className="text-purple-400">return</span>
        {" db.users."}
        <span className="text-yellow-300">findById</span>
        {"(\n    payload."}
        <span className="text-orange-300">sub</span>
        {"\n  );\n}"}
      </pre>
      {/* AI annotation overlay */}
      <div className="px-4 pb-4">
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20">
          <span className="text-purple-400 text-xs mt-0.5">✦</span>
          <p className="text-xs text-purple-200 leading-relaxed">
            Caller detected: <code className="text-purple-300">middleware/auth.ts:42</code>
            {" — 3 downstream dependencies."}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Landing Page ────────────────────────────────────────────────────────

export default function LandingPage() {
  const router  = useRouter();
  const [loading, setLoading] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });

  // Parallax the video slightly
  const videoY = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);

  function handleGitHubLogin() {
    setLoading(true);
    const apiBase = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
    // Navigates to FastAPI OAuth initiation endpoint
    window.location.href = `${apiBase}/api/auth/github`;
  }

  return (
    <main
      ref={heroRef}
      className="relative min-h-screen w-full overflow-hidden bg-black"
    >
      {/* ── Background Video ── */}
      <motion.div
        style={{ y: videoY }}
        className="absolute inset-0 w-full h-full z-0"
      >
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          aria-hidden="true"
        >
          <source
            src="https://res.cloudinary.com/dfonotyfb/video/upload/v1775585556/dds3_1_rqhg7x.mp4"
            type="video/mp4"
          />
        </video>
      </motion.div>

      {/* ── Gradient overlays ── */}
      <div
        className="absolute inset-0 z-10 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 40%, rgba(0,0,0,0.97) 100%)",
        }}
      />
      {/* Vignette */}
      <div
        className="absolute inset-0 z-10 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.5) 100%)",
        }}
      />

      {/* ── Ambient colour orbs ── */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        <AmbientOrbs />
      </div>

      {/* ── Floating code widget ── */}
      <div className="absolute inset-0 z-20 pointer-events-none">
        <FloatingCode />
      </div>

      {/* ── Navigation bar ── */}
      <nav className="relative z-30 flex items-center justify-between px-8 py-6">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="flex items-center gap-2.5"
        >
          <div
            className="w-8 h-8 rounded-xl border border-white/15 bg-white/8
                       backdrop-blur-sm flex items-center justify-center"
          >
            <svg
              className="w-4 h-4 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <span className="text-white font-semibold text-sm tracking-tight">Nexus</span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="flex items-center gap-4"
        >
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-neutral-400 hover:text-white transition-colors"
          >
            Docs
          </a>
          <a
            href="#"
            className="text-xs text-neutral-400 hover:text-white transition-colors"
          >
            Pricing
          </a>
        </motion.div>
      </nav>

      {/* ── Hero content ── */}
      <section className="relative z-30 flex flex-col items-center justify-center min-h-[85vh] px-6 text-center">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="flex flex-col items-center gap-6 max-w-4xl"
        >
          {/* Pre-headline badge */}
          <motion.div variants={fadeUp} custom={0}>
            <div
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full
                         border border-white/10 bg-white/5 backdrop-blur-sm text-xs
                         text-neutral-300 tracking-wide"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Semantic search across your entire codebase
            </div>
          </motion.div>

          {/* Main headline */}
          <motion.h1
            variants={fadeUp}
            custom={0.1}
            className="text-5xl sm:text-6xl md:text-7xl font-extrabold leading-[1.04] tracking-tighter"
            style={{
              backgroundImage:
                "linear-gradient(to bottom, #ffffff 0%, #a3a3a3 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Understand any
            <br />
            codebase,{" "}
            <span
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #a78bfa 0%, #60a5fa 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              instantly.
            </span>
          </motion.h1>

          {/* Sub-headline */}
          <motion.p
            variants={fadeUp}
            custom={0.2}
            className="text-neutral-400 text-lg sm:text-xl max-w-xl leading-relaxed"
          >
            AST-powered ingestion. Hybrid semantic search. 3D dependency graphs.
            Chat with your repository — not just files.
          </motion.p>

          {/* Feature badges row */}
          <motion.div
            variants={fadeUp}
            custom={0.3}
            className="flex flex-wrap items-center justify-center gap-2"
          >
            {[
              { icon: "⚡", text: "Tree-sitter AST parsing" },
              { icon: "🔍", text: "Dense + BM25 hybrid search" },
              { icon: "🌐", text: "3D dependency graph" },
              { icon: "🔒", text: "Local SLM for private repos" },
            ].map((f) => (
              <FeatureBadge key={f.text} icon={f.icon} text={f.text} />
            ))}
          </motion.div>

          {/* CTA Button */}
          <motion.div variants={fadeUp} custom={0.4}>
            <CTAButton onClick={handleGitHubLogin} loading={loading} />
          </motion.div>

          <motion.p
            variants={fadeUp}
            custom={0.5}
            className="text-xs text-neutral-600"
          >
            No credit card required &middot; Free tier includes 3 repositories
          </motion.p>
        </motion.div>
      </section>

      {/* ── Stats bar ── */}
      <motion.section
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-30 flex justify-center pb-20 px-6"
      >
        <div className="flex items-center gap-4 flex-wrap justify-center">
          <StatPill value="512" label="Tokens per chunk" delay={1.0} />
          <div className="w-px h-8 bg-white/8 hidden sm:block" />
          <StatPill value="1536" label="Dense vector dims" delay={1.1} />
          <div className="w-px h-8 bg-white/8 hidden sm:block" />
          <StatPill value="20+" label="Languages supported" delay={1.2} />
          <div className="w-px h-8 bg-white/8 hidden sm:block" />
          <StatPill value="RRF" label="Hybrid fusion" delay={1.3} />
        </div>
      </motion.section>

      {/* ── Bottom gradient into next section ── */}
      <div
        className="absolute bottom-0 left-0 right-0 h-32 z-20 pointer-events-none"
        style={{
          background: "linear-gradient(to bottom, transparent, #000)",
        }}
      />
    </main>
  );
}
