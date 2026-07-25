/**
 * lib/api.ts
 * Type-safe API client for the Nexus backend.
 * All requests use credentials: "include" (session cookie).
 * SSE streaming helpers return an AsyncGenerator<string>.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

// ─── Response types ────────────────────────────────────────────────────────────

export interface Repository {
  id:               string;
  full_name:        string;
  status:           "pending" | "cloning" | "parsing" | "embedding" | "ready" | "failed";
  chunk_count:      number;
  file_count:       number;
  total_tokens:     number;
  error_message:    string | null;
  ingested_at:      string | null;
  vector_collection: string | null;
}

export interface ImportRepoPayload {
  full_name:      string;
  default_branch: string;
  is_private:     boolean;
}

export interface ImportRepoResponse {
  repository_id: string;
  task_id:       string;
  status:        "queued";
}

export interface QueryPayload {
  question:       string;
  repository_id:  string;
  provider:       "openai" | "anthropic" | "ollama";
  system_prompt?: string;
}

export interface TestGenPayload {
  repository_id: string;
  file_path:     string;
  symbol_name:   string;
  provider:      "openai" | "anthropic" | "ollama";
}

export interface DiffPayload {
  repository_id:         string;
  file_path:             string;
  symbol_name:           string;
  refactor_instruction:  string;
  provider:              "openai" | "anthropic" | "ollama";
}

export interface DiffResult {
  before:      string;
  after:       string;
  explanation: string;
}

export interface GraphNode {
  id:        string;
  name:      string;
  file_path: string;
  node_type: string;
  language:  string;
  val:       number;
}

export interface GraphLink {
  source: string;
  target: string;
  type:   "call" | "import";
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// ─── Base fetch wrapper ────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`API ${status}: ${detail}`);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
    ...init,
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}

// ─── SSE streaming helper ──────────────────────────────────────────────────────

async function* streamSSE(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method:      "POST",
    credentials: "include",
    headers:     { "Content-Type": "application/json" },
    body:        JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      detail = b.detail ?? detail;
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const token = line.slice(6);
        if (token === "[DONE]") return;
        if (token) yield token;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// ─── Repository endpoints ──────────────────────────────────────────────────────

export const repos = {
  list(): Promise<Repository[]> {
    return apiFetch<Repository[]>("/api/repos");
  },

  get(id: string): Promise<Repository> {
    return apiFetch<Repository>(`/api/repos/${id}`);
  },

  import(payload: ImportRepoPayload): Promise<ImportRepoResponse> {
    return apiFetch<ImportRepoResponse>("/api/repos", {
      method: "POST",
      body:   JSON.stringify(payload),
    });
  },
};

// ─── Query / chat endpoints ────────────────────────────────────────────────────

export const query = {
  stream(
    payload: QueryPayload,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    return streamSSE("/api/query/stream", payload, signal);
  },
};

// ─── Tools endpoints ──────────────────────────────────────────────────────────

export const tools = {
  generateTests(
    payload: TestGenPayload,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    return streamSSE("/api/tools/generate-tests", payload, signal);
  },

  async refactorDiff(payload: DiffPayload): Promise<DiffResult> {
    // Collects the full SSE stream then parses the JSON payload
    let raw = "";
    for await (const token of streamSSE("/api/tools/refactor-diff", payload)) {
      raw += token;
    }
    try {
      return JSON.parse(raw) as DiffResult;
    } catch {
      throw new Error("Failed to parse refactor diff response.");
    }
  },
};

// ─── Auth endpoints ────────────────────────────────────────────────────────────

export const auth = {
  initiateGitHub(): void {
    window.location.href = `${BASE}/api/auth/github`;
  },

  async logout(): Promise<void> {
    await apiFetch<void>("/api/auth/logout", { method: "POST" });
  },
};

// ─── Graph endpoint (future) ───────────────────────────────────────────────────

export const graph = {
  get(repositoryId: string): Promise<GraphData> {
    return apiFetch<GraphData>(`/api/repos/${repositoryId}/graph`);
  },
};

export { ApiError };
