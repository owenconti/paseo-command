import { useSyncExternalStore } from "react";
import { api, errorMessage } from "../api";

/**
 * The Files page's reads, kept by path for the page's life: the tree's
 * directories, files opened (or hovered, `prefetch`), the list for quick-open
 * and the changed files. Every read shown asks again once its answer is old.
 */

/** The workspace a read is of. */
export type FilesWorkspace = { id: string; host?: string };

const query = (ws: FilesWorkspace, extra: Record<string, string> = {}) =>
  new URLSearchParams({ workspace: ws.id, ...(ws.host ? { host: ws.host } : {}), ...extra }).toString();

export const treePath = (ws: FilesWorkspace, dir: string) => `files/tree?${query(ws, dir ? { dir } : {})}`;
export const readPath = (ws: FilesWorkspace, path: string) => `files/read?${query(ws, { path })}`;
export const allPath = (ws: FilesWorkspace) => `files/all?${query(ws)}`;
export const changedPath = (ws: FilesWorkspace) => `files/changed?${query(ws)}`;
/** A workspace image's address, for a Markdown file's `<img>` (loaded by `loadImage`, not this store). */
export const imageUrl = (ws: FilesWorkspace, path: string) => `/api/files/image?${query(ws, { path })}`;

export type Entry = { data?: unknown; error?: string; loading: boolean; at: number };

type Transport = (path: string) => Promise<unknown>;
const real: Transport = (path) => api(path);
let transport: Transport = real;
/** Tests send the page's requests to a fake instead of the server (null restores the real one). */
export function setFilesTransport(next: Transport | null): void {
  transport = next ?? real;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

/** Asks for `path` (past the server's few seconds when `fresh`); the answer lands in the cache. */
export function load(path: string, fresh = false): Promise<void> {
  const running = inflight.get(path);
  if (running && !fresh) return running;
  const was = cache.get(path);
  cache.set(path, { ...(was ?? { at: 0 }), loading: true });
  const asked = transport(fresh ? `${path}&fresh=1` : path).then(
    (data) => {
      cache.set(path, { data, loading: false, at: Date.now() });
    },
    (e) => {
      cache.set(path, { ...cache.get(path), error: errorMessage(e), loading: false, at: Date.now() });
    },
  );
  const done = asked.finally(() => {
    if (inflight.get(path) === done) inflight.delete(path);
    emit();
  });
  inflight.set(path, done);
  emit();
  return done;
}

/** Asks for `path` unless an answer younger than `maxAgeMs` is kept (or one is on its way). */
export function ensure(path: string, maxAgeMs = 10_000): void {
  const kept = cache.get(path);
  if (inflight.has(path)) return;
  if (kept && kept.data !== undefined && Date.now() - kept.at < maxAgeMs) return;
  void load(path);
}

/** Hovering a file reads it ahead: opening it is then instant. */
export const prefetch = (path: string) => ensure(path, 5_000);

export const peek = (path: string): Entry | undefined => cache.get(path);

/** Asks again for every kept read whose path starts with one of these. */
export function reload(...prefixes: string[]): Promise<void[]> {
  return Promise.all([...cache.keys()].filter((key) => prefixes.some((p) => key.startsWith(p))).map((key) => load(key, true)));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
/** One read's answer, re-rendering only when it changes. */
export const useFilesData = (path: string | undefined) =>
  useSyncExternalStore(subscribe, () => (path ? cache.get(path)?.data : undefined), () => undefined);
/** Re-renders whenever any read lands (read them with `peek`). */
export const useFilesVersion = () => useSyncExternalStore(subscribe, () => version, () => version);
