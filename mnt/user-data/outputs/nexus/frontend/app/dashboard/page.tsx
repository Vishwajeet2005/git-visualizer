"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";

// ── Dynamic imports (client-only heavy deps) ──────────────────────────────────
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
      Initialising 3D engine…
    </div>
  ),
});

// ─── Types ─────────────────────────────────────────────────────────────────────

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
  val: number;             // bubble size
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

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

const LANG_COLORS: Record<string, string> = {
  python:     "#3b82f6",
  typescript: "#a78bfa",
  javascript: "#fbbf24",
  go:         "#34d399",
  rust:       "#f97316",
  java:       "#fb7185",
};

// ─── File Tree ────────────────────────────────────────────────────────────────

function FileTreeNode({
  node,
  depth,
  onSelect,
  selected,
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
          className={`flex items-center gap-1.5 w-full text-left py-0.5 px-2 rounded-md
                      text-xs text-neutral-400 hover:text-white hover:bg-white/5 transition-colors`}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          <span className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
          <span className="text-neutral-500">📁</span>
          <span>{node.name}</span>
        </button>
        {open &&
          node.children?.map((child) => (
            <FileTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              selected={selected}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node)}
      className={`flex items-center gap-1.5 w-full text-left py-0.5 rounded-md
                  text-xs transition-colors
                  ${isSelected
                    ? "bg-purple-500/15 text-purple-300"
                    : "text-neutral-400 hover:text-white hover:bg-white/5"}`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      <span className="text-neutral-500">📄</span>
      <span className="truncate">{node.name}</span>
      {node.language && (
        <span
          className="ml-auto mr-1 text-[10px] px-1.5 py-0.5 rounded font-mono"
          style={{
            background: `${LANG_COLORS[node.language] ?? "#888"}22`,
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
        className={`px-3 py-0.5 font-mono text-xs leading-relaxed
                    ${sign === "-"
                      ? "bg-red-500/10 text-red-300"
                      : "bg-green-500/10 text-green-300"}`}
      >
        <span className="mr-2 select-none opacity-40">{sign}</span>
        {line || " "}
      </div>
    ));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-neutral-400 leading-relaxed">{diff.explanation}</p>
      <div className="grid grid-cols-2 gap-2 rounded-xl overflow-hidden border border-white/8">
        <div>
          <div className="px-3 py-2 text-xs text-red-400 bg-red-500/5 border-b border-white/5">
            Before
          </div>
          <div className="overflow-auto max-h-80">{renderLines(diff.before, "-")}</div>
        </div>
        <div className="border-l border-white/8">
          <div className="px-3 py-2 text-xs text-green-400 bg-green-500/5 border-b border-white/5">
            After
          </div>
          <div className="overflow-auto max-h-80">{renderLines(diff.after, "+")}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────

function ChatPanel({
  messages,
  loading,
  input,
  onInputChange,
  onSend,
  onGenerateTests,
  onRefactor,
  activeFile,
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {/* Action toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
        <button
          onClick={onGenerateTests}
          disabled={!activeFile || loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                     border border-white/8 bg-white/4 hover:bg-white/8 text-neutral-300
                     hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span>⚗</span> Generate tests
        </button>
        <button
          onClick={onRefactor}
          disabled={!activeFile || loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                     border border-white/8 bg-white/4 hover:bg-white/8 text-neutral-300
                     hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span>⟳</span> Refactor diff
        </button>
        {activeFile && (
          <span className="ml-auto text-xs text-neutral-600 truncate max-w-[160px]">
            {activeFile.path}
          </span>
        )}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 custom-scroll">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-16 gap-3">
            <div className="text-3xl opacity-30">⚡</div>
            <p className="text-sm text-neutral-600 max-w-xs">
              Ask anything about your repository. Select a file first for targeted context.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed
                          ${msg.role === "user"
                            ? "bg-purple-500/20 text-purple-100 rounded-br-md"
                            : "bg-white/6 text-neutral-200 rounded-bl-md"}`}
            >
              <pre className="whitespace-pre-wrap font-sans break-words">{msg.content}</pre>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-1 px-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div className="px-4 py-3 border-t border-white/8">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Ask about the codebase…"
            rows={1}
            className="flex-1 resize-none bg-white/5 border border-white/10 rounded-xl
                       px-3 py-2.5 text-sm text-white placeholder-neutral-600
                       focus:outline-none focus:border-purple-500/50 focus:bg-white/8
                       transition-colors max-h-32 overflow-y-auto"
          />
          <button
            onClick={onSend}
            disabled={!input.trim() || loading}
            className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500
                       text-white text-sm font-medium transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 3D Graph Panel ───────────────────────────────────────────────────────────

function GraphPanel({
  data,
  onNodeClick,
  highlightedNodes,
}: {
  data: GraphData;
  onNodeClick: (node: GraphNode) => void;
  highlightedNodes: Set<string>;
}) {
  const fgRef = useRef<any>(null);

  const nodeColor = useCallback(
    (node: any) => {
      if (highlightedNodes.size === 0) {
        return LANG_COLORS[node.language] ?? "#888";
      }
      return highlightedNodes.has(node.id) ? "#f59e0b" : "#1e1e2e";
    },
    [highlightedNodes]
  );

  const linkColor = useCallback(
    (link: any) => {
      const srcId = typeof link.source === "object" ? link.source.id : link.source;
      const tgtId = typeof link.target === "object" ? link.target.id : link.target;
      if (highlightedNodes.has(srcId) || highlightedNodes.has(tgtId)) {
        return "rgba(245,158,11,0.8)";
      }
      return "rgba(255,255,255,0.06)";
    },
    [highlightedNodes]
  );

  return (
    <div className="relative w-full h-full bg-[#080810] rounded-xl overflow-hidden">
      {/* Legend */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
        {Object.entries(LANG_COLORS).map(([lang, color]) => (
          <div key={lang} className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: color }}
            />
            <span className="text-[10px] text-neutral-500">{lang}</span>
          </div>
        ))}
      </div>

      {/* Impact mode hint */}
      {highlightedNodes.size > 0 && (
        <div
          className="absolute top-3 right-3 z-10 px-3 py-1.5 rounded-full
                     bg-amber-500/15 border border-amber-500/30 text-xs text-amber-300"
        >
          ⚡ Impact mode — {highlightedNodes.size} nodes affected
        </div>
      )}

      <ForceGraph3D
        ref={fgRef}
        graphData={data}
        nodeLabel={(n: any) => `${n.name} (${n.node_type})`}
        nodeColor={nodeColor}
        nodeVal={(n: any) => n.val ?? 1}
        linkColor={linkColor}
        linkWidth={(l: any) => (
          highlightedNodes.has(
            typeof l.source === "object" ? l.source.id : l.source
          ) ? 2 : 0.3
        )}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        onNodeClick={(node: any) => onNodeClick(node)}
        backgroundColor="#080810"
        showNavInfo={false}
      />
    </div>
  );
}

// ─── Dashboard Root ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [repos, setRepos]         = useState<Repository[]>([]);
  const [activeRepo, setActiveRepo] = useState<Repository | null>(null);
  const [fileTree, setFileTree]   = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState<FileNode | null>(null);
  const [fileSearch, setFileSearch] = useState("");
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [diff, setDiff]           = useState<DiffResult | null>(null);
  const [showDiff, setShowDiff]   = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "diff">("chat");
  const [sidePanel, setSidePanel] = useState<"graph" | "info">("graph");
  const abortRef = useRef<AbortController | null>(null);

  // ── Load repos ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/repos`, { credentials: "include" })
      .then((r) => r.json())
      .then((data: Repository[]) => {
        setRepos(data);
        const ready = data.find((r) => r.status === "ready");
        if (ready) setActiveRepo(ready);
      })
      .catch(console.error);
  }, []);

  // ── Load mock graph data when repo changes ──────────────────────────────────
  useEffect(() => {
    if (!activeRepo) return;
    // In production: fetch from /api/repos/:id/graph
    // Mock data for demonstration
    const mockNodes: GraphNode[] = [
      { id: "auth-service", name: "AuthService", file_path: "src/auth/service.ts", node_type: "class", language: "typescript", val: 3 },
      { id: "validate-token", name: "validateToken", file_path: "src/auth/service.ts", node_type: "method", language: "typescript", val: 2 },
      { id: "user-repo", name: "UserRepository", file_path: "src/users/repository.ts", node_type: "class", language: "typescript", val: 2 },
      { id: "find-by-id", name: "findById", file_path: "src/users/repository.ts", node_type: "method", language: "typescript", val: 1 },
      { id: "middleware", name: "authMiddleware", file_path: "src/middleware/auth.ts", node_type: "function", language: "typescript", val: 2 },
      { id: "jwt-util", name: "verifyJWT", file_path: "src/utils/jwt.ts", node_type: "function", language: "typescript", val: 1 },
      { id: "main-app", name: "app", file_path: "src/app.ts", node_type: "module", language: "typescript", val: 4 },
      { id: "db-conn", name: "connectDatabase", file_path: "src/db/index.ts", node_type: "function", language: "typescript", val: 1 },
    ];
    const mockLinks: GraphLink[] = [
      { source: "middleware", target: "validate-token", type: "call" },
      { source: "validate-token", target: "jwt-util", type: "call" },
      { source: "validate-token", target: "find-by-id", type: "call" },
      { source: "auth-service", target: "validate-token", type: "import" },
      { source: "user-repo", target: "find-by-id", type: "import" },
      { source: "main-app", target: "middleware", type: "import" },
      { source: "main-app", target: "db-conn", type: "import" },
      { source: "main-app", target: "auth-service", type: "import" },
    ];
    setGraphData({ nodes: mockNodes, links: mockLinks });
  }, [activeRepo]);

  // ── Graph node click → Impact Analysis Mode ─────────────────────────────────
  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (highlightedNodes.has(node.id)) {
        setHighlightedNodes(new Set());
        return;
      }
      // BFS to find connected neighbours
      const connected = new Set<string>([node.id]);
      for (const link of graphData.links) {
        const src = typeof link.source === "object" ? (link.source as any).id : link.source;
        const tgt = typeof link.target === "object" ? (link.target as any).id : link.target;
        if (src === node.id) connected.add(tgt);
        if (tgt === node.id) connected.add(src);
      }
      setHighlightedNodes(connected);
    },
    [graphData.links, highlightedNodes]
  );

  // ── Send chat message ───────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!chatInput.trim() || !activeRepo || chatLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: chatInput,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setChatInput("");
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
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: chatInput,
          repository_id: activeRepo.id,
          provider: "openai",
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
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: accumulated } : m
              )
            );
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "Error: Failed to get response. Please retry." }
              : m
          )
        );
      }
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, activeRepo, chatLoading]);

  // ── Generate tests ──────────────────────────────────────────────────────────
  const handleGenerateTests = useCallback(async () => {
    if (!activeFile || !activeRepo) return;
    setChatInput("");
    const prompt = `Generate a complete unit test suite for ${activeFile.name}`;
    setChatInput(prompt);
    handleSend();
  }, [activeFile, activeRepo, handleSend]);

  // ── Refactor diff ───────────────────────────────────────────────────────────
  const handleRefactor = useCallback(async () => {
    if (!activeFile || !activeRepo) return;
    const instruction = window.prompt("Describe the refactoring (e.g. 'Add error handling and type guards'):");
    if (!instruction) return;

    setChatLoading(true);
    try {
      const resp = await fetch(`${API}/api/tools/refactor-diff`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repository_id: activeRepo.id,
          file_path: activeFile.path,
          symbol_name: activeFile.name,
          refactor_instruction: instruction,
          provider: "openai",
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

  // ── Filtered file tree ──────────────────────────────────────────────────────
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

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen w-screen bg-[#0a0a0f] text-white overflow-hidden">

      {/* ── Left sidebar: repo selector + file tree ── */}
      <aside className="w-64 flex-shrink-0 flex flex-col border-r border-white/6 bg-[#0d0d15]">
        {/* Repo selector */}
        <div className="px-4 py-4 border-b border-white/6">
          <div className="flex items-center gap-2 mb-3">
            <div
              className="w-6 h-6 rounded-lg bg-purple-500/20 border border-purple-500/30
                         flex items-center justify-center text-xs text-purple-400"
            >
              ⚡
            </div>
            <span className="text-xs font-semibold text-neutral-300">Nexus</span>
          </div>
          <select
            value={activeRepo?.id ?? ""}
            onChange={(e) => {
              const r = repos.find((x) => x.id === e.target.value);
              setActiveRepo(r ?? null);
            }}
            className="w-full bg-white/5 border border-white/8 rounded-lg px-3 py-2
                       text-xs text-neutral-200 focus:outline-none focus:border-purple-500/40"
          >
            <option value="">Select repository…</option>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
              </option>
            ))}
          </select>
          {activeRepo && (
            <div className="mt-2 flex items-center gap-2">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  activeRepo.status === "ready" ? "bg-green-400" : "bg-amber-400 animate-pulse"
                }`}
              />
              <span className="text-[10px] text-neutral-500">
                {activeRepo.chunk_count.toLocaleString()} chunks &middot; {activeRepo.file_count} files
              </span>
            </div>
          )}
        </div>

        {/* File search */}
        <div className="px-3 py-2 border-b border-white/6">
          <input
            type="text"
            placeholder="Search files…"
            value={fileSearch}
            onChange={(e) => setFileSearch(e.target.value)}
            className="w-full bg-white/5 border border-white/8 rounded-lg px-2.5 py-1.5
                       text-xs text-neutral-300 placeholder-neutral-600
                       focus:outline-none focus:border-purple-500/40"
          />
        </div>

        {/* File tree */}
        <div className="flex-1 overflow-y-auto py-2 px-1">
          {filteredTree.length === 0 && (
            <p className="text-xs text-neutral-600 px-3 py-4 text-center">
              {activeRepo ? "No files indexed yet." : "Select a repository to browse files."}
            </p>
          )}
          {filteredTree.map((node) => (
            <FileTreeNode
              key={node.id}
              node={node}
              depth={0}
              onSelect={setActiveFile}
              selected={activeFile?.id ?? null}
            />
          ))}
        </div>
      </aside>

      {/* ── Center: Chat / Diff panel ── */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-white/6">
        {/* Tab bar */}
        <div className="flex items-center gap-0 px-4 py-0 border-b border-white/6 h-11 shrink-0">
          {(["chat", "diff"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 h-full text-xs font-medium transition-colors border-b-2
                          ${activeTab === tab
                            ? "border-purple-500 text-white"
                            : "border-transparent text-neutral-500 hover:text-neutral-300"}`}
            >
              {tab === "chat" ? "Chat" : "Diff viewer"}
              {tab === "diff" && diff && (
                <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
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
                <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
                  No diff generated yet. Select a file and click "Refactor diff".
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: 3D graph panel ── */}
      <div className="w-[45%] flex-shrink-0 flex flex-col">
        {/* Panel tab */}
        <div className="flex items-center gap-2 px-4 py-0 border-b border-white/6 h-11 shrink-0">
          <button
            onClick={() => setSidePanel("graph")}
            className={`px-4 h-full text-xs font-medium transition-colors border-b-2
                        ${sidePanel === "graph"
                          ? "border-blue-500 text-white"
                          : "border-transparent text-neutral-500 hover:text-neutral-300"}`}
          >
            3D dependency graph
          </button>
          <div className="ml-auto flex items-center gap-2">
            {highlightedNodes.size > 0 && (
              <button
                onClick={() => setHighlightedNodes(new Set())}
                className="text-[10px] text-amber-400 hover:text-amber-300"
              >
                Clear impact
              </button>
            )}
            <span className="text-[10px] text-neutral-600">
              Click a node to analyse impact
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
            <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
              {activeRepo ? "Graph loading…" : "Select a repository to view the dependency graph."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
