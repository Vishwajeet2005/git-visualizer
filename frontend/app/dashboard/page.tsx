"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap, Settings, ChevronRight, Folder, File, Search,
  GitBranch, Layers, MessageSquare, Code2, X, Send,
  Loader2, CheckCircle2, Clock, Download, FlaskConical,
  RefreshCw, AlertCircle, Circle, ChevronDown,
} from "lucide-react";

// ── Dynamic imports (client-only heavy deps) ──────────────────────────────────
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
      <span className="text-xs text-neutral-500">Initialising 3D engine…</span>
    </div>
  ),
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileNode {
  id: string;
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  language?: string;
}

interface GraphNode {
  id: string;
  name: string;
  file_path: string;
  node_type: string;
  language: string;
  val: number;
  color?: string;
}

interface GraphLink {
  source: string;
  target: string;
  type: "call" | "import";
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface DiffResult {
  before: string;
  after: string;
  explanation: string;
}

interface Repository {
  id: string;
  full_name: string;
  status: string;
  chunk_count: number;
  file_count: number;
}

interface GithubRepo {
  full_name: string;
  private: boolean;
  html_url: string;
  updated_at: string;
}

interface MergedRepo {
  full_name: string;
  id?: string;
  status: string;
  chunk_count?: number;
  file_count?: number;
}

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

const LANG_COLORS: Record<string, string> = {
  python:     "#3b82f6",
  typescript: "#a78bfa",
  javascript: "#fbbf24",
  go:         "#34d399",
  rust:       "#f97316",
  java:       "#fb7185",
};

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "ready" || status === "READY") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-full px-2 py-0.5">
        <CheckCircle2 className="w-2.5 h-2.5" /> Ready
      </span>
    );
  }
  if (status === "unimported") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-neutral-500 bg-white/4 border border-white/8 rounded-full px-2 py-0.5">
        <Download className="w-2.5 h-2.5" /> Import
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5">
      <Clock className="w-2.5 h-2.5 animate-pulse" /> {status}
    </span>
  );
}

// ─── File Tree ────────────────────────────────────────────────────────────────

function FileTreeNode({
  node, depth, onSelect, selected,
}: {
  node: FileNode;
  depth: number;
  onSelect: (n: FileNode) => void;
  selected: string | null;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isSelected = selected === node.id;

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className="sidebar-item"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          <motion.span
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: 0.15, ease: "easeInOut" }}
            className="shrink-0 text-neutral-600"
          >
            <ChevronRight className="w-3 h-3" />
          </motion.span>
          <Folder className="w-3 h-3 shrink-0 text-amber-400/70" />
          <span className="truncate text-[11px]">{node.name}</span>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeInOut" }}
              style={{ overflow: "hidden" }}
            >
              {node.children?.map((child) => (
                <FileTreeNode
                  key={child.id}
                  node={child}
                  depth={depth + 1}
                  onSelect={onSelect}
                  selected={selected}
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
      style={{ paddingLeft: `${8 + depth * 14}px` }}
    >
      <File className="w-3 h-3 shrink-0 text-neutral-600" />
      <span className="truncate text-[11px]">{node.name}</span>
      {node.language && (
        <span
          className="ml-auto shrink-0 text-[9px] font-mono px-1.5 py-px rounded-sm font-semibold"
          style={{
            background: `${LANG_COLORS[node.language] ?? "#888"}18`,
            color: LANG_COLORS[node.language] ?? "#888",
          }}
        >
          {node.language.slice(0, 2).toUpperCase()}
        </span>
      )}
    </button>
  );
}

// ─── Diff Viewer ──────────────────────────────────────────────────────────────

function DiffViewer({ diff }: { diff: DiffResult }) {
  const renderLines = (code: string, sign: "+" | "-") =>
    code.split("\n").map((line, i) => (
      <div
        key={i}
        className={`px-4 py-0.5 font-mono text-[11px] leading-relaxed flex gap-3
                    ${sign === "-" ? "bg-red-500/8 text-red-300/80" : "bg-emerald-500/8 text-emerald-300/80"}`}
      >
        <span className={`select-none w-3 shrink-0 ${sign === "-" ? "text-red-500/50" : "text-emerald-500/50"}`}>{sign}</span>
        <span className="break-all">{line || " "}</span>
      </div>
    ));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-neutral-400 leading-relaxed bg-white/3 border border-white/6 rounded-lg p-3">
        {diff.explanation}
      </p>
      <div className="grid grid-cols-2 rounded-xl overflow-hidden border border-white/8">
        <div>
          <div className="px-4 py-2 text-[11px] font-medium text-red-400 bg-red-500/5 border-b border-white/6 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500/60" /> Before
          </div>
          <div className="overflow-auto max-h-80">{renderLines(diff.before, "-")}</div>
        </div>
        <div className="border-l border-white/8">
          <div className="px-4 py-2 text-[11px] font-medium text-emerald-400 bg-emerald-500/5 border-b border-white/6 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500/60" /> After
          </div>
          <div className="overflow-auto max-h-80">{renderLines(diff.after, "+")}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────

function ChatPanel({
  messages, loading, input, onInputChange, onSend, onGenerateTests, onRefactor, activeFile,
}: {
  messages: ChatMessage[];
  loading: boolean;
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  onGenerateTests: () => void;
  onRefactor: () => void;
  activeFile: FileNode | null;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/6 shrink-0">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={onGenerateTests}
          disabled={!activeFile || loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium
                     border border-white/8 text-neutral-400 hover:text-white hover:bg-white/5
                     hover:border-white/12 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <FlaskConical className="w-3 h-3" />
          Generate tests
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={onRefactor}
          disabled={!activeFile || loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium
                     border border-white/8 text-neutral-400 hover:text-white hover:bg-white/5
                     hover:border-white/12 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <RefreshCw className="w-3 h-3" />
          Refactor diff
        </motion.button>
        {activeFile && (
          <span className="ml-auto text-[10px] text-neutral-600 truncate max-w-[150px] flex items-center gap-1">
            <File className="w-2.5 h-2.5 shrink-0" />
            {activeFile.path}
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-20 gap-4">
            <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-neutral-300 mb-1">Ask Nexus anything</p>
              <p className="text-xs text-neutral-600 max-w-[220px]">
                Select a file for targeted context, or ask about the whole repo.
              </p>
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="w-6 h-6 rounded-lg bg-purple-500/15 border border-purple-500/25 flex items-center justify-center mr-2 mt-1 shrink-0">
                  <Zap className="w-3 h-3 text-purple-400" />
                </div>
              )}
              <div
                className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed
                            ${msg.role === "user"
                              ? "bg-purple-600/20 text-purple-100 border border-purple-500/20 rounded-tr-md"
                              : "bg-white/5 text-neutral-200 border border-white/6 rounded-tl-md"}`}
              >
                <pre className="whitespace-pre-wrap font-sans break-words text-[13px] leading-relaxed">
                  {msg.content}
                </pre>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-start gap-2"
          >
            <div className="w-6 h-6 rounded-lg bg-purple-500/15 border border-purple-500/25 flex items-center justify-center shrink-0">
              <Zap className="w-3 h-3 text-purple-400" />
            </div>
            <div className="bg-white/5 border border-white/6 rounded-2xl rounded-tl-md px-4 py-3 flex gap-1 items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-neutral-500 typing-dot" />
              <span className="w-1.5 h-1.5 rounded-full bg-neutral-500 typing-dot" />
              <span className="w-1.5 h-1.5 rounded-full bg-neutral-500 typing-dot" />
            </div>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-white/6 shrink-0">
        <div
          className="flex items-end gap-2 bg-white/4 border border-white/8 rounded-xl px-3 py-2
                     focus-within:border-purple-500/40 focus-within:bg-white/6 transition-all"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about the codebase…"
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-white placeholder-neutral-600
                       focus:outline-none max-h-32 overflow-y-auto py-0.5 leading-relaxed"
          />
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onSend}
            disabled={!input.trim() || loading}
            className="shrink-0 w-7 h-7 rounded-lg bg-purple-600 hover:bg-purple-500 flex items-center justify-center
                       text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </motion.button>
        </div>
        <p className="text-[10px] text-neutral-700 mt-1.5 px-1">Enter to send · Shift+Enter for newline</p>
      </div>
    </div>
  );
}

// ─── 3D Graph Panel ───────────────────────────────────────────────────────────

function GraphPanel({
  data, onNodeClick, highlightedNodes,
}: {
  data: GraphData;
  onNodeClick: (node: GraphNode) => void;
  highlightedNodes: Set<string>;
}) {
  const fgRef = useRef<any>(null);
  const [hoverNode, setHoverNode] = useState<any | null>(null);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    data.links.forEach((linkObj) => {
      const l = linkObj as any;
      const s = typeof l.source === "object" ? l.source.id : l.source;
      const t = typeof l.target === "object" ? l.target.id : l.target;
      if (!map.has(s)) map.set(s, new Set());
      if (!map.has(t)) map.set(t, new Set());
      map.get(s)!.add(t);
      map.get(t)!.add(s);
    });
    return map;
  }, [data]);

  const nodeColor = useCallback(
    (node: any) => {
      if (hoverNode) {
        if (node.id === hoverNode.id) return "#ffffff";
        if (neighbors.get(hoverNode.id)?.has(node.id)) return LANG_COLORS[node.language] ?? "#888";
        return "#1a1a2e";
      }
      if (highlightedNodes.size === 0) return LANG_COLORS[node.language] ?? "#888";
      return highlightedNodes.has(node.id) ? "#f59e0b" : "#1a1a2e";
    },
    [highlightedNodes, hoverNode, neighbors]
  );

  const linkColor = useCallback(
    (link: any) => {
      const srcId = typeof link.source === "object" ? link.source.id : link.source;
      const tgtId = typeof link.target === "object" ? link.target.id : link.target;
      if (hoverNode && (srcId === hoverNode.id || tgtId === hoverNode.id)) return "rgba(255,255,255,0.35)";
      if (hoverNode) return "rgba(255,255,255,0.02)";
      if (highlightedNodes.has(srcId) || highlightedNodes.has(tgtId)) return "rgba(245,158,11,0.7)";
      return "rgba(255,255,255,0.05)";
    },
    [highlightedNodes, hoverNode]
  );

  const handleNodeClick = useCallback(
    (node: any) => {
      if (fgRef.current) {
        const distance = 100;
        const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
        fgRef.current.cameraPosition(
          { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
          node,
          1800
        );
      }
      onNodeClick(node);
    },
    [onNodeClick]
  );

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden bg-[#04040c]">
      {/* Language legend */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 bg-black/40 backdrop-blur-sm rounded-lg p-2 border border-white/6">
        {Object.entries(LANG_COLORS).map(([lang, color]) => (
          <div key={lang} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-[9px] text-neutral-500 font-medium">{lang}</span>
          </div>
        ))}
      </div>

      {/* Impact badge */}
      {highlightedNodes.size > 0 && (
        <div className="absolute top-3 right-3 z-10 px-2.5 py-1.5 rounded-full
                        bg-amber-500/15 border border-amber-500/30 text-[11px] text-amber-300 flex items-center gap-1.5">
          <Zap className="w-3 h-3" />
          Impact: {highlightedNodes.size} nodes
        </div>
      )}

      <ForceGraph3D
        ref={fgRef}
        graphData={data}
        nodeLabel={(n: any) => `${n.name} · ${n.node_type}`}
        nodeColor={nodeColor}
        nodeVal={(n: any) => Math.sqrt(n.val ?? 1)}
        nodeOpacity={0.92}
        linkColor={linkColor}
        linkWidth={(l: any) => {
          const srcId = typeof l.source === "object" ? l.source.id : l.source;
          const tgtId = typeof l.target === "object" ? l.target.id : l.target;
          if (hoverNode && (srcId === hoverNode.id || tgtId === hoverNode.id)) return 1.2;
          return highlightedNodes.has(srcId) ? 2 : 0.3;
        }}
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleSpeed={(l: any) => l.type === "import" ? 0.004 : 0.009}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={1}
        onNodeClick={handleNodeClick}
        onNodeHover={setHoverNode}
        backgroundColor="#04040c"
        showNavInfo={false}
      />
    </div>
  );
}

// ─── Repo Dropdown ────────────────────────────────────────────────────────────

function RepoSelect({
  repos, activeRepo, onSelect, isImporting,
}: {
  repos: MergedRepo[];
  activeRepo: MergedRepo | null;
  onSelect: (r: MergedRepo) => void;
  isImporting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const label = activeRepo
    ? activeRepo.full_name.split("/")[1]
    : "Select repository…";

  return (
    <div className="relative w-full" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-white/4 hover:bg-white/6
                   border border-white/8 hover:border-white/14 rounded-xl text-xs
                   text-neutral-300 transition-all"
      >
        <GitBranch className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
        <span className="flex-1 text-left truncate">{label}</span>
        {isImporting ? (
          <Loader2 className="w-3 h-3 text-purple-400 animate-spin shrink-0" />
        ) : (
          <ChevronDown className={`w-3 h-3 text-neutral-600 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-[#111120] border border-white/10
                       rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="max-h-64 overflow-y-auto py-1">
              {repos.length === 0 ? (
                <div className="flex items-center justify-center py-6 gap-2 text-xs text-neutral-600">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading repositories…
                </div>
              ) : (
                repos.map((r) => (
                  <button
                    key={r.full_name}
                    onClick={() => { onSelect(r); setOpen(false); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs
                                text-left hover:bg-white/5 transition-colors
                                ${activeRepo?.full_name === r.full_name ? "bg-purple-500/10 text-purple-200" : "text-neutral-300"}`}
                  >
                    <GitBranch className="w-3 h-3 text-neutral-600 shrink-0" />
                    <span className="flex-1 truncate">{r.full_name}</span>
                    <StatusBadge status={r.status} />
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Dashboard Root ───────────────────────────────────────────────────────────

export default function DashboardPage() {

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get("token");
    if (token) {
      localStorage.setItem("nexus_token", token);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const getHeaders = () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("nexus_token") : null;
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    };
  };

  const [repos, setRepos]           = useState<MergedRepo[]>([]);
  const [activeRepo, setActiveRepo] = useState<MergedRepo | null>(null);
  const [fileTree, setFileTree]     = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState<FileNode | null>(null);
  const [fileSearch, setFileSearch] = useState("");
  const [graphData, setGraphData]   = useState<GraphData>({ nodes: [], links: [] });
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());
  const [messages, setMessages]     = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]   = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [diff, setDiff]             = useState<DiffResult | null>(null);
  const [activeTab, setActiveTab]   = useState<"chat" | "diff">("chat");
  const [sidePanel, setSidePanel]   = useState<"graph" | "info">("graph");
  const [isImporting, setIsImporting] = useState(false);
  const [hasAutoExplained, setHasAutoExplained] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [groqKey, setGroqKey]       = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // ── Load & Poll repos ───────────────────────────────────────────────────────
  const fetchRepos = useCallback(async () => {
    try {
      const [dbRes, ghRes] = await Promise.all([
        fetch(`${API}/api/repos`, { credentials: "include", headers: getHeaders() }),
        fetch(`${API}/api/github/repos`, { credentials: "include", headers: getHeaders() }),
      ]);
      const dbRepos: Repository[] = dbRes.ok ? await dbRes.json() : [];
      const ghRepos: GithubRepo[] = ghRes.ok ? await ghRes.json() : [];

      const mergedMap = new Map<string, MergedRepo>();
      for (const gh of ghRepos) {
        mergedMap.set(gh.full_name, { full_name: gh.full_name, status: "unimported" });
      }
      for (const db of dbRepos) {
        mergedMap.set(db.full_name, {
          full_name: db.full_name,
          id: db.id,
          status: db.status,
          chunk_count: db.chunk_count,
          file_count: db.file_count,
        });
      }

      const merged = Array.from(mergedMap.values());
      setRepos(merged);
      return merged;
    } catch (err) {
      console.error("Failed to load repos:", err);
      return undefined;
    }
  }, []);

  useEffect(() => {
    fetchRepos().then((data) => {
      if (data) {
        const ready = data.find((r) => r.status === "ready");
        if (ready && !activeRepo) setActiveRepo(ready);
      }
    });
    const interval = setInterval(fetchRepos, 3000);
    return () => clearInterval(interval);
  }, [fetchRepos, activeRepo]);

  // ── Import repo ─────────────────────────────────────────────────────────────
  const handleImportRepo = useCallback(async (full_name: string) => {
    if (isImporting) return;
    setIsImporting(true);
    try {
      const resp = await fetch(`${API}/api/repos`, {
        method: "POST",
        headers: getHeaders(),
        credentials: "include",
        body: JSON.stringify({ full_name }),
      });
      if (resp.ok) {
        await fetchRepos();
      } else {
        const errData = await resp.json().catch(() => ({}));
        alert(`Error importing: ${errData.detail || resp.statusText}`);
      }
    } catch (err) {
      console.error(err);
      alert("Error importing repository.");
    } finally {
      setIsImporting(false);
    }
  }, [fetchRepos, isImporting]);

  // ── Handle repo selection ────────────────────────────────────────────────────
  const handleRepoSelect = useCallback(async (r: MergedRepo) => {
    setActiveRepo(r);
    if (r.status === "unimported") {
      await handleImportRepo(r.full_name);
    }
  }, [handleImportRepo]);

  // ── Save Settings ────────────────────────────────────────────────────────────
  const handleSaveSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/user/key`, {
        method: "POST",
        headers: getHeaders(),
        credentials: "include",
        body: JSON.stringify({ groq_api_key: groqKey }),
      });
      if (res.ok) {
        setShowSettings(false);
        setGroqKey("");
        alert("Settings saved!");
      } else {
        alert("Failed to save settings.");
      }
    } catch (e) {
      console.error(e);
      alert("Error saving settings.");
    }
  }, [groqKey]);

  // ── Load graph data ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeRepo?.id) return;
    let subscribed = true;
    fetch(`${API}/api/repos/${activeRepo.id}/graph`, {
      credentials: "include",
      headers: getHeaders(),
    })
      .then((r) => r.json())
      .then((data: GraphData) => { if (subscribed) setGraphData(data); })
      .catch(console.error);
    return () => { subscribed = false; };
  }, [activeRepo]);

  // ── Send chat message ────────────────────────────────────────────────────────
  const handleSend = useCallback(async (overrideInput?: string) => {
    const textToSend = typeof overrideInput === "string" ? overrideInput : chatInput;
    if (!textToSend.trim() || !activeRepo || chatLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: textToSend,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    if (typeof overrideInput !== "string") setChatInput("");
    setChatLoading(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", timestamp: new Date() },
    ]);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch(`${API}/api/query/stream`, {
        method: "POST",
        headers: getHeaders(),
        credentials: "include",
        body: JSON.stringify({
          question: textToSend,
          repository_id: activeRepo.id || "",
          provider: "groq",
        }),
        signal: ctrl.signal,
      });

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            const token = line.slice(6);
            if (token === "[DONE]") break;
            accumulated += token;
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: accumulated } : m))
            );
            const found = graphData.nodes.filter(
              (n) => n.name.length > 3 && accumulated.includes(n.name)
            );
            if (found.length > 0) {
              setHighlightedNodes((prev) => {
                const next = new Set(prev);
                let changed = false;
                for (const f of found) {
                  if (!next.has(f.id)) { next.add(f.id); changed = true; }
                }
                return changed ? next : prev;
              });
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "⚠️ Error: Failed to get response. Please retry." }
              : m
          )
        );
      }
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, activeRepo, chatLoading, graphData.nodes]);

  // ── Graph node click ─────────────────────────────────────────────────────────
  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (highlightedNodes.has(node.id)) {
        setHighlightedNodes(new Set());
      } else {
        const connected = new Set<string>([node.id]);
        for (const link of graphData.links) {
          const src = typeof link.source === "object" ? (link.source as any).id : link.source;
          const tgt = typeof link.target === "object" ? (link.target as any).id : link.target;
          if (src === node.id) connected.add(tgt);
          if (tgt === node.id) connected.add(src);
        }
        setHighlightedNodes(connected);
      }
      handleSend(`Explain the code in ${node.file_path} focusing on ${node.name}`);
    },
    [graphData.links, highlightedNodes, handleSend]
  );

  // ── File select ──────────────────────────────────────────────────────────────
  const handleFileSelect = useCallback(
    (file: FileNode) => {
      setActiveFile(file);
      if (file.type === "file") handleSend(`Explain the code in ${file.path}`);
    },
    [handleSend]
  );

  // ── Auto-explain ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (
      activeRepo &&
      activeRepo.status === "ready" &&
      !hasAutoExplained.has(activeRepo.full_name)
    ) {
      setHasAutoExplained((prev) => new Set(prev).add(activeRepo.full_name));
      setTimeout(() => {
        handleSend("Explain the overall architecture and purpose of this repository.");
      }, 500);
    }
  }, [activeRepo, hasAutoExplained, handleSend]);

  // ── Generate tests ────────────────────────────────────────────────────────────
  const handleGenerateTests = useCallback(async () => {
    if (!activeFile || !activeRepo) return;
    handleSend(`Generate a complete unit test suite for ${activeFile.name}`);
  }, [activeFile, activeRepo, handleSend]);

  // ── Refactor diff ─────────────────────────────────────────────────────────────
  const handleRefactor = useCallback(async () => {
    if (!activeFile || !activeRepo) return;
    const instruction = window.prompt(
      "Describe the refactoring (e.g. 'Add error handling and type guards'):"
    );
    if (!instruction) return;

    setChatLoading(true);
    try {
      const resp = await fetch(`${API}/api/tools/refactor-diff`, {
        method: "POST",
        headers: getHeaders(),
        credentials: "include",
        body: JSON.stringify({
          repository_id: activeRepo.id || "",
          file_path: activeFile.path,
          symbol_name: activeFile.name,
          refactor_instruction: instruction,
          provider: "groq",
        }),
      });

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            const t = line.slice(6);
            if (t !== "[DONE]") raw += t;
          }
        }
      }

      const parsed: DiffResult = JSON.parse(raw);
      setDiff(parsed);
      setActiveTab("diff");
    } catch {
      alert("Failed to generate refactor diff.");
    } finally {
      setChatLoading(false);
    }
  }, [activeFile, activeRepo]);

  // ── Filtered file tree ───────────────────────────────────────────────────────
  const filteredTree = useMemo(() => {
    if (!fileSearch) return fileTree;
    const q = fileSearch.toLowerCase();
    const filter = (nodes: FileNode[]): FileNode[] =>
      nodes.flatMap((n) => {
        if (n.type === "file" && n.name.toLowerCase().includes(q)) return [n];
        if (n.type === "directory" && n.children) {
          const filtered = filter(n.children);
          return filtered.length ? [{ ...n, children: filtered }] : [];
        }
        return [];
      });
    return filter(fileTree);
  }, [fileTree, fileSearch]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>

      {/* ── Left sidebar ── */}
      <aside
        className="w-[220px] flex-shrink-0 flex flex-col"
        style={{ background: "var(--bg-surface)", borderRight: "1px solid var(--border)" }}
      >
        {/* Logo & repo selector */}
        <div className="px-3 py-3 flex flex-col gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
          {/* Logo */}
          <div className="flex items-center gap-2 px-1">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                 style={{ background: "var(--purple-mid)", border: "1px solid rgba(139,92,246,0.35)" }}>
              <Zap className="w-3.5 h-3.5 text-purple-300" />
            </div>
            <span className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
              Nexus
            </span>
          </div>

          {/* Repo selector */}
          <RepoSelect
            repos={repos}
            activeRepo={activeRepo}
            onSelect={handleRepoSelect}
            isImporting={isImporting}
          />

          {/* Repo meta */}
          {activeRepo && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="flex items-center gap-2 px-1"
            >
              <StatusBadge status={activeRepo.status} />
              {(activeRepo.status === "ready" || activeRepo.status === "READY") && (
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {(activeRepo.chunk_count || 0).toLocaleString()} chunks · {activeRepo.file_count || 0} files
                </span>
              )}
            </motion.div>
          )}
        </div>

        {/* File search */}
        <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
               style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
            <Search className="w-3 h-3 shrink-0" style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              placeholder="Search files…"
              value={fileSearch}
              onChange={(e) => setFileSearch(e.target.value)}
              className="flex-1 bg-transparent text-[11px] placeholder-neutral-700 focus:outline-none"
              style={{ color: "var(--text-secondary)" }}
            />
          </div>
        </div>

        {/* File tree */}
        <div className="flex-1 overflow-y-auto py-1.5 px-2">
          {filteredTree.length === 0 && (
            <p className="text-[11px] px-2 py-5 text-center" style={{ color: "var(--text-muted)" }}>
              {activeRepo ? "No files indexed yet." : "Select a repository."}
            </p>
          )}
          {filteredTree.map((node) => (
            <FileTreeNode
              key={node.id}
              node={node}
              depth={0}
              onSelect={handleFileSelect}
              selected={activeFile?.id ?? null}
            />
          ))}
        </div>

        {/* Settings */}
        <div className="p-2" style={{ borderTop: "1px solid var(--border)" }}>
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowSettings(true)}
            className="sidebar-item w-full"
          >
            <Settings className="w-3.5 h-3.5 shrink-0" />
            <span className="text-[11px]">Settings</span>
          </motion.button>
        </div>
      </aside>

      {/* ── Centre: Chat / Diff ── */}
      <div
        className="flex-1 flex flex-col min-w-0"
        style={{ borderRight: "1px solid var(--border)" }}
      >
        {/* Tab bar */}
        <div
          className="flex items-center px-4 h-11 shrink-0 gap-1"
          style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}
        >
          {(["chat", "diff"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative flex items-center gap-1.5 px-3 h-full text-[11px] font-medium
                          transition-colors border-b-2
                          ${activeTab === tab
                            ? "border-purple-500 text-white"
                            : "border-transparent hover:text-neutral-300"}`}
              style={{ color: activeTab === tab ? "var(--text-primary)" : "var(--text-muted)" }}
            >
              {tab === "chat" ? <><MessageSquare className="w-3 h-3" /> Chat</> : <><Code2 className="w-3 h-3" /> Diff viewer</>}
              {tab === "diff" && diff && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0">
          {activeTab === "chat" ? (
            <ChatPanel
              messages={messages}
              loading={chatLoading}
              input={chatInput}
              onInputChange={setChatInput}
              onSend={handleSend}
              onGenerateTests={handleGenerateTests}
              onRefactor={handleRefactor}
              activeFile={activeFile}
            />
          ) : (
            <div className="p-4 overflow-y-auto h-full">
              {diff ? (
                <DiffViewer diff={diff} />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <Code2 className="w-8 h-8" style={{ color: "var(--text-muted)" }} />
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Select a file and click "Refactor diff" to generate a before/after diff.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: 3D graph ── */}
      <div className="w-[44%] flex-shrink-0 flex flex-col" style={{ background: "var(--bg-base)" }}>
        {/* Graph header */}
        <div
          className="flex items-center gap-2 px-4 h-11 shrink-0"
          style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}
        >
          <button
            onClick={() => setSidePanel("graph")}
            className={`flex items-center gap-1.5 px-3 h-full text-[11px] font-medium
                        transition-colors border-b-2
                        ${sidePanel === "graph" ? "border-blue-500 text-white" : "border-transparent"}`}
            style={{ color: sidePanel === "graph" ? "var(--text-primary)" : "var(--text-muted)" }}
          >
            <Layers className="w-3 h-3" />
            Dependency graph
          </button>

          <div className="ml-auto flex items-center gap-3">
            {highlightedNodes.size > 0 && (
              <button
                onClick={() => setHighlightedNodes(new Set())}
                className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1"
              >
                <X className="w-2.5 h-2.5" /> Clear impact
              </button>
            )}
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              Click a node to analyse
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0 p-2">
          {graphData.nodes.length > 0 ? (
            <GraphPanel
              data={graphData}
              onNodeClick={handleNodeClick}
              highlightedNodes={highlightedNodes}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <Layers className="w-8 h-8" style={{ color: "var(--text-muted)" }} />
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {activeRepo
                  ? activeRepo.status !== "ready"
                    ? "Indexing repository…"
                    : "Graph loading…"
                  : "Select a repository to view the dependency graph."}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Settings Modal ── */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
            onClick={(e) => e.target === e.currentTarget && setShowSettings(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            >
              <div
                className="flex items-center justify-between px-5 py-4"
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-purple-400" />
                  <h2 className="text-sm font-semibold">Settings</h2>
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-neutral-500 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                    Groq API Key
                  </label>
                  <input
                    type="password"
                    value={groqKey}
                    onChange={(e) => setGroqKey(e.target.value)}
                    placeholder="gsk_…"
                    className="w-full rounded-lg px-3 py-2 text-sm text-white
                               focus:outline-none transition-colors"
                    style={{
                      background: "var(--bg-hover)",
                      border: "1px solid var(--border)",
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "var(--border-focus)")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                  />
                  <p className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>
                    Your key is encrypted at rest with AES-256-GCM and only decrypted in-memory during inference.
                  </p>
                </div>
              </div>

              <div
                className="flex items-center justify-end gap-3 px-5 py-4"
                style={{ borderTop: "1px solid var(--border)", background: "rgba(0,0,0,0.2)" }}
              >
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 text-xs font-medium transition-colors hover:text-white"
                  style={{ color: "var(--text-muted)" }}
                >
                  Cancel
                </button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handleSaveSettings}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  Save settings
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
