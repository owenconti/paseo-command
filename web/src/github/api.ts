import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, errorMessage } from "../api";
import type { ChangesMode, GithubUnavailable, GithubWriteInputs, GithubWriteName, GithubWriteResult } from "./types";

type Transport = (path: string, body?: unknown) => Promise<unknown>;
const real: Transport = (path, body) => api(path, body);
let transport: Transport = real;

/** Tests send the page's requests to a fake instead of the server (null restores the real one). */
export function setGithubTransport(next: Transport | null): void {
  transport = next ?? real;
}

export type GithubReadName = "viewer" | "prs" | "pr" | "diff";

/** The path of one of the server's named GitHub reads. */
export const readPath = (name: GithubReadName, params: Record<string, string | number> = {}) => {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  return `github/q/${name}${query ? `?${query}` : ""}`;
};

/** The path of a workspace's changes against its base. */
export const changesPath = (workspace: string, host: string | undefined, mode: ChangesMode) => {
  const q = new URLSearchParams({ workspace, ...(host ? { host } : {}), mode });
  return `changes?${q}`;
};

/** One of the server's whitelisted GitHub writes; rejects with GitHub's message. */
export function githubWrite<N extends GithubWriteName>(name: N, input: GithubWriteInputs[N]): Promise<GithubWriteResult> {
  return transport(`github/m/${name}`, input) as Promise<GithubWriteResult>;
}

/** Whether a read answered "not now" (off, gh missing or signed out, not a checkout) instead of with data. */
export function isUnavailable(value: unknown): value is GithubUnavailable {
  return typeof value === "object" && value !== null && (value as { available?: unknown }).available === false;
}

// ── Reads, cached by path ────────────────────────────────────────────────────
type Entry = { data?: unknown; error?: string; loading: boolean; at: number; inflight?: Promise<void> };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Asks for `path` (past the server's cache when `fresh`); the answer lands in the cache. */
export function load(path: string, fresh = false): Promise<void> {
  const entry = cache.get(path) ?? { loading: false, at: 0 };
  if (entry.inflight && !fresh) return entry.inflight;
  const asked = transport(fresh ? `${path}${path.includes("?") ? "&" : "?"}fresh=1` : path).then(
    (data) => {
      cache.set(path, { data, loading: false, at: Date.now() });
      emit();
    },
    (e) => {
      const was = cache.get(path);
      cache.set(path, { ...was, error: errorMessage(e), loading: false, at: Date.now() });
      emit();
    },
  );
  cache.set(path, { ...entry, loading: true, inflight: asked });
  emit();
  return asked;
}

/** Changes a cached answer in place (a write shown at once); `undefined` from `change` leaves it. */
export function patch<T>(path: string, change: (data: T) => T | undefined): void {
  const entry = cache.get(path);
  if (!entry || entry.data === undefined || isUnavailable(entry.data)) return;
  const next = change(entry.data as T);
  if (next === undefined) return;
  cache.set(path, { ...entry, data: next });
  emit();
}

/** Forgets cached answers whose path starts with one of these (asked again when next shown). */
export function invalidate(...prefixes: string[]): void {
  for (const key of [...cache.keys()]) if (prefixes.some((p) => key.startsWith(p))) void load(key, true);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export type Resource<T> = {
  data: T | undefined;
  unavailable: string | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
};

/**
 * A named read's answer, asked when first shown (and again every `pollMs`
 * while shown and the page isn't hidden); null asks nothing. The last answer
 * stays while a newer one is asked.
 */
export function useGithubRead<T>(path: string | null, pollMs = 0): Resource<T> {
  const entry = useSyncExternalStore(
    subscribe,
    () => (path ? cache.get(path) : undefined),
    () => undefined,
  );
  const pathRef = useRef(path);
  pathRef.current = path;
  useEffect(() => {
    if (!path) return;
    const kept = cache.get(path);
    // Shown again: ask now unless an answer is fresh (under 10 s).
    if (!kept || (!kept.loading && Date.now() - kept.at > 10_000)) void load(path);
    if (!pollMs) return;
    const timer = setInterval(() => {
      if (!document.hidden) void load(path);
    }, pollMs);
    const back = () => {
      if (!document.hidden) void load(path);
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, [path, pollMs]);
  const reload = useCallback(() => {
    if (pathRef.current) void load(pathRef.current, true);
  }, []);
  const data = entry?.data;
  return {
    data: data !== undefined && !isUnavailable(data) ? (data as T) : undefined,
    unavailable: isUnavailable(data) ? data.reason : undefined,
    error: entry?.error,
    loading: !!entry?.loading,
    reload,
  };
}

/** A write's progress for a button: running it, and its failure. */
export function useWrite() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const run = useCallback(async <T,>(write: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      return await write();
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clear: () => setError(undefined) };
}
