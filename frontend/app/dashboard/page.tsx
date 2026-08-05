"use client";

import {
  useCallback, useEffect, useRef, useState, useMemo,
} from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  GitBranch, FolderOpen, FolderSimple, File, MagnifyingGlass,
  Lightning, Gear, PaperPlaneRight, ArrowsClockwise, Flask,
  Code, Rows, X, Check, Download, CircleNotch,
  WarningCircle, Graph, ThumbsUp, ThumbsDown, Copy,
} from "@phosphor-icons/react";

// ── Dynamic imports ───────────────────────────────────────────────────────────
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col items-center justify-center h-full gap-2.5">
      <CircleNotch size={18} className="text-blue-500 animate-spin" weight="regular" />
      <span style={{ fontSize: 11, color: "var(--text-2)" }}>Loading 3D engine</span>
    </div>
  ),
});

// ── Easing constants ──────────────────────────────────────────────────────────
const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
const SPRING = { type: "spring", duration: 0.4, bounce: 0.1 } as const;

// ── Types ─────────────────────────────────────────────────────────────────────
interface FileNode {
  id: string; name: string; path: string;
  type: "file" | "directory"; children?: FileNode[]; language?: string;
}
interface GraphNode {
  id: string; name: string; file_path: string;
  node_type: string; language: string; val: number; color?: string;
}
interface GraphLink { source: string; target: string; type: "call" | "import"; }
interface GraphData { nodes: GraphNode[]; links: GraphLink[]; }
interface ChatMessage { id: string; role: "user" | "assistant"; content: string; timestamp: Date; }
interface DiffResult { before: string; after: string; explanation: string; }
interface Repository {
  id: string; full_name: string; status: string;
  chunk_count: number; file_count: number;
}
interface GithubRepo {
  full_name: string; private: boolean; html_url: string; updated_at: string;
}
interface MergedRepo {
  full_name: string; id?: string; status: string;
  chunk_count?: number; file_count?: number;
}

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

const LANG_COLORS: Record<string, string> = {
  python: "#3b82f6", typescript: "#8b5cf6", javascript: "#f59e0b",
  go: "#10b981", rust: "#f97316", java: "#f43f5e",
};

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "ready") {
    return <span style={{ fontSize: 10, color: "var(--addition)", fontFamily: "var(--font-geist-mono)" }}>ready</span>;
  }
  if (s === "unimported") {
    return <span style={{ fontSize: 10, color: "var(--text-2)", fontFamily: "var(--font-geist-mono)" }}>import</span>;
  }
  return (
    <span style={{ fontSize: 10, color: "#f59e0b", fontFamily: "var(--font-geist-mono)", display: "inline-flex", alignItems: "center", gap: 4 }}>
      <CircleNotch size={10} className="animate-spin" /> {s}
    </span>
  );
}

// ── File tree node ────────────────────────────────────────────────────────────
function FileTreeNode({
  node, depth, onSelect, selected,
}: {
  node: FileNode; depth: number;
  onSelect: (n: FileNode) => void; selected: string | null;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isSelected = selected === node.id;
  const rm = useReducedMotion();

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={() => setOpen(v => !v)}
          className="sidebar-item"
          style={{ paddingLeft: 8 + depth * 13 }}
        >
          <motion.span
            animate={{ rotate: open ? 90 : 0 }}
            transition={rm ? { duration: 0 } : { duration: 0.15, ease: EASE_OUT }}
            style={{ display: "inline-flex", color: "var(--text-2)" }}
          >
            {open
              ? <FolderOpen size={13} weight="regular" />
              : <FolderSimple size={13} weight="regular" />}
          </motion.span>
          <span style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {node.name}
          </span>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="children"
              initial={rm ? {} : { opacity: 0 }}
              animate={rm ? {} : { opacity: 1 }}
              exit={rm ? {} : { opacity: 0 }}
              transition={{ duration: 0.14, ease: EASE_OUT }}
            >
              {node.children?.map(child => (
                <FileTreeNode
                  key={child.id} node={child} depth={depth + 1}
                  onSelect={onSelect} selected={selected}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node)}
      className={`sidebar-item ${isSelected ? "active" : ""}`}
      style={{ paddingLeft: 8 + depth * 13 }}
    >
      <File size={12} weight="regular" style={{ color: "var(--text-2)", flexShrink: 0 }} />
      <span style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
        {node.name}
      </span>
      {node.language && (
        <span
          data-mono
          style={{
            fontSize: 9, padding: "1px 5px", borderRadius: "var(--r1)",
            flexShrink: 0, fontWeight: 600,
            background: `${LANG_COLORS[node.language] ?? "#888"}14`,
            color: LANG_COLORS[node.language] ?? "#888",
          }}
        >
          {node.language.slice(0, 2).toUpperCase()}
        </span>
      )}
    </button>
  );
}

// ── Repo selector ─────────────────────────────────────────────────────────────
function RepoSelect({
  repos, activeRepo, onSelect, isImporting,
}: {
  repos: MergedRepo[]; activeRepo: MergedRepo | null;
  onSelect: (r: MergedRepo) => void; isImporting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const rm = useReducedMotion();

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const label = activeRepo
    ? activeRepo.full_name.split("/")[1]
    : "Select repository";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 7,
          padding: "8px 10px",
          background: "transparent", border: "1px solid transparent",
          color: "var(--text-0)", fontSize: 12, cursor: "pointer",
          transition: "background 120ms cubic-bezier(0.23,1,0.32,1)",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      >
        <GitBranch size={13} weight="regular" style={{ color: "var(--text-2)", flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        {isImporting
          ? <CircleNotch size={12} weight="regular" className="animate-spin" style={{ color: "var(--text-2)" }} />
          : <Code size={12} weight="regular" style={{ color: "var(--text-2)" }} />
        }
      </button>

          <motion.div
            initial={rm ? {} : { opacity: 0, scale: 0.98, y: -2 }}
            animate={rm ? {} : { opacity: 1, scale: 1, y: 0 }}
            exit={rm ? {} : { opacity: 0, scale: 0.98, y: -2 }}
            transition={rm ? { duration: 0 } : { duration: 0.15, ease: EASE_OUT }}
            style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
              zIndex: 50, overflow: "hidden",
              background: "var(--bg-1)", border: "1px solid var(--border-0)",
              boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ maxHeight: 260, overflowY: "auto" }}>
              {repos.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "16px", fontSize: 11, color: "var(--text-2)" }}>
                  <CircleNotch size={12} className="animate-spin" /> Loading
                </div>
              ) : repos.map(r => (
                <button
                  key={r.full_name}
                  onClick={() => { onSelect(r); setOpen(false); }}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 10px", fontSize: 11, textAlign: "left",
                    cursor: "pointer", border: "none",
                    borderBottom: "1px solid var(--border-0)",
                    background: activeRepo?.full_name === r.full_name ? "var(--bg-2)" : "transparent",
                    color: activeRepo?.full_name === r.full_name ? "var(--text-0)" : "var(--text-1)",
                    transition: "background 80ms ease, color 80ms ease",
                  }}
                  onMouseEnter={e => { if (activeRepo?.full_name !== r.full_name) { e.currentTarget.style.background = "var(--bg-2)"; e.currentTarget.style.color = "var(--text-0)"; } }}
                  onMouseLeave={e => { if (activeRepo?.full_name !== r.full_name) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-1)"; } }}
                >
                  <GitBranch size={11} style={{ flexShrink: 0, color: "var(--text-2)" }} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <span style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-geist-mono)", color: activeRepo?.full_name === r.full_name ? "var(--text-0)" : "inherit" }}>
                      {r.full_name.split("/")[1] || r.full_name}
                    </span>
                    <span style={{ fontSize: 9, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.full_name.split("/")[0]}
                    </span>
                  </div>
                  <StatusBadge status={r.status} />
                </button>
              ))}
            </div>
          </motion.div>
    </div>
  );
}

// ── Diff viewer ───────────────────────────────────────────────────────────────
function DiffViewer({ diff }: { diff: DiffResult }) {
  const rm = useReducedMotion();

  const renderLines = (code: string, sign: "+" | "-") =>
    code.split("\n").map((line, i) => (
      <motion.div
        key={i}
        initial={rm ? {} : { opacity: 0, y: 6 }}
        animate={rm ? {} : { opacity: 1, y: 0 }}
        transition={rm ? { duration: 0 } : { duration: 0.12, delay: i * 0.015, ease: EASE_OUT }}
        style={{
          display: "flex", gap: 12, padding: "2px 14px", fontSize: 11, lineHeight: 1.6,
          fontFamily: "var(--font-geist-mono)",
          background: sign === "-" ? "rgba(244,63,94,0.06)" : "rgba(16,185,129,0.06)",
        }}
      >
        <span style={{ color: sign === "-" ? "rgba(244,63,94,0.45)" : "rgba(16,185,129,0.45)", userSelect: "none", width: 8, flexShrink: 0 }}>
          {sign}
        </span>
        <span style={{ color: sign === "-" ? "rgba(244,63,94,0.85)" : "rgba(16,185,129,0.85)", wordBreak: "break-all" }}>
          {line || " "}
        </span>
      </motion.div>
    ));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontSize: 12, color: "var(--text-1)", lineHeight: 1.65, padding: "10px 12px", background: "var(--bg-2)", borderRadius: "var(--r2)", border: "1px solid var(--border-0)" }}>
        {diff.explanation}
      </p>
      <div className="bezel" style={{ overflow: "hidden", display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <div style={{ padding: "6px 14px", fontSize: 10, fontWeight: 600, fontFamily: "var(--font-geist-mono)", color: "var(--deletion)", background: "rgba(244,63,94,0.05)", borderBottom: "1px solid var(--border-0)" }}>
            BEFORE
          </div>
          <div style={{ overflowY: "auto", maxHeight: 320 }}>{renderLines(diff.before, "-")}</div>
        </div>
        <div style={{ borderLeft: "1px solid var(--border-0)" }}>
          <div style={{ padding: "6px 14px", fontSize: 10, fontWeight: 600, fontFamily: "var(--font-geist-mono)", color: "var(--addition)", background: "rgba(16,185,129,0.05)", borderBottom: "1px solid var(--border-0)" }}>
            AFTER
          </div>
          <div style={{ overflowY: "auto", maxHeight: 320 }}>{renderLines(diff.after, "+")}</div>
        </div>
      </div>
    </div>
  );
}

// ── Chat panel ────────────────────────────────────────────────────────────────
function ChatPanel({
  messages, loading, input, onInputChange, onSend, onGenerateTests, onRefactor, activeFile,
}: {
  messages: ChatMessage[]; loading: boolean; input: string;
  onInputChange: (v: string) => void; onSend: () => void;
  onGenerateTests: () => void; onRefactor: () => void;
  activeFile: FileNode | null;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const rm = useReducedMotion();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: rm ? "auto" : "smooth" });
  }, [messages, rm]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 14px", borderBottom: "1px solid var(--border-0)", flexShrink: 0,
      }}>
        <button
          className="btn-ghost"
          onClick={onGenerateTests}
          disabled={!activeFile || loading}
        >
          <Flask size={12} weight="regular" /> Generate tests
        </button>
        <button
          className="btn-ghost"
          onClick={onRefactor}
          disabled={!activeFile || loading}
        >
          <ArrowsClockwise size={12} weight="regular" /> Refactor diff
        </button>
        {activeFile && (
          <span style={{
            marginLeft: "auto", fontSize: 10, color: "var(--text-2)",
            fontFamily: "var(--font-geist-mono)", overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160,
          }}>
            {activeFile.path}
          </span>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ padding: "10px" }}>
            <p data-mono style={{ fontSize: 11, color: "var(--text-2)" }}>
              // System ready. Awaiting prompt.
            </p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={rm ? {} : { opacity: 0, y: 8 }}
              animate={rm ? {} : { opacity: 1, y: 0 }}
              transition={rm ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT }}
              style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}
            >
              {msg.role === "assistant" && (
                <div style={{
                  width: 22, height: 22, borderRadius: "var(--r2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "var(--accent-dim)", border: "1px solid var(--accent-border)",
                  marginRight: 8, marginTop: 2, flexShrink: 0,
                }}>
                  <Lightning size={11} weight="regular" style={{ color: "var(--accent)" }} />
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: "82%" }}>
                <div
                  className={msg.role === "user" ? "" : "bezel-inner"}
                  style={{
                    padding: "9px 13px",
                    borderRadius: msg.role === "user" ? "var(--r3)" : "var(--r2)",
                    fontSize: 12, lineHeight: 1.65,
                    ...(msg.role === "user"
                      ? { background: "var(--accent-dim)", border: "1px solid var(--accent-border)", color: "var(--accent-text)" }
                      : { color: "var(--text-1)" }),
                  }}
                >
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", wordBreak: "break-word", margin: 0 }}>
                    {msg.content}
                  </pre>
                </div>
                {msg.role === "assistant" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, paddingLeft: 4 }}>
                    <button className="btn-ghost" style={{ padding: "3px 6px", borderRadius: "var(--r1)" }} title="Helpful" onClick={() => {}}>
                      <ThumbsUp size={12} weight="regular" />
                    </button>
                    <button className="btn-ghost" style={{ padding: "3px 6px", borderRadius: "var(--r1)" }} title="Not helpful" onClick={() => {}}>
                      <ThumbsDown size={12} weight="regular" />
                    </button>
                    <button className="btn-ghost" style={{ padding: "3px 6px", borderRadius: "var(--r1)" }} title="Copy response" onClick={() => navigator.clipboard.writeText(msg.content)}>
                      <Copy size={12} weight="regular" />
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 22, height: 22, borderRadius: "var(--r2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--accent-dim)", border: "1px solid var(--accent-border)", flexShrink: 0,
            }}>
              <Lightning size={11} weight="regular" style={{ color: "var(--accent)" }} />
            </div>
            <div className="bezel-inner" style={{ padding: "10px 14px", display: "flex", gap: 5, alignItems: "center" }}>
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ borderTop: "1px solid var(--border-0)", flexShrink: 0, background: "var(--bg-0)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", padding: "10px 14px", gap: 8 }}>
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
            }}
            placeholder="Ask about the codebase..."
            rows={1}
            style={{
              flex: 1, resize: "none", background: "transparent",
              color: "var(--text-0)", fontSize: 13, lineHeight: 1.6,
              border: "none", outline: "none",
              maxHeight: 112, overflowY: "auto",
              fontFamily: "var(--font-geist-sans)",
            }}
          />
          <button
            onClick={onSend}
            disabled={!input.trim() || loading}
            className="btn-ghost"
            style={{ flexShrink: 0, padding: "6px", color: input.trim() ? "var(--text-0)" : "var(--text-2)" }}
          >
            {loading
              ? <CircleNotch size={14} weight="regular" className="animate-spin" />
              : <PaperPlaneRight size={14} weight="regular" />}
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 14px 10px", fontSize: 10, color: "var(--text-2)" }}>
          <span>Enter to send, Shift+Enter for newline</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4, opacity: 0.8 }}>
            <WarningCircle size={10} weight="regular" /> AI can make mistakes.
          </span>
        </div>
      </div>
    </div>
  );
}

// ── 3D Graph panel ────────────────────────────────────────────────────────────
function GraphPanel({
  data, onNodeClick, highlightedNodes,
}: {
  data: GraphData; onNodeClick: (n: GraphNode) => void;
  highlightedNodes: Set<string>;
}) {
  const fgRef = useRef<any>(null);
  const [hoverNode, setHoverNode] = useState<any>(null);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    data.links.forEach((l: any) => {
      const s = typeof l.source === "object" ? l.source.id : l.source;
      const t = typeof l.target === "object" ? l.target.id : l.target;
      if (!map.has(s)) map.set(s, new Set());
      if (!map.has(t)) map.set(t, new Set());
      map.get(s)!.add(t); map.get(t)!.add(s);
    });
    return map;
  }, [data]);

  const nodeColor = useCallback((node: any) => {
    if (hoverNode) {
      if (node.id === hoverNode.id) return "#ffffff";
      if (neighbors.get(hoverNode.id)?.has(node.id)) return LANG_COLORS[node.language] ?? "#888";
      return "#161620";
    }
    if (highlightedNodes.size === 0) return LANG_COLORS[node.language] ?? "#888";
    return highlightedNodes.has(node.id) ? "#3b82f6" : "#161620";
  }, [highlightedNodes, hoverNode, neighbors]);

  const linkColor = useCallback((link: any) => {
    const s = typeof link.source === "object" ? link.source.id : link.source;
    const t = typeof link.target === "object" ? link.target.id : link.target;
    if (hoverNode && (s === hoverNode.id || t === hoverNode.id)) return "rgba(255,255,255,0.3)";
    if (hoverNode) return "rgba(255,255,255,0.015)";
    if (highlightedNodes.has(s) || highlightedNodes.has(t)) return "rgba(59,130,246,0.7)";
    return "rgba(255,255,255,0.04)";
  }, [highlightedNodes, hoverNode]);

  const handleClick = useCallback((node: any) => {
    if (fgRef.current) {
      const d = 100;
      const r = 1 + d / Math.hypot(node.x, node.y, node.z);
      fgRef.current.cameraPosition(
        { x: node.x * r, y: node.y * r, z: node.z * r }, node, 220,
      );
    }
    onNodeClick(node);
  }, [onNodeClick]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#06060c", borderRadius: "var(--r3)", overflow: "hidden" }}>
      {/* Language legend */}
      <div style={{
        position: "absolute", top: 10, left: 10, zIndex: 10,
        display: "flex", flexDirection: "column", gap: 5,
        padding: "8px 10px", borderRadius: "var(--r2)",
        background: "rgba(0,0,0,0.5)", border: "1px solid var(--border-0)",
        backdropFilter: "blur(8px)",
      }}>
        {Object.entries(LANG_COLORS).map(([lang, color]) => (
          <div key={lang} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
            <span data-mono style={{ fontSize: 9, color: "var(--text-2)" }}>{lang}</span>
          </div>
        ))}
      </div>

      {/* Impact badge */}
      {highlightedNodes.size > 0 && (
        <div style={{
          position: "absolute", top: 10, right: 10, zIndex: 10,
          display: "flex", alignItems: "center", gap: 5,
          padding: "5px 10px", borderRadius: "var(--r1)",
          background: "var(--accent-dim)", border: "1px solid var(--accent-border)",
          fontSize: 10, fontWeight: 500, color: "var(--accent-text)",
          fontFamily: "var(--font-geist-mono)",
        }}>
          <Lightning size={10} weight="regular" />
          {highlightedNodes.size} nodes impacted
        </div>
      )}

      <ForceGraph3D
        ref={fgRef}
        graphData={data}
        nodeLabel={(n: any) => `${n.name} (${n.node_type})`}
        nodeColor={nodeColor}
        nodeVal={(n: any) => Math.sqrt(n.val ?? 1)}
        nodeOpacity={0.92}
        linkColor={linkColor}
        linkWidth={(l: any) => {
          const s = typeof l.source === "object" ? l.source.id : l.source;
          const t = typeof l.target === "object" ? l.target.id : l.target;
          if (hoverNode && (s === hoverNode.id || t === hoverNode.id)) return 1.2;
          return highlightedNodes.has(s) ? 2 : 0.25;
        }}
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={1.2}
        linkDirectionalParticleSpeed={(l: any) => l.type === "import" ? 0.004 : 0.008}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={1}
        onNodeClick={handleClick}
        onNodeHover={setHoverNode}
        backgroundColor="#06060c"
        showNavInfo={false}
      />
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
function TabBar({
  tabs, active, onChange,
}: {
  tabs: { key: string; label: string; icon: React.ReactNode; dot?: boolean }[];
  active: string;
  onChange: (k: string) => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", height: 40,
      paddingInline: 12, gap: 2, flexShrink: 0,
      borderBottom: "1px solid var(--border-0)",
      background: "var(--bg-1)",
    }}>
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          style={{
            display: "flex", alignItems: "center", gap: 5, height: "100%",
            padding: "0 10px", fontSize: 11, fontWeight: active === tab.key ? 500 : 400,
            border: "none", background: "transparent", cursor: "pointer",
            borderBottom: active === tab.key ? "1px solid var(--text-0)" : "1px solid transparent",
            color: active === tab.key ? "var(--text-0)" : "var(--text-2)",
            transition: "color 120ms ease, border-color 120ms ease",
          }}
        >
          {tab.icon}
          {tab.label}
          {tab.dot && (
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#f59e0b", flexShrink: 0 }} />
          )}
        </button>
      ))}
    </div>
  );
}

// ── Dashboard root ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const rm = useReducedMotion();

  // Token capture
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("token");
    if (t) {
      localStorage.setItem("nexus_token", t);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const getHeaders = () => {
    const t = typeof window !== "undefined" ? localStorage.getItem("nexus_token") : null;
    return {
      "Content-Type": "application/json",
      ...(t ? { Authorization: "Bearer " + t } : {}),
    };
  };

  const [repos, setRepos]             = useState<MergedRepo[]>([]);
  const [activeRepo, setActiveRepo]   = useState<MergedRepo | null>(null);
  const [fileTree, setFileTree]       = useState<FileNode[]>([]);
  const [activeFile, setActiveFile]   = useState<FileNode | null>(null);
  const [fileSearch, setFileSearch]   = useState("");
  const [graphData, setGraphData]     = useState<GraphData>({ nodes: [], links: [] });
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [messages, setMessages]       = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]     = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [diff, setDiff]               = useState<DiffResult | null>(null);
  const [centreTab, setCentreTab]     = useState<"chat" | "diff">("chat");
  const [rightTab, setRightTab]       = useState<"graph" | "info">("graph");
  const [isImporting, setIsImporting] = useState(false);
  const [autoExplained, setAutoExplained] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings]   = useState(false);
  const [confirmImport, setConfirmImport] = useState<MergedRepo | null>(null);
  const [groqKey, setGroqKey]         = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // ── Fetch repos ─────────────────────────────────────────────────────────────
  const fetchRepos = useCallback(async () => {
    try {
      const [dbRes, ghRes] = await Promise.all([
        fetch(`/api/repos`, { credentials: "include", headers: getHeaders() }),
        fetch(`/api/github/repos`, { credentials: "include", headers: getHeaders() }),
      ]);
      const db: Repository[] = dbRes.ok ? await dbRes.json() : [];
      const gh: GithubRepo[] = ghRes.ok ? await ghRes.json() : [];

      const map = new Map<string, MergedRepo>();
      for (const r of gh) map.set(r.full_name, { full_name: r.full_name, status: "unimported" });
      for (const r of db) map.set(r.full_name, {
        full_name: r.full_name, id: r.id, status: r.status,
        chunk_count: r.chunk_count, file_count: r.file_count,
      });

      const merged = Array.from(map.values());
      setRepos(merged);
      return merged;
    } catch (e) {
      console.error("fetchRepos:", e);
      return undefined;
    }
  }, []);

  useEffect(() => {
    fetchRepos().then(data => {
      if (data) {
        if (activeRepo) {
          const updated = data.find(r => r.full_name === activeRepo.full_name);
          if (updated && updated.status !== activeRepo.status) {
            setActiveRepo(updated);
          }
        } else {
          const ready = data.find(r => r.status === "ready");
          if (ready) setActiveRepo(ready);
        }
      }
    });
    const iv = setInterval(() => {
      fetchRepos().then(data => {
        if (data && activeRepo) {
          const updated = data.find(r => r.full_name === activeRepo.full_name);
          if (updated && updated.status !== activeRepo.status) {
            setActiveRepo(updated);
          }
        }
      });
    }, 4000);
    return () => clearInterval(iv);
  }, [fetchRepos, activeRepo]);

  // ── Import repo ─────────────────────────────────────────────────────────────
  const importRepo = useCallback(async (full_name: string) => {
    if (isImporting) return;
    setIsImporting(true);
    try {
      // Use Vercel proxy to bypass all CORS issues
      const r = await fetch(`/api/repos`, {
        method: "POST", credentials: "include", headers: getHeaders(),
        body: JSON.stringify({ full_name }),
      });
      if (r.ok) { await fetchRepos(); }
      else { const d = await r.json().catch(() => ({})); alert(`Import failed: ${d.detail || r.statusText}`); }
    } catch (e: any) { console.error(e); alert("Import failed: " + (e.message || "Unknown error")); }
    finally { setIsImporting(false); }
  }, [fetchRepos, isImporting]);

  const handleRepoSelect = useCallback(async (r: MergedRepo) => {
    if (r.status === "unimported") {
      setConfirmImport(r);
    } else {
      setActiveRepo(r);
    }
  }, []);

  // ── Load graph ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeRepo?.id) return;
    let live = true;
    fetch(`/api/repos/${activeRepo.id}/graph`, { credentials: "include", headers: getHeaders() })
      .then(async r => {
        if (!r.ok) throw new Error("Failed to load graph");
        return r.json();
      })
      .then((d: GraphData) => { if (live) setGraphData(d); })
      .catch(err => {
        console.error(err);
        if (live) setGraphData({ nodes: [], links: [] });
      });
    return () => { live = false; };
  }, [activeRepo]);

  // ── Settings ─────────────────────────────────────────────────────────────────
  const saveSettings = useCallback(async () => {
    try {
      const r = await fetch(`/api/user/key`, {
        method: "POST", credentials: "include", headers: getHeaders(),
        body: JSON.stringify({ groq_api_key: groqKey }),
      });
      if (r.ok) { setShowSettings(false); setGroqKey(""); alert("Saved."); }
      else { alert("Failed to save."); }
    } catch { alert("Error."); }
  }, [groqKey]);

  // ── Chat ─────────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async (override?: string) => {
    const text = typeof override === "string" ? override : chatInput;
    if (!text.trim() || !activeRepo || chatLoading) return;

    setMessages(p => [...p, { id: crypto.randomUUID(), role: "user", content: text, timestamp: new Date() }]);
    if (typeof override !== "string") setChatInput("");
    setChatLoading(true);

    const aid = crypto.randomUUID();
    setMessages(p => [...p, { id: aid, role: "assistant", content: "", timestamp: new Date() }]);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch(`/api/query/stream`, {
        method: "POST", credentials: "include", headers: getHeaders(), signal: ctrl.signal,
        body: JSON.stringify({ question: text, repository_id: activeRepo.id || "", provider: "groq" }),
      });
      const reader = resp.body!.getReader();
      const dec = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value, { stream: true }).split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const tok = line.slice(6);
          if (tok === "[DONE]") break;
          acc += tok;
          setMessages(p => p.map(m => m.id === aid ? { ...m, content: acc } : m));
          const hit = graphData.nodes.filter(n => n.name.length > 3 && acc.includes(n.name));
          if (hit.length) setHighlighted(p => { const n = new Set(p); let c = false; for (const h of hit) { if (!n.has(h.id)) { n.add(h.id); c = true; } } return c ? n : p; });
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setMessages(p => p.map(m => m.id === aid ? { ...m, content: "Error: could not get a response." } : m));
      }
    } finally { setChatLoading(false); }
  }, [chatInput, activeRepo, chatLoading, graphData.nodes]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    if (highlighted.has(node.id)) { setHighlighted(new Set()); return; }
    const connected = new Set<string>([node.id]);
    for (const l of graphData.links) {
      const s = typeof l.source === "object" ? (l.source as any).id : l.source;
      const t = typeof l.target === "object" ? (l.target as any).id : l.target;
      if (s === node.id) connected.add(t);
      if (t === node.id) connected.add(s);
    }
    setHighlighted(connected);
    handleSend(`Explain ${node.file_path}, focusing on ${node.name}`);
  }, [graphData.links, highlighted, handleSend]);

  const handleFileSelect = useCallback((f: FileNode) => {
    setActiveFile(f);
    if (f.type === "file") handleSend(`Explain the code in ${f.path}`);
  }, [handleSend]);

  useEffect(() => {
    if (activeRepo?.status === "ready" && !autoExplained.has(activeRepo.full_name)) {
      setAutoExplained(p => new Set(p).add(activeRepo.full_name));
      setTimeout(() => handleSend("Explain the overall architecture and purpose of this repository."), 500);
    }
  }, [activeRepo, autoExplained, handleSend]);

  const handleGenerateTests = useCallback(() => {
    if (!activeFile || !activeRepo) return;
    handleSend(`Generate a complete unit test suite for ${activeFile.name}`);
  }, [activeFile, activeRepo, handleSend]);

  const handleRefactor = useCallback(async () => {
    if (!activeFile || !activeRepo) return;
    const instr = window.prompt("Describe the refactoring:");
    if (!instr) return;
    setChatLoading(true);
    try {
      const resp = await fetch(`/api/tools/refactor-diff`, {
        method: "POST", credentials: "include", headers: getHeaders(),
        body: JSON.stringify({ repository_id: activeRepo.id || "", file_path: activeFile.path, symbol_name: activeFile.name, refactor_instruction: instr, provider: "groq" }),
      });
      const reader = resp.body!.getReader();
      const dec = new TextDecoder();
      let raw = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const l of dec.decode(value, { stream: true }).split("\n")) {
          if (l.startsWith("data: ") && l.slice(6) !== "[DONE]") raw += l.slice(6);
        }
      }
      setDiff(JSON.parse(raw));
      setCentreTab("diff");
    } catch { alert("Failed to generate diff."); }
    finally { setChatLoading(false); }
  }, [activeFile, activeRepo]);

  const filteredTree = useMemo(() => {
    if (!fileSearch) return fileTree;
    const q = fileSearch.toLowerCase();
    const filter = (ns: FileNode[]): FileNode[] =>
      ns.flatMap(n => {
        if (n.type === "file" && n.name.toLowerCase().includes(q)) return [n];
        if (n.type === "directory" && n.children) {
          const f = filter(n.children);
          return f.length ? [{ ...n, children: f }] : [];
        }
        return [];
      });
    return filter(fileTree);
  }, [fileTree, fileSearch]);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex", height: "100vh", width: "100vw", overflow: "hidden",
      background: "var(--bg-0)", color: "var(--text-0)",
    }}>

      {/* ── Sidebar ── */}
      <aside
        className="bezel"
        style={{
          width: 216, flexShrink: 0, display: "flex", flexDirection: "column",
          borderRadius: 0, borderTop: "none", borderBottom: "none", borderLeft: "none",
          borderRight: "1px solid var(--border-0)",
          background: "var(--bg-1)",
        }}
      >
        {/* Repo */}
        <div style={{ padding: "12px 10px 10px", borderBottom: "1px solid var(--border-0)", display: "flex", flexDirection: "column", gap: 10 }}>
          <RepoSelect
            repos={repos}
            activeRepo={activeRepo}
            onSelect={handleRepoSelect}
            isImporting={isImporting}
          />

          {activeRepo && (
            <motion.div
              initial={rm ? {} : { opacity: 0 }}
              animate={rm ? {} : { opacity: 1 }}
              transition={rm ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT }}
              style={{ display: "flex", alignItems: "center", gap: 7, paddingLeft: 2 }}
            >
              <StatusBadge status={activeRepo.status} />
              {(activeRepo.status === "ready") && (
                <span data-mono style={{ fontSize: 10, color: "var(--text-2)" }}>
                  {(activeRepo.chunk_count || 0).toLocaleString()} chunks
                </span>
              )}
            </motion.div>
          )}
        </div>

        <div style={{ borderBottom: "1px solid var(--border-0)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 10px" }}>
            <MagnifyingGlass size={12} weight="regular" style={{ color: "var(--text-2)", flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search files..."
              value={fileSearch}
              onChange={e => setFileSearch(e.target.value)}
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                fontSize: 11, color: "var(--text-0)",
                fontFamily: "var(--font-geist-sans)",
              }}
            />
          </div>
        </div>

        {/* File tree */}
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 6px" }}>
          {filteredTree.length === 0 && (
            <p style={{ fontSize: 11, color: "var(--text-2)", padding: "20px 10px", textAlign: "center" }}>
              {activeRepo ? "No files indexed yet." : "Select a repository."}
            </p>
          )}
          {filteredTree.map(node => (
            <FileTreeNode
              key={node.id} node={node} depth={0}
              onSelect={handleFileSelect} selected={activeFile?.id ?? null}
            />
          ))}
        </div>

        {/* Settings */}
        <div style={{ padding: "6px", borderTop: "1px solid var(--border-0)" }}>
          <button
            className="sidebar-item"
            onClick={() => setShowSettings(true)}
            style={{ width: "100%" }}
          >
            <Gear size={13} weight="regular" />
            <span style={{ fontSize: 11 }}>Settings</span>
          </button>
        </div>
      </aside>

      {/* ── Centre: Chat / Diff ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, borderRight: "1px solid var(--border-0)" }}>
        <TabBar
          active={centreTab}
          onChange={k => setCentreTab(k as "chat" | "diff")}
          tabs={[
            { key: "chat", label: "Chat", icon: <Lightning size={12} weight="regular" /> },
            { key: "diff", label: "Diff viewer", icon: <Code size={12} weight="regular" />, dot: !!diff },
          ]}
        />
        <div style={{ flex: 1, minHeight: 0 }}>
          {centreTab === "chat" ? (
            <ChatPanel
              messages={messages} loading={chatLoading}
              input={chatInput} onInputChange={setChatInput} onSend={handleSend}
              onGenerateTests={handleGenerateTests} onRefactor={handleRefactor}
              activeFile={activeFile}
            />
          ) : (
            <div style={{ padding: 14, overflowY: "auto", height: "100%" }}>
              {diff
                ? <DiffViewer diff={diff} />
                : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10, textAlign: "center" }}>
                    <Code size={28} weight="thin" style={{ color: "var(--text-2)" }} />
                    <p style={{ fontSize: 12, color: "var(--text-2)" }}>No diff generated yet.</p>
                  </div>
                )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: graph (asymmetric, wider) ── */}
      <div style={{ width: "46%", flexShrink: 0, display: "flex", flexDirection: "column" }}>
        <div style={{
          display: "flex", alignItems: "center", height: 40, paddingInline: 12, gap: 2,
          borderBottom: "1px solid var(--border-0)", background: "var(--bg-1)", flexShrink: 0,
        }}>
          <button
            onClick={() => setRightTab("graph")}
            style={{
              display: "flex", alignItems: "center", gap: 5, height: "100%",
              padding: "0 10px", fontSize: 11, fontWeight: rightTab === "graph" ? 500 : 400,
              border: "none", background: "transparent", cursor: "pointer",
              borderBottom: rightTab === "graph" ? "1px solid var(--text-0)" : "1px solid transparent",
              color: rightTab === "graph" ? "var(--text-0)" : "var(--text-2)",
              transition: "color 120ms ease, border-color 120ms ease",
            }}
          >
            <Graph size={12} weight="regular" /> Dependency graph
          </button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {highlighted.size > 0 && (
              <button
                onClick={() => setHighlighted(new Set())}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  fontSize: 10, color: "var(--accent-text)", cursor: "pointer",
                  background: "transparent", border: "none",
                  fontFamily: "var(--font-geist-sans)",
                }}
              >
                <X size={10} weight="regular" /> Clear impact
              </button>
            )}
            <span style={{ fontSize: 10, color: "var(--text-2)" }}>Click node to analyse</span>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: 8 }}>
          {graphData.nodes.length > 0 ? (
            <GraphPanel data={graphData} onNodeClick={handleNodeClick} highlightedNodes={highlighted} />
          ) : (
            <div style={{ display: "flex", justifyContent: "flex-end", height: "100%", padding: "10px" }}>
              <p data-mono style={{ fontSize: 11, color: "var(--text-2)" }}>
                {activeRepo
                  ? activeRepo.status !== "ready" ? "// Indexing repository..." : "// Loading graph..."
                  : "// Awaiting repository selection."}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Settings modal ── */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            key="backdrop"
            initial={rm ? {} : { opacity: 0 }}
            animate={rm ? {} : { opacity: 1 }}
            exit={rm ? {} : { opacity: 0 }}
            transition={rm ? { duration: 0 } : { duration: 0.18, ease: EASE_OUT }}
            onClick={e => e.target === e.currentTarget && setShowSettings(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 50,
              display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
              background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)",
            }}
          >
            <motion.div
              key="modal"
              initial={rm ? {} : { opacity: 0, scale: 0.95, y: 10 }}
              animate={rm ? {} : { opacity: 1, scale: 1, y: 0 }}
              exit={rm ? {} : { opacity: 0, scale: 0.95, y: 10 }}
              transition={rm ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT }}
              className="bezel"
              style={{ width: "100%", maxWidth: 420, overflow: "hidden" }}
            >
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", borderBottom: "1px solid var(--border-0)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Gear size={14} weight="regular" style={{ color: "var(--accent)" }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Settings</span>
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-2)", display: "flex", alignItems: "center" }}
                >
                  <X size={15} weight="regular" />
                </button>
              </div>

              {/* Body */}
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--text-1)", marginBottom: 7 }}>
                    Groq API key
                  </label>
                  <input
                    type="password"
                    value={groqKey}
                    onChange={e => setGroqKey(e.target.value)}
                    placeholder="gsk_..."
                    className="bezel-inner"
                    style={{
                      width: "100%", padding: "8px 11px", fontSize: 12,
                      color: "var(--text-0)", border: "1px solid var(--border-0)",
                      outline: "none", background: "rgba(0,0,0,0.25)",
                      borderRadius: "var(--r2)", fontFamily: "var(--font-geist-mono)",
                      transition: "border-color 120ms cubic-bezier(0.23,1,0.32,1)",
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = "var(--accent-border)")}
                    onBlur={e => (e.currentTarget.style.borderColor = "var(--border-0)")}
                  />
                  <p style={{ fontSize: 10, color: "var(--text-2)", marginTop: 7, lineHeight: 1.6 }}>
                    Encrypted at rest with AES-256-GCM. Decrypted only in-memory during inference.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--border-0)", background: "rgba(0,0,0,0.15)" }}>
                <button className="btn-ghost" onClick={() => setShowSettings(false)}>Cancel</button>
                <button className="btn-accent" onClick={saveSettings}>Save</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Confirm Import modal ── */}
      <AnimatePresence>
        {confirmImport && (
          <motion.div
            key="backdrop"
            initial={rm ? {} : { opacity: 0 }}
            animate={rm ? {} : { opacity: 1 }}
            exit={rm ? {} : { opacity: 0 }}
            transition={rm ? { duration: 0 } : { duration: 0.18, ease: EASE_OUT }}
            onClick={e => e.target === e.currentTarget && setConfirmImport(null)}
            style={{
              position: "fixed", inset: 0, zIndex: 60,
              display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
              background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)",
            }}
          >
            <motion.div
              key="modal"
              initial={rm ? {} : { opacity: 0, scale: 0.95, y: 10 }}
              animate={rm ? {} : { opacity: 1, scale: 1, y: 0 }}
              exit={rm ? {} : { opacity: 0, scale: 0.95, y: 10 }}
              transition={rm ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT }}
              className="bezel"
              style={{ width: "100%", maxWidth: 400, overflow: "hidden" }}
            >
              <div style={{ padding: "20px 24px" }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-0)", marginBottom: 8 }}>
                  Import Repository
                </h3>
                <p style={{ fontSize: 12, color: "var(--text-1)", lineHeight: 1.6 }}>
                  Do you want to import <span style={{ color: "var(--text-0)", fontFamily: "var(--font-geist-mono)" }}>{confirmImport.full_name}</span>?
                  <br />
                  This will analyze the repository structure and map dependencies.
                </p>
              </div>
              
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 24px", borderTop: "1px solid var(--border-0)", background: "var(--bg-1)" }}>
                <button 
                  className="btn-ghost" 
                  onClick={() => setConfirmImport(null)}
                  style={{ padding: "6px 14px", fontSize: 12, borderRadius: "var(--r2)" }}
                >
                  Cancel
                </button>
                <button 
                  style={{
                    background: "var(--text-0)", color: "#000", border: "none",
                    padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: "var(--r2)",
                    cursor: "pointer", transition: "opacity 100ms ease"
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
                  onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                  onClick={() => {
                    setActiveRepo(confirmImport);
                    importRepo(confirmImport.full_name);
                    setConfirmImport(null);
                  }}
                >
                  Import Repository
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
