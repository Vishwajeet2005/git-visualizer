/**
 * lib/hooks.ts
 * Custom React hooks for data fetching and SSE streaming.
 */

"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  type Repository,
  type GraphData,
  type QueryPayload,
  type DiffPayload,
  type DiffResult,
  repos as reposApi,
  query  as queryApi,
  tools  as toolsApi,
  graph  as graphApi,
  ApiError,
} from "./api";

// ─── useRepos ─────────────────────────────────────────────────────────────────

interface UseReposState {
  data:    Repository[];
  loading: boolean;
  error:   string | null;
}

export function useRepos() {
  const [state, setState] = useState<UseReposState>({
    data:    [],
    loading: true,
    error:   null,
  });

  const refetch = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await reposApi.list();
      setState({ data, loading: false, error: null });
    } catch (err) {
      setState({
        data:    [],
        loading: false,
        error:   err instanceof ApiError ? err.detail : "Failed to load repositories.",
      });
    }
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  return { ...state, refetch };
}


// ─── useRepo (single repo with polling while ingesting) ───────────────────────

export function useRepo(repoId: string | null) {
  const [repo, setRepo]       = useState<Repository | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const POLL_INTERVAL_MS = 3000;
  const TERMINAL = new Set(["ready", "failed"]);

  const fetch = useCallback(async (id: string) => {
    try {
      const data = await reposApi.get(id);
      setRepo(data);
      setError(null);
      // Stop polling once terminal state is reached
      if (TERMINAL.has(data.status) && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to fetch repository.");
    }
  }, []);

  useEffect(() => {
    if (!repoId) return;
    setLoading(true);
    void fetch(repoId).finally(() => setLoading(false));

    intervalRef.current = setInterval(() => {
      if (repo && !TERMINAL.has(repo.status)) {
        void fetch(repoId);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [repoId, fetch]);

  return { repo, loading, error };
}


// ─── useGraph ────────────────────────────────────────────────────────────────

export function useGraph(repositoryId: string | null) {
  const [data, setData]       = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!repositoryId) return;
    setLoading(true);
    graphApi
      .get(repositoryId)
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.detail : "Failed to load graph.")
      )
      .finally(() => setLoading(false));
  }, [repositoryId]);

  return { data, loading, error };
}


// ─── useStream ────────────────────────────────────────────────────────────────

interface StreamState {
  content:  string;
  loading:  boolean;
  error:    string | null;
  done:     boolean;
}

type StreamAction =
  | { type: "START" }
  | { type: "TOKEN"; payload: string }
  | { type: "DONE" }
  | { type: "ERROR"; payload: string }
  | { type: "RESET" };

function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case "START":   return { content: "",              loading: true,  error: null,           done: false };
    case "TOKEN":   return { ...state, content: state.content + action.payload };
    case "DONE":    return { ...state, loading: false, done: true };
    case "ERROR":   return { ...state, loading: false, error: action.payload };
    case "RESET":   return { content: "",              loading: false, error: null,           done: false };
    default:        return state;
  }
}

export function useStream() {
  const [state, dispatch] = useReducer(streamReducer, {
    content: "",
    loading: false,
    error:   null,
    done:    false,
  });

  const abortRef = useRef<AbortController | null>(null);

  const startStream = useCallback(async (payload: QueryPayload) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    dispatch({ type: "START" });

    try {
      for await (const token of queryApi.stream(payload, ctrl.signal)) {
        dispatch({ type: "TOKEN", payload: token });
      }
      dispatch({ type: "DONE" });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      dispatch({
        type:    "ERROR",
        payload: err instanceof ApiError ? err.detail : "Stream failed.",
      });
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "DONE" });
  }, []);

  const reset = useCallback(() => dispatch({ type: "RESET" }), []);

  return { ...state, startStream, abort, reset };
}


// ─── useDiff ──────────────────────────────────────────────────────────────────

export function useDiff() {
  const [diff, setDiff]       = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const generate = useCallback(async (payload: DiffPayload) => {
    setLoading(true);
    setError(null);
    try {
      const result = await toolsApi.refactorDiff(payload);
      setDiff(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to generate diff.");
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setDiff(null);
    setError(null);
  }, []);

  return { diff, loading, error, generate, reset };
}


// ─── useImpactAnalysis ────────────────────────────────────────────────────────

export function useImpactAnalysis(links: { source: string; target: string }[]) {
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());

  const analyseNode = useCallback(
    (nodeId: string) => {
      if (highlighted.has(nodeId)) {
        setHighlighted(new Set());
        return;
      }

      const connected = new Set<string>([nodeId]);
      for (const link of links) {
        const src =
          typeof link.source === "object"
            ? (link.source as unknown as { id: string }).id
            : link.source;
        const tgt =
          typeof link.target === "object"
            ? (link.target as unknown as { id: string }).id
            : link.target;

        if (src === nodeId) connected.add(tgt);
        if (tgt === nodeId) connected.add(src);
      }
      setHighlighted(connected);
    },
    [links, highlighted],
  );

  const clearHighlight = useCallback(() => setHighlighted(new Set()), []);

  return { highlighted, analyseNode, clearHighlight };
}
